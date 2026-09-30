import type { FastifyInstance } from "fastify";
import { LearningPlanInputError } from "./learning-plan.calendar.js";
import { LearningPlanRepositoryError, type LearningPlanBasis, type LearningPlanJsonObject, type LearningPlanRecordProgressInput, type LearningPlanRepository } from "./learning-plan.repository.js";
import { createLearningPlanService, type CreateLearningPlanInput, type RebalanceLearningPlanInput, type AdjustLearningPlanInput } from "./learning-plan.service.js";
import * as schemas from "./learning-plan.schemas.js";

export function registerLearningPlanRoutes(app: FastifyInstance, repository?: LearningPlanRepository) {
  const service = repository ? createLearningPlanService(repository) : undefined;
  type Query = { studentId: string; date?: string; versionId?: string };
  function endpoint<T>(method: "GET" | "POST", url: string, schema: { body?: object; querystring?: object },
    run: (body: T, params: Record<string, string>, query: Query) => Promise<unknown>) {
    app.route<{ Body: T; Params: Record<string, string>; Querystring: Query }>({ method, url, schema,
      handler: async (request, reply) => {
        if (!service) return reply.code(503).send({ code: "LEARNING_PLAN_STORAGE_UNAVAILABLE", message: "새 학습 계획 도구는 PostgreSQL 저장 기반이 필요합니다. mock으로 대체하지 않습니다." });
        try {
          const result = await run(request.body as T, request.params, request.query);
          const kind = (result as { kind?: string } | null)?.kind;
          if (kind === "conflict") reply.code(409);
          return reply.send(result);
        } catch (error) {
          if (error instanceof LearningPlanInputError) return reply.code(422).send({ code: error.code, message: error.message });
          if (error instanceof LearningPlanRepositoryError) {
            const status = error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_CANDIDATE" ? 422 : 409;
            return reply.code(status).send({ code: error.code, message: error.message });
          }
          request.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "학습 계획 처리 실패");
          return reply.code(500).send({ code: "LEARNING_PLAN_INTERNAL_ERROR", message: "학습 계획 처리에 실패했습니다. 마지막 정상 상태를 유지하고 재시도하세요." });
        }
      } });
  }
  endpoint<CreateLearningPlanInput>("POST", "/api/learning-plans/proposals/create", { body: schemas.learningPlanCreateSchema }, (body) => service!.create(body));
  endpoint<Omit<RebalanceLearningPlanInput, "planId">>("POST", "/api/learning-plans/:planId/proposals/rebalance", { body: schemas.learningPlanRebalanceSchema }, (body, p) => service!.rebalance({ ...body, planId: p.planId }));
  endpoint<Omit<AdjustLearningPlanInput, "planId">>("POST", "/api/learning-plans/:planId/proposals/adjust", { body: schemas.learningPlanAdjustSchema }, (body, p) => service!.adjust({ ...body, planId: p.planId }));
  endpoint<{ studentId: string; expectedBasis: LearningPlanBasis }>("POST", "/api/learning-plans/proposals/:proposalId/confirm", { body: schemas.learningPlanConfirmSchema }, (body, p) => service!.confirm({ ...body, proposalId: p.proposalId }));
  endpoint<Omit<LearningPlanRecordProgressInput, "planId">>("POST", "/api/learning-plans/:planId/progress", { body: schemas.learningPlanProgressSchema }, (body, p) => service!.recordProgress({ ...body, planId: p.planId }));
  endpoint<{ studentId: string; itemKey: string; idempotencyKey: string; feedback: LearningPlanJsonObject }>("POST", "/api/learning-plans/:planId/feedback", { body: schemas.learningPlanFeedbackRequestSchema }, (body, p) => service!.feedback({ ...body, planId: p.planId }));
  endpoint("GET", "/api/learning-plans", { querystring: schemas.learningPlanQuerySchema }, (_body, _p, query) => service!.read(query));
  endpoint("GET", "/api/learning-plans/:planId", { querystring: schemas.learningPlanQuerySchema }, (_body, p, query) => service!.read({ ...query, planId: p.planId }));
}
