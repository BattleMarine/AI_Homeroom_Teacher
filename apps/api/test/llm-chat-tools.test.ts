import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createChatService, registerChatRoutes, type ChatConfig } from "../src/llm-chat/llm-chat.js";
import { createStudentBinding, StudentBindingError } from "../src/llm-chat/student-binding.js";
import { createPlanToolSession, learningPlanTools, validateToolArguments } from "../src/llm-chat/learning-plan-tools.js";
import { buildLearningPlanView } from "../src/llm-chat/learning-plan-view.js";
import { createFileCourseCatalogRepository } from "../src/course-catalog/course-catalog.file-repository.js";
import { createLearningPlanService } from "../src/learning-plan/learning-plan.service.js";
import { learningPlanCatalogHash } from "../src/learning-plan/learning-plan.catalog-basis.js";
import { LearningPlanRepositoryError, type LearningPlanRepository, type LearningPlanSaveProposalInput,
  type LearningPlanHeader, type LearningPlanVersion, type LearningPlanReadBasisResult } from "../src/learning-plan/learning-plan.repository.js";
import type { CourseCatalog, CourseCatalogRepository } from "../src/course-catalog/course-catalog.types.js";

const config: ChatConfig = { apiKey: "test-key-not-secret", model: "test-model", baseUrl: "https://example.invalid" };
const studentId = "student-server-only";
const args = { selections: [{ subjectCode: "math", courseId: "math" }], startDate: "2026-10-01", deadlineDate: "2026-10-20", availableSecondsPerDay: 3000 };
const text = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "제안 내용을 확인하고 별도 확정해주세요." } }] });
const toolCall = (name: string, argumentsValue: unknown, id = "call") => ({ id, type: "function", function: { name, arguments: JSON.stringify(argumentsValue) } });
const tools = (...calls: unknown[]) => Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: calls } }] });
function catalog(id: string): CourseCatalog {
  return { course: { id, primarySubject: id, title: id === "korean" ? "국어 강좌" : "수학 강좌", includedSubjects: [id],
    provider: { id: "ebs", name: "검사" }, instructor: { id: "teacher", name: "검사" }, curriculumYear: 2026,
    lessonCount: 2, orientationCount: 0, contentLessonCount: 2, totalDurationSeconds: 3600, sourceUrl: null, status: "metadata_only" },
    lessons: [0, 1].map((sequence) => ({ id: `${id}:${sequence}`, courseId: id, sequence, lectureNumber: sequence + 1, title: `강의 ${sequence + 1}`,
      lessonType: "lecture", subjectAreas: [id], unitNames: [], duration: { display: "30분", seconds: 1800 }, sourceUrl: null, playbackTargetId: null })) };
}
/** 실제 서비스·편성 엔진을 사용하는 저장 경계 대역. DB 원자성·재시작 근거는 아니다. */
function fixture(overrides: Partial<LearningPlanRepository> = {}) {
  const catalogs = [catalog("math"), catalog("korean")];
  const catalogRepository: CourseCatalogRepository = {
    async listCourses() { return catalogs.map((c) => c.course); }, async getCourseCatalog(id) { return catalogs.find((c) => c.course.id === id); }, async getDefaultCourseCatalog() { return catalogs[0]; },
  };
  const state: { plan: LearningPlanHeader | null; version: LearningPlanVersion | null; saved: LearningPlanSaveProposalInput[];
    progress: LearningPlanReadBasisResult["progress"]; dailyUsage: LearningPlanReadBasisResult["dailyUsage"]; confirmCalls: string[];
    completions: LearningPlanReadBasisResult["completions"] } = {
    plan: null, version: null, saved: [], progress: [], dailyUsage: [], confirmCalls: [], completions: [],
  };
  const repository: LearningPlanRepository = {
    async readBasis(input) {
      if (input.studentId !== studentId) throw new LearningPlanRepositoryError("NOT_FOUND", "대상 없음");
      const catalogSnapshot = input.selections.map((s) => {
        const found = catalogs.find((c) => c.course.id === s.courseId);
        if (!found) throw new LearningPlanRepositoryError("NOT_FOUND", "강좌 없음");
        return { subjectCode: s.subjectCode, catalog: found };
      });
      return { plan: state.plan, version: state.version, catalogSnapshot, completions: state.completions, progress: state.progress, dailyUsage: state.dailyUsage,
        historicalItems: [], basis: { planId: state.plan?.planId ?? null, currentVersionId: state.plan?.currentVersionId ?? null,
          planRevision: state.plan?.planRevision ?? 0, completionRevision: state.plan?.completionRevision ?? 0, catalogHash: learningPlanCatalogHash(catalogSnapshot) } };
    },
    async saveProposal(input) { state.saved.push(structuredClone(input)); return { proposalId: `proposal-${state.saved.length}`, studentId: input.studentId, targetPlanId: "plan",
      expectedBasis: input.expectedBasis, createdAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-01T00:30:00Z" }; },
    async readPlan(input) {
      if (input.studentId !== studentId || !state.plan || !state.version) return undefined;
      return { plan: state.plan, version: state.version, assignments: state.version.candidate.assignments, completions: state.completions, progress: state.progress, dailyUsage: state.dailyUsage, historicalItems: [] };
    },
    async confirmProposal(input) { state.confirmCalls.push(input.studentId); throw new LearningPlanRepositoryError("BASIS_CONFLICT", "오래된 제안"); },
    async recordProgress() { assert.fail("모델에 진도 권한이 없어야 한다"); }, async recordCompletion() { assert.fail("모델에 완료 권한이 없어야 한다"); },
    ...overrides,
  };
  const service = createLearningPlanService(repository, () => new Date("2026-10-03T00:00:00Z"));
  function activate() {
    const saved = state.saved.at(-1)!;
    state.plan = { planId: "plan", studentId, currentVersionId: "version", planRevision: 1, completionRevision: 0 };
    state.version = { versionId: "version", planId: "plan", versionNumber: 1, kind: saved.kind, scope: saved.scope, reason: saved.reason, diff: saved.diff,
      candidate: saved.candidate, catalogHash: saved.expectedBasis.catalogHash, createdAt: "2026-10-01T00:00:00Z" };
  }
  const binding = createStudentBinding();
  const bindingToken = binding.issue(studentId).bindingToken;
  let activeStudent = true;
  function appFor(chat: ReturnType<typeof createChatService>) {
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    registerChatRoutes(app, chat, { binding, planService: service, catalog: catalogRepository,
      directory: { async listStudentTargets() { return activeStudent ? [{ studentId, hasLearningPlan: !!state.plan }] : []; }, async assertStudentExists(id) { if (id !== studentId || !activeStudent) throw new LearningPlanRepositoryError("NOT_FOUND", "대상 없음"); } } });
    return app;
  }
  return { state, service, catalogRepository, binding, bindingToken, appFor, activate, disableStudent() { activeStudent = false; } };
}

test("학생 토큰의 위조·만료·다른 프로세스 토큰은 검증 실패", () => {
  let now = 1000;
  const binding = createStudentBinding(() => now);
  const issued = binding.issue(studentId);
  assert.equal(binding.verify(issued.bindingToken), studentId);
  const [encoded, signature] = issued.bindingToken.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()); payload.studentId = "other";
  assert.throws(() => binding.verify(`${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`), StudentBindingError);
  assert.throws(() => createStudentBinding(() => now).verify(issued.bindingToken), StudentBindingError);
  now += 3600_000; assert.throws(() => binding.verify(issued.bindingToken), StudentBindingError);
});
test("결속 누락·대상 필드 조작·유효하지 않은 학생은 제공사 호출 전에 차단", async () => {
  const f = fixture(); let attempts = 0;
  const app = f.appFor(createChatService({ config: () => config, fetch: async () => { attempts++; return text(); } }));
  try {
    for (const [payload, status] of [[{ messages: [{ role: "user", content: "안녕" }] }, 400],
      [{ bindingToken: "forged.token", messages: [{ role: "user", content: "안녕" }] }, 401],
      [{ bindingToken: f.bindingToken, studentId: "other", messages: [{ role: "user", content: "안녕" }] }, 400]] as const)
      assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload })).statusCode, status);
    assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/bind", payload: { studentId: "other" } })).statusCode, 404);
    assert.equal(attempts, 0);
    const listed = (await app.inject("/api/llm-chat/students")).json();
    assert.deepEqual(listed, { students: [{ studentId, hasLearningPlan: false }] });
    assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/bind", payload: { studentId } })).statusCode, 200);
  } finally { await app.close(); }
});
test("모델 도구는 학생·SQL·확정·진도 권한 없이 엄격한 입력만 허용", () => {
  const names = learningPlanTools.map((t) => t.function.name);
  assert.equal(names.some((name) => /confirm|progress|sql|binding/.test(name)), false);
  for (const bad of [{ ...args, studentId: "other" }, { ...args, availableSecondsPerDay: "3000" }, { selections: args.selections }, { ...args, planId: "other" }])
    assert.throws(() => validateToolArguments("propose_create_plan", bad));
  assert.throws(() => validateToolArguments("confirm_proposal", {}));
});
test("실제 도구 생성 결과만 카드에 담고 확인 전 현재 상태 불변·학생 정보 모델 미노출", async () => {
  const f = fixture(); let attempts = 0;
  const chat = createChatService({ config: () => config, fetch: async (_url, options) => {
    attempts++; const sent = JSON.parse(options!.body as string);
    assert.equal(JSON.stringify(sent).includes(studentId), false); assert.equal(JSON.stringify(sent).includes(f.bindingToken), false);
    if (attempts === 1) return tools(toolCall("propose_create_plan", args));
    const result = JSON.parse(sent.messages.at(-1).content);
    assert.equal(result.stateChanged, false); assert.equal(result.requiresUserConfirmation, true); assert.equal(result.proposal, undefined);
    return text();
  } });
  const app = f.appFor(chat);
  try {
    const result = await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload: { bindingToken: f.bindingToken, messages: [{ role: "user", content: "수학 계획을 만들어줘" }] } });
    assert.equal(result.statusCode, 200);
    const card = result.json().proposalCards[0];
    assert.equal(card.proposal.studentId, studentId); assert.equal(card.proposal.expectedBasis.planId, null);
    assert.equal(card.candidate.assignments.reduce((n: number, a: { durationSeconds: number }) => n + a.durationSeconds, 0), 3600);
    assert.equal(f.state.plan, null); assert.deepEqual(f.state.confirmCalls, []); assert.equal(attempts, 2);
  } finally { await app.close(); }
});
test("부족한 인수·금지된 대상·없는 도구를 포함한 호출 묶음은 부작용 전에 거절", async () => {
  for (const bad of [toolCall("propose_create_plan", { selections: args.selections }), toolCall("propose_create_plan", { ...args, studentId: "other" }), toolCall("confirm_proposal", {})]) {
    const f = fixture(); let attempts = 0;
    const chat = createChatService({ config: () => config, fetch: async () => { attempts++; return tools(toolCall("propose_create_plan", args, "valid"), bad); } });
    await assert.rejects(chat.complete([{ role: "user", content: "요청" }], createPlanToolSession(studentId, f.service, f.catalogRepository)), (error: any) => error.code === "LLM_INVALID_TOOL_ARGUMENTS");
    assert.equal(attempts, 1); assert.equal(f.state.saved.length, 0);
  }
});
test("없는 강좌는 명시 오류이며 카탈로그 검색 결과를 제안 카드로 대체하지 않는다", async () => {
  const f = fixture(); let attempts = 0;
  const result = await createChatService({ config: () => config, fetch: async (_url, options) => {
    attempts++;
    if (attempts === 1) return tools(toolCall("list_courses", { query: "국어" }));
    if (attempts === 2) return tools(toolCall("propose_create_plan", { ...args, selections: [{ subjectCode: "missing", courseId: "missing" }] }));
    assert.equal(JSON.parse(JSON.parse(options!.body as string).messages.at(-1).content).code, "NOT_FOUND"); return text();
  } }).complete([{ role: "user", content: "없는 강좌" }], createPlanToolSession(studentId, f.service, f.catalogRepository));
  assert.deepEqual(result.proposalCards, []); assert.equal(result.toolResults.at(-1)?.code, "NOT_FOUND"); assert.equal(f.state.saved.length, 0);
});
test("모호한 요청에 모델이 질문하면 서버는 임의 조건으로 제안하지 않는다", async () => {
  const f = fixture();
  const result = await createChatService({ config: () => config, fetch: async () => text() }).complete([{ role: "user", content: "진도를 좀 바꿔줘" }], createPlanToolSession(studentId, f.service, f.catalogRepository));
  assert.deepEqual(result.proposalCards, []); assert.deepEqual(result.toolResults, []); assert.equal(f.state.saved.length, 0);
});
test("과목 추가는 기존 과목·항목·실제 진도를 보존하는 합집합 재편성", async () => {
  const f = fixture(); await f.service.create({ ...args, studentId }); f.activate();
  const key = f.state.version!.candidate.items[0].itemKey;
  f.state.progress = [{ planId: "plan", itemKey: key, positionSeconds: 500, carryoverSinceDate: "2026-10-01" }];
  const before = structuredClone({ plan: f.state.plan, version: f.state.version, progress: f.state.progress });
  const session = createPlanToolSession(studentId, f.service, f.catalogRepository);
  const read = await session.execute("read_current_plan", {});
  assert.equal(JSON.stringify(read.modelResult).includes(studentId), false);
  const result = await session.execute("propose_rebalance_plan", { selectionMode: "add", selections: [{ subjectCode: "korean", courseId: "korean" }], fromDate: "2026-10-03" });
  assert.deepEqual(result.card!.candidate.catalogSnapshot.map((s) => s.catalog.course.id), ["math", "korean"]);
  assert.equal(result.card!.candidate.items[0].itemKey, key);
  assert.deepEqual(result.card!.candidate.progressSnapshot?.progress, [{ itemKey: key, positionSeconds: 500 }]);
  assert.deepEqual({ plan: f.state.plan, version: f.state.version, progress: f.state.progress }, before);
});
test("오늘 총시간·추가시간·평소 시간은 기존 서비스 정규화로 구분", async () => {
  for (const mode of ["total", "additional", "persistent"] as const) {
    const f = fixture(); await f.service.create({ ...args, studentId }); f.activate();
    f.state.dailyUsage = [{ studyDate: "2026-10-03", spentSeconds: 500 }];
    const session = createPlanToolSession(studentId, f.service, f.catalogRepository);
    const result = await session.execute("propose_rebalance_plan", { selectionMode: "keep", ...(mode === "persistent" ? { availableSecondsPerDay: 2500 } : { todayTime: { mode, seconds: 2500 } }) });
    assert.equal(result.result.kind, "proposed");
    assert.equal(result.card!.candidate.conditions.availableSecondsPerDay, mode === "persistent" ? 2500 : 3000);
    assert.equal(result.card!.candidate.normalizedDays[0].capacitySeconds, mode === "additional" ? 3000 : 2500);
  }
});
test("명시 이동 도구는 충돌을 반환하고 전체 재편성을 자동 실행하지 않는다", async () => {
  const f = fixture(); await f.service.create({ ...args, studentId }); f.activate();
  const before = structuredClone(f.state.version); const count = f.state.saved.length;
  const assignments = before!.candidate.assignments;
  const result = await createPlanToolSession(studentId, f.service, f.catalogRepository).execute("propose_adjust_plan", { moves: [{ segmentKey: assignments[0].segmentKey, date: assignments[1].date, order: assignments[1].order }] });
  assert.equal(result.result.code, "ADJUSTMENT_CONFLICT"); assert.equal(result.card, undefined);
  assert.equal(f.state.saved.length, count); assert.deepEqual(f.state.version, before);
});
test("한 턴 조회 후 revision 변경 시 이전 기준의 제안을 저장하지 않는다", async () => {
  const f = fixture(); await f.service.create({ ...args, studentId }); f.activate();
  const session = createPlanToolSession(studentId, f.service, f.catalogRepository);
  await session.execute("read_current_plan", {});
  f.state.plan = { ...f.state.plan!, planRevision: 2 };
  const count = f.state.saved.length;
  const result = await session.execute("propose_rebalance_plan", { selectionMode: "keep" });
  assert.equal(result.result.code, "BASIS_CONFLICT"); assert.equal(result.card, undefined); assert.equal(f.state.saved.length, count);
});
test("한 요청 제안 상한은 두 번째 제안 저장을 차단", async () => {
  const f = fixture(); const session = createPlanToolSession(studentId, f.service, f.catalogRepository);
  assert.equal((await session.execute("propose_create_plan", args)).result.kind, "proposed");
  assert.equal((await session.execute("propose_create_plan", args)).result.code, "PROPOSAL_LIMIT");
  assert.equal(f.state.saved.length, 1);
});
test("제공사 후속 실패 때 대기 제안 카드는 보존하고 적용 성공으로 보고하지 않는다", async () => {
  const f = fixture(); let attempts = 0;
  const chat = createChatService({ config: () => config, fetch: async () => ++attempts === 1 ? tools(toolCall("propose_create_plan", args)) : new Response("원문 비밀", { status: 500 }) });
  const app = f.appFor(chat);
  try {
    const result = await app.inject({ method: "POST", url: "/api/llm-chat/messages", payload: { bindingToken: f.bindingToken, messages: [{ role: "user", content: "생성" }] } });
    assert.equal(result.statusCode, 502); assert.equal(result.json().code, "LLM_UPSTREAM_ERROR");
    assert.equal(result.json().proposalCards.length, 1); assert.equal(result.json().stateChanged, false); assert.equal(f.state.plan, null);
    assert.deepEqual(chat.runtimeStats().attempts, 2); assert.equal(chat.runtimeStats().failed, 1);
  } finally { await app.close(); }
});
test("모델 루프·도구 호출 수 상한은 자동 재시도 없이 종료", async () => {
  for (const [limits, code, expected] of [[{ maxAttempts: 2 }, "LLM_LOOP_LIMIT", 2], [{ maxToolCalls: 1 }, "LLM_TOOL_LIMIT", 2]] as const) {
    const f = fixture(); let calls = 0;
    const chat = createChatService({ config: () => config, ...limits, fetch: async () => { calls++; return tools(toolCall("list_courses", {})); } });
    await assert.rejects(chat.complete([{ role: "user", content: "계속" }], createPlanToolSession(studentId, f.service, f.catalogRepository)), (e: any) => e.code === code);
    assert.equal(calls, expected); assert.equal(f.state.saved.length, 0);
  }
});
test("명시 확정 경로만 결속 학생을 주입하고 오래된 기준 오류를 유지", async () => {
  const f = fixture(); const app = f.appFor(createChatService({ config: () => config, fetch: async () => text() }));
  const result = await f.service.create({ ...args, studentId }); assert.equal(result.kind, "proposed");
  if (result.kind !== "proposed") assert.fail("검사 제안 생성 실패");
  try {
    const payload = { bindingToken: f.bindingToken, proposalId: result.proposal.proposalId, expectedBasis: result.proposal.expectedBasis };
    assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/confirm", payload: { ...payload, studentId: "other" } })).statusCode, 400);
    assert.deepEqual(f.state.confirmCalls, []);
    const response = await app.inject({ method: "POST", url: "/api/llm-chat/confirm", payload });
    assert.equal(response.statusCode, 409); assert.equal(response.json().code, "BASIS_CONFLICT"); assert.deepEqual(f.state.confirmCalls, [studentId]);
  } finally { await app.close(); }
});
test("사용량은 제공사 반환 근거만 집계하고 누락값은 추정하지 않는다", async () => {
  const chat = createChatService({ config: () => config, fetch: async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "응답" } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 8 } } }) });
  await chat.complete([{ role: "user", content: "질문" }]);
  assert.deepEqual(chat.runtimeStats(), { attempts: 1, completed: 1, failed: 0, usage: { promptTokens: { total: 10, reports: 1 }, completionTokens: { total: 20, reports: 1 }, totalTokens: { total: 30, reports: 1 }, cachedTokens: { total: 5, reports: 1 }, reasoningTokens: { total: 8, reports: 1 } } });
});
test("DB·도구 실패는 제공사 연결 실패와 구분하고 앞선 대기 카드·결과 보존", async () => {
  const f = fixture(); let attempts = 0;
  const session = createPlanToolSession(studentId, f.service, f.catalogRepository);
  const guarded = { async execute(name: string, argsValue: Record<string, unknown>) {
    if (name === "list_courses") throw new Error("민감한 DB 원문");
    return session.execute(name, argsValue);
  } };
  const chat = createChatService({ config: () => config, fetch: async () => ++attempts === 1 ? tools(toolCall("propose_create_plan", args)) : tools(toolCall("list_courses", {})) });
  await assert.rejects(chat.complete([{ role: "user", content: "생성" }], guarded), (error: any) => {
    assert.equal(error.code, "LEARNING_PLAN_TOOL_FAILED"); assert.equal(error.status, 503);
    assert.equal(error.message.includes("민감한"), false); assert.equal(error.details.proposalCards.length, 1);
    assert.equal(error.details.toolResults[0].kind, "proposed"); assert.equal(error.details.stateChanged, false); return true;
  });
  assert.equal(f.state.plan, null); assert.equal(attempts, 2);
});
test("전체 대화 제한 시간은 멈춘 도구 대기를 종료하고 이미 확보한 카드만 보존", async () => {
  const f = fixture(); let attempts = 0;
  const session = createPlanToolSession(studentId, f.service, f.catalogRepository);
  const delayed = { async execute(name: string, argsValue: Record<string, unknown>) {
    if (name === "list_courses") { await new Promise((resolve) => setTimeout(resolve, 100)); throw new Error("늦은 거절 원문"); }
    return session.execute(name, argsValue);
  } };
  const chat = createChatService({ config: () => config, timeoutMs: 40, fetch: async () => ++attempts === 1 ? tools(toolCall("propose_create_plan", args)) : tools(toolCall("list_courses", {})) });
  const started = Date.now();
  await assert.rejects(chat.complete([{ role: "user", content: "생성" }], delayed), (error: any) => {
    assert.equal(error.code, "LLM_TIMEOUT"); assert.equal(error.details.proposalCards.length, 1); return true;
  });
  assert.ok(Date.now() - started < 100); assert.equal(attempts, 2); assert.equal(f.state.plan, null);
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.equal(attempts, 2);
});
test("표시용 조회는 원본 예정과 실제 위치·소비·완료·피드백을 분리하고 snapshot 불변", async () => {
  // 첫날의 예정/실제 차이를 검사하는 밀집 입력이다. 장기 계획의 첫날 채우기를 전제하지 않는다.
  const f = fixture(); await f.service.create({ ...args, studentId, deadlineDate: "2026-10-02" }); f.activate();
  const itemKey = f.state.version!.candidate.items[0].itemKey;
  f.state.progress = [{ planId: "plan", itemKey, positionSeconds: 500, carryoverSinceDate: "2026-09-30" }];
  f.state.dailyUsage = [{ studyDate: "2026-10-01", spentSeconds: 700 }];
  const current = await f.service.read({ studentId }); const before = JSON.stringify(current);
  const view = buildLearningPlanView(current, new Date("2026-10-01T00:00:00Z"));
  assert.equal(view.items[0].lessonTitle, "강의 1"); assert.equal(view.items[0].courseTitle, "수학 강좌");
  assert.equal(view.items[0].positionSeconds, 500); assert.equal(view.items[0].remainingSeconds, 1300);
  assert.equal(view.items[0].carryoverSinceDate, "2026-09-30");
  assert.equal(view.items[0].completed, false); assert.equal(view.items[0].feedbackSubmitted, false);
  assert.equal(view.today.totalSeconds, 3000); assert.equal(view.today.spentSeconds, 700); assert.equal(view.today.remainingSeconds, 2300);
  assert.equal(view.today.scheduledSeconds, 1800); assert.equal(view.today.remainingScheduledSeconds, 1300);
  assert.equal(view.today.assignments[0].durationSeconds, 1800); assert.equal(view.today.assignments[0].remainingSeconds, 1300);
  assert.equal(JSON.stringify(current), before);
  f.state.progress[0].positionSeconds = 1800;
  f.state.completions = [{ planId: "plan", itemKey, payload: null, completedAt: "2026-10-01T01:00:00Z", completionRevision: 1, feedbackSubmittedAt: null, feedbackRevision: null }];
  const finished = buildLearningPlanView(await f.service.read({ studentId }), new Date("2026-10-01T00:00:00Z"));
  assert.equal(finished.items[0].completed, true); assert.equal(finished.items[0].feedbackSubmitted, false); assert.equal(finished.items[0].remainingSeconds, 0);
  f.state.completions[0] = { ...f.state.completions[0], payload: { understandingLevel: 3, focusLevel: 4 }, feedbackSubmittedAt: "2026-10-01T01:01:00Z", feedbackRevision: 2 };
  const reviewed = buildLearningPlanView(await f.service.read({ studentId }));
  assert.equal(reviewed.items[0].feedbackSubmitted, true); assert.deepEqual(reviewed.items[0].feedback, { understandingLevel: 3, focusLevel: 4 });
});
test("이어보기 표시용 구간 잔여는 실제 위치를 각 예정 범위에 대조하고 기간 밖 소비도 유지", async () => {
  const f = fixture(); await f.service.create({ ...args, studentId, availableSecondsPerDay: 1000 }); f.activate();
  const itemKey = f.state.version!.candidate.items[0].itemKey;
  f.state.progress = [{ planId: "plan", itemKey, positionSeconds: 1200, carryoverSinceDate: null }];
  f.state.dailyUsage = [{ studyDate: "2026-09-30", spentSeconds: 200 }];
  const view = buildLearningPlanView(await f.service.read({ studentId }), new Date("2026-09-30T00:00:00Z"));
  const segments = view.assignments.filter((a) => a.itemKey === itemKey);
  assert.deepEqual(segments.map((a) => [a.durationSeconds, a.remainingSeconds, a.completed]), [[1000, 0, true], [800, 600, false]]);
  assert.equal(view.items[0].completed, false); assert.equal(view.items[0].remainingSeconds, 600);
  assert.equal(view.today.inPlanPeriod, false); assert.equal(view.today.spentSeconds, 200); assert.equal(view.today.remainingSeconds, 0);
  assert.deepEqual(view.today.assignments, []);
});
test("카탈로그 표시 정보 누락은 null로 명시하고 과목별 가짜 강의명을 만들지 않는다", async () => {
  const f = fixture(); await f.service.create({ ...args, studentId }); f.activate();
  const current = await f.service.read({ studentId }); current.version.candidate.catalogSnapshot = [];
  const view = buildLearningPlanView(current);
  assert.equal(view.items[0].metadataMissing, true); assert.equal(view.items[0].lessonTitle, null); assert.equal(view.items[0].courseTitle, null);
});
test("수동 진도는 현재 학생·계획을 주입하고 사건 키·수치·재시도 결과를 그대로 전달", async () => {
  const received: unknown[] = [];
  const progress = { event: { eventId: "event", planId: "plan", itemKey: "record-item", idempotencyKey: "same-event", positionSeconds: 500, spentSeconds: 700,
    studyDate: "2026-10-01", createdAt: "2026-10-01T01:00:00Z", executionRevision: 9 }, progress: { planId: "plan", itemKey: "record-item", positionSeconds: 500, carryoverSinceDate: null },
    completion: null, completionRevision: 9, replayed: false };
  const f = fixture({ async recordProgress(input) { received.push(structuredClone(input)); return { ...progress, replayed: received.length > 1 }; } });
  await f.service.create({ ...args, studentId }); f.activate();
  const chat = createChatService({ config: () => config, fetch: async () => { assert.fail("수동 진도에 모델을 호출하지 않아야 한다"); } });
  const app = f.appFor(chat);
  const event = { itemKey: "record-item", idempotencyKey: "same-event", positionSeconds: 500, spentSeconds: 700 };
  try {
    const payload = { bindingToken: f.bindingToken, ...event };
    const first = await app.inject({ method: "POST", url: "/api/llm-chat/progress", payload });
    const retry = await app.inject({ method: "POST", url: "/api/llm-chat/progress", payload });
    assert.equal(first.statusCode, 200); assert.deepEqual(first.json(), progress); assert.equal(retry.json().replayed, true);
    assert.deepEqual(received, [{ ...event, studentId, planId: "plan" }, { ...event, studentId, planId: "plan" }]);
    assert.equal(first.headers["cache-control"], "no-store"); assert.equal(chat.runtimeStats().attempts, 0);
    for (const invalid of [{ ...payload, planId: "other" }, { ...payload, studentId: "other" }, { ...payload, studyDate: "2026-10-02" },
      { ...payload, positionSeconds: -1 }, { ...payload, spentSeconds: 86401 }, { ...payload, feedback: { understandingLevel: 3 } },
      { ...payload, feedback: { understandingLevel: 3, focusLevel: 8 } }])
      assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/progress", payload: invalid })).statusCode, 400);
    assert.equal(received.length, 2);
    f.disableStudent(); assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/progress", payload })).statusCode, 404);
    assert.equal(received.length, 2);
  } finally { await app.close(); }
});
test("수동 종료 피드백은 별도 경로로 payload에 전달하고 초·revision을 추정하지 않는다", async () => {
  const received: unknown[] = [];
  const completion = { planId: "plan", itemKey: "done-item", payload: { understandingLevel: 3, focusLevel: 4, comment: "첫 피드백" },
    completedAt: "2026-10-01T01:00:00Z", completionRevision: 9, feedbackSubmittedAt: "2026-10-01T01:01:00Z", feedbackRevision: 10 };
  const f = fixture({ async recordCompletion(input) { received.push(input); return { completion, replayed: received.length > 1 }; } });
  await f.service.create({ ...args, studentId }); f.activate();
  const app = f.appFor(createChatService({ config: () => undefined }));
  try {
    const payload = { bindingToken: f.bindingToken, itemKey: "done-item", idempotencyKey: "same-feedback", feedback: completion.payload };
    const first = await app.inject({ method: "POST", url: "/api/llm-chat/feedback", payload });
    const retry = await app.inject({ method: "POST", url: "/api/llm-chat/feedback", payload });
    assert.equal(first.statusCode, 200); assert.deepEqual(first.json(), { completion, replayed: false }); assert.equal(retry.json().replayed, true);
    for (const input of received as Array<Record<string, unknown>>) {
      assert.equal(input.studentId, studentId); assert.equal(input.planId, "plan"); assert.deepEqual(input.payload, completion.payload); assert.equal(input.bindingToken, undefined);
    }
    assert.deepEqual(f.state.dailyUsage, []); assert.deepEqual(f.state.progress, []);
    assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/feedback", payload: { ...payload, spentSeconds: 500 } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/llm-chat/feedback", payload: { ...payload, studentId: "other" } })).statusCode, 400);
    assert.equal(received.length, 2);
  } finally { await app.close(); }
});
test("계획 미생성·토큰 위조와 기존 기록 오류를 구분해 반환한다", async () => {
  for (const path of ["progress", "feedback"]) {
    let calls = 0;
    const f = fixture({ async recordProgress() { calls++; assert.fail(); }, async recordCompletion() { calls++; assert.fail(); } });
    const app = f.appFor(createChatService({ config: () => undefined }));
    const payload = { bindingToken: f.bindingToken, itemKey: "item", idempotencyKey: "event", ...(path === "progress" ? { positionSeconds: 1, spentSeconds: 1 } : { feedback: { understandingLevel: 3, focusLevel: 4 } }) };
    try {
      assert.equal((await app.inject({ method: "POST", url: `/api/llm-chat/${path}`, payload })).statusCode, 404);
      assert.equal((await app.inject({ method: "POST", url: `/api/llm-chat/${path}`, payload: { ...payload, bindingToken: "forged.token" } })).statusCode, 401);
      assert.equal(calls, 0);
    } finally { await app.close(); }
  }
  for (const path of ["progress", "feedback"]) for (const [code, status] of [["IDEMPOTENCY_CONFLICT", 409], ["BASIS_CONFLICT", 409], ["INVALID_STATE", 409], ["NOT_FOUND", 404], ["INVALID_CANDIDATE", 422]] as const) {
    const fail = async () => { throw new LearningPlanRepositoryError(code, "기존 기록 오류"); };
    const f = fixture({ recordProgress: fail, recordCompletion: fail }); await f.service.create({ ...args, studentId }); f.activate();
    const app = f.appFor(createChatService({ config: () => undefined }));
    try {
      const payload = { bindingToken: f.bindingToken, itemKey: "item", idempotencyKey: "event", ...(path === "progress" ? { positionSeconds: 1, spentSeconds: 1 } : { feedback: { understandingLevel: 3, focusLevel: 4 } }) };
      const result = await app.inject({ method: "POST", url: `/api/llm-chat/${path}`, payload });
      assert.equal(result.statusCode, status); assert.equal(result.json().code, code);
    } finally { await app.close(); }
  }
});
test("현재 계획 조회·모델 조회는 강의명을 제공하고 개인 피드백 본문은 모델에 전달하지 않는다", async () => {
  const f = fixture(); await f.service.create({ ...args, studentId }); f.activate();
  const itemKey = f.state.version!.candidate.items[0].itemKey;
  f.state.completions = [{ planId: "plan", itemKey, payload: { understandingLevel: 3, focusLevel: 4, comment: "학생 개인 피드백" },
    completedAt: "2026-10-01T01:00:00Z", completionRevision: 1, feedbackSubmittedAt: "2026-10-01T01:01:00Z", feedbackRevision: 2 }];
  const app = f.appFor(createChatService({ config: () => undefined }));
  try {
    const response = await app.inject({ method: "POST", url: "/api/llm-chat/current", payload: { bindingToken: f.bindingToken } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().learningView.items[0].lessonTitle, "강의 1");
    assert.equal(response.json().learningView.items[0].feedback.comment, "학생 개인 피드백");
    assert.equal(response.json().learningView.days[0].scheduledSeconds, response.json().days[0].scheduledSeconds);
    const modelResult = (await createPlanToolSession(studentId, f.service, f.catalogRepository).execute("read_current_plan", {})).modelResult as any;
    assert.equal(modelResult.items[0].lessonTitle, "강의 1"); assert.equal(modelResult.assignments[0].lessonTitle, "강의 1");
    assert.equal(JSON.stringify(modelResult).includes("학생 개인 피드백"), false); assert.equal(JSON.stringify(modelResult).includes(studentId), false);
  } finally { await app.close(); }
});
test("실제 파일 EBSi 카탈로그를 과목·강좌 이름으로 조회하고 내부 ID 입력을 요구하지 않는다", async () => {
  const f = fixture(); const catalog = createFileCourseCatalogRepository();
  const session = createPlanToolSession(studentId, f.service, catalog);
  for (const query of ["수학", "국어", "영어", "최서희", "김제희"]) {
    const result = await session.execute("list_courses", { query });
    const courses = (result.modelResult as { courses: Array<{ courseId: string; subjectCode: string; title: string; includedSubjects: string[] }> }).courses;
    assert.ok(courses.length > 0); assert.ok(courses.every((course) => `${course.title} ${course.subjectCode} ${course.includedSubjects.join(" ")}`.includes(query)));
    assert.equal(result.card, undefined);
  }
});
