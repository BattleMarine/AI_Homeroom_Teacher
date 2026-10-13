import type { FastifyInstance, FastifyReply } from "fastify";
import type { CourseCatalogRepository } from "../course-catalog/course-catalog.types.js";
import type { LearningPlanStudentDirectory } from "../db/learning-plan-student-directory.js";
import { LearningPlanInputError } from "../learning-plan/learning-plan.calendar.js";
import { LearningPlanRepositoryError, type LearningPlanBasis, type LearningPlanRecordProgressInput, type LearningPlanJsonObject } from "../learning-plan/learning-plan.repository.js";
import { learningPlanBasisSchema, learningPlanProgressSchema, learningPlanFeedbackRequestSchema } from "../learning-plan/learning-plan.schemas.js";
import { ChatError, createChatService, withChatDeadline, type ChatMessage, type ChatService } from "./llm-chat.js";
import { createPlanToolSession, type PlanService } from "./learning-plan-tools.js";
import { createStudentBinding, StudentBindingError, type StudentBinding } from "./student-binding.js";
import { buildLearningPlanView } from "./learning-plan-view.js";

export type ChatRouteDependencies = { directory?: LearningPlanStudentDirectory; planService?: PlanService;
  catalog?: CourseCatalogRepository; binding?: StudentBinding };
const tokenSchema = { type: "string", minLength: 1, maxLength: 1000 };
const idSchema = { type: "string", minLength: 1, maxLength: 100 };
const body = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const boundBody = (schema: { properties: Record<string, unknown>; required: string[] }) => body({
  ...Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== "studentId")), bindingToken: tokenSchema,
}, ["bindingToken", ...schema.required.filter((key) => key !== "studentId")]);
export type BoundProgressRequest = Omit<LearningPlanRecordProgressInput, "studentId" | "planId"> & { bindingToken: string };
export type BoundFeedbackRequest = { bindingToken: string; itemKey: string; idempotencyKey: string; feedback: LearningPlanJsonObject };

export function registerChatRoutes(app: FastifyInstance, service: ChatService = createChatService(), dependencies: ChatRouteDependencies = {}) {
  const binding = dependencies.binding ?? createStudentBinding();
  const toolsEnabled = !!(dependencies.directory && dependencies.planService && dependencies.catalog);
  let active = 0;
  let windowStart = Date.now();
  let requests = 0;
  function fail(reply: FastifyReply, error: unknown) {
    if (error instanceof StudentBindingError || error instanceof ChatError) return reply.code(error.status).send({ code: error.code, message: error.message,
      ...(error instanceof ChatError && error.details ? error.details : {}) });
    if (error instanceof LearningPlanInputError) return reply.code(422).send({ code: error.code, message: error.message });
    if (error instanceof LearningPlanRepositoryError) return reply.code(error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_CANDIDATE" ? 422 : 409).send({ code: error.code, message: error.message });
    return reply.code(500).send({ code: "CHAT_INTERNAL_ERROR", message: "대화·학습 요청 처리에 실패했습니다. 마지막 정상 상태를 유지하고 재시도해주세요." });
  }
  function directory() {
    if (!dependencies.directory) throw new ChatError("STUDENT_DIRECTORY_UNAVAILABLE", 503, "학생 대상 조회는 PostgreSQL 저장 기반이 필요합니다.");
    return dependencies.directory;
  }
  function planner() {
    if (!dependencies.planService) throw new ChatError("LEARNING_PLAN_STORAGE_UNAVAILABLE", 503, "학습 계획 도구는 PostgreSQL 저장 기반이 필요합니다.");
    return dependencies.planService;
  }
  async function student(token: string, signal?: AbortSignal) {
    const studentId = binding.verify(token);
    const check = directory().assertStudentExists(studentId);
    if (signal) await withChatDeadline(check, signal); else await check;
    return studentId;
  }
  app.get("/api/llm-chat/status", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { configured: service.configured(), toolsEnabled, historyStorage: "client-memory", studentSelection: "local-development-only" };
  });
  app.get("/api/llm-chat/runtime-stats", async (_request, reply) => {
    reply.header("Cache-Control", "no-store"); return service.runtimeStats();
  });
  app.get("/api/llm-chat/students", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return { students: await directory().listStudentTargets() }; } catch (error) { return fail(reply, error); }
  });
  app.post<{ Body: { studentId: string } }>("/api/llm-chat/bind", {
    schema: { body: body({ studentId: idSchema }, ["studentId"]) },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try { await directory().assertStudentExists(request.body.studentId); return binding.issue(request.body.studentId); }
    catch (error) { return fail(reply, error); }
  });
  app.post<{ Body: { bindingToken: string } }>("/api/llm-chat/current", {
    schema: { body: body({ bindingToken: tokenSchema }, ["bindingToken"]) },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const current = await planner().read({ studentId: await student(request.body.bindingToken) });
      return { ...current, learningView: buildLearningPlanView(current) };
    }
    catch (error) { return fail(reply, error); }
  });
  app.post<{ Body: BoundProgressRequest }>("/api/llm-chat/progress", {
    schema: { body: boundBody(learningPlanProgressSchema) },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const studentId = await student(request.body.bindingToken);
      const current = await planner().read({ studentId });
      const { bindingToken: _bindingToken, ...event } = request.body;
      return await planner().recordProgress({ ...event, studentId, planId: current.plan!.planId });
    } catch (error) { return fail(reply, error); }
  });
  app.post<{ Body: BoundFeedbackRequest }>("/api/llm-chat/feedback", {
    schema: { body: boundBody(learningPlanFeedbackRequestSchema) },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const studentId = await student(request.body.bindingToken);
      const current = await planner().read({ studentId });
      const { bindingToken: _bindingToken, ...feedback } = request.body;
      return await planner().feedback({ ...feedback, studentId, planId: current.plan!.planId });
    } catch (error) { return fail(reply, error); }
  });
  app.post<{ Body: { bindingToken: string; proposalId: string; expectedBasis: LearningPlanBasis } }>("/api/llm-chat/confirm", {
    schema: { body: body({ bindingToken: tokenSchema, proposalId: { type: "string", minLength: 1, maxLength: 200 }, expectedBasis: learningPlanBasisSchema }, ["bindingToken", "proposalId", "expectedBasis"]) },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try { return await planner().confirm({ studentId: await student(request.body.bindingToken), proposalId: request.body.proposalId, expectedBasis: request.body.expectedBasis }); }
    catch (error) { return fail(reply, error); }
  });
  app.post<{ Body: { bindingToken: string; messages: ChatMessage[] } }>("/api/llm-chat/messages", {
    bodyLimit: 128 * 1024,
    schema: { body: body({ bindingToken: tokenSchema,
      messages: { type: "array", minItems: 1, maxItems: 31, items: body({ role: { type: "string", enum: ["user", "assistant"] },
        content: { type: "string", minLength: 1, maxLength: 16_000 } }, ["role", "content"]) },
    }, ["bindingToken", "messages"]) },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const messages = request.body.messages;
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(60_000);
    if (messages.length % 2 !== 1 || messages.some((m, i) => m.role !== (i % 2 ? "assistant" : "user") || !m.content.trim() || (m.role === "user" && m.content.length > 4000)) ||
      messages.reduce((n, m) => n + m.content.length, 0) > 60_000) {
      return reply.code(400).send({ code: "INVALID_CHAT_HISTORY", message: "사용자·AI 순서의 대화와 마지막 사용자 입력이 필요합니다. 대화 길이를 줄이거나 새 대화를 시작해주세요." });
    }
    try {
      const studentId = await student(request.body.bindingToken, signal);
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
      if (active >= 2 || requests >= 20) return reply.code(429).send({ code: "CHAT_BUSY", message: "대화 요청이 많습니다. 잠시 후 다시 시도해주세요." });
      active++; requests++;
      try { return await service.complete(messages, toolsEnabled ? createPlanToolSession(studentId, dependencies.planService!, dependencies.catalog!) : undefined, { signal, startedAt }); }
      finally { active--; }
    } catch (error) { return fail(reply, error); }
  });
}
