// 실제 HTTP 라우팅·학생 결속·확정 DTO 검사. 제공사와 DB는 호출하지 않는다.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createChatService, registerChatRoutes } from "../../../apps/api/src/llm-chat/llm-chat.ts";
const require = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
const Fastify = require("fastify");
const basis = { planId: "fixture-plan", currentVersionId: "fixture-version", planRevision: 1,
  completionRevision: 0, catalogHash: "a".repeat(64) };
let providerCalls = 0, confirmation, progressInput, feedbackInput;
const stored = new Map();
const fixture = { plan: { studentId: "fixture-student", planId: basis.planId }, basis,
  version: { candidate: { catalogSnapshot: [], items: [], assignments: [] }, versionNumber: 1 },
  assignments: [], completions: [], progress: [], days: [], dailyUsage: [] };
const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
registerChatRoutes(app, createChatService({ config: () => undefined,
  fetch: async () => { providerCalls++; throw new Error("제공사 호출 금지"); } }), {
  directory: {
    async listStudentTargets() { return [{ studentId: "fixture-student", hasLearningPlan: true }]; },
    async assertStudentExists(studentId) { assert.equal(studentId, "fixture-student"); },
  },
  planService: {
    async read({ studentId }) { assert.equal(studentId, "fixture-student"); return fixture; },
    async recordProgress(input) {
      progressInput = input;
      const replayed = stored.has(input.idempotencyKey);
      if (replayed) assert.deepEqual(stored.get(input.idempotencyKey), input); else stored.set(input.idempotencyKey, input);
      return { event: input, progress: { positionSeconds: input.positionSeconds }, completion: null, completionRevision: 1, replayed };
    },
    async feedback(input) {
      feedbackInput = input;
      const replayed = stored.has(input.idempotencyKey);
      if (replayed) assert.deepEqual(stored.get(input.idempotencyKey), input); else stored.set(input.idempotencyKey, input);
      return { completion: { payload: input.feedback }, replayed };
    },
    async confirm(input) { confirmation = input; return { planId: basis.planId, basis, replayed: false }; },
  },
  catalog: {},
});
try {
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  async function request(path, body) {
    const response = await fetch(origin + path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const students = await request("/api/llm-chat/students");
  assert.equal(students.status, 200);
  assert.deepEqual(students.data.students, [{ studentId: "fixture-student", hasLearningPlan: true }]);
  const bound = await request("/api/llm-chat/bind", { studentId: "fixture-student" });
  assert.equal(bound.status, 200); assert.equal(bound.data.studentId, "fixture-student");
  const { bindingToken } = bound.data;
  const current = await request("/api/llm-chat/current", { bindingToken });
  assert.equal(current.status, 200); assert.equal(current.data.plan.studentId, "fixture-student");
  assert.equal(current.data.learningView.today.inPlanPeriod, false);
  assert.deepEqual(current.data.learningView.items, []);
  const progress = { bindingToken, itemKey: "fixture-item", idempotencyKey: "fixture-progress", positionSeconds: 10, spentSeconds: 7 };
  assert.equal((await request("/api/llm-chat/progress", { ...progress, studentId: "foreign-student" })).status, 400);
  assert.equal((await request("/api/llm-chat/progress", { ...progress, planId: "foreign-plan" })).status, 400);
  assert.equal((await request("/api/llm-chat/progress", { ...progress, studyDate: "2026-10-01" })).status, 400);
  assert.equal((await request("/api/llm-chat/progress", { ...progress, bindingToken: "invalid" })).status, 401);
  assert.equal(progressInput, undefined);
  const savedProgress = await request("/api/llm-chat/progress", progress);
  assert.equal(savedProgress.status, 200); assert.equal(savedProgress.data.replayed, false);
  assert.deepEqual(progressInput, { studentId: "fixture-student", planId: basis.planId, itemKey: "fixture-item",
    idempotencyKey: "fixture-progress", positionSeconds: 10, spentSeconds: 7 });
  assert.equal((await request("/api/llm-chat/progress", progress)).data.replayed, true);
  const feedback = { bindingToken, itemKey: "fixture-item", idempotencyKey: "fixture-feedback", feedback: { understandingLevel: 4, focusLevel: 3 } };
  assert.equal((await request("/api/llm-chat/feedback", { ...feedback, feedback: { understandingLevel: 4 } })).status, 400);
  assert.equal((await request("/api/llm-chat/feedback", { ...feedback, studentId: "foreign-student" })).status, 400);
  assert.equal(feedbackInput, undefined);
  assert.equal((await request("/api/llm-chat/feedback", feedback)).status, 200);
  assert.deepEqual(feedbackInput, { studentId: "fixture-student", planId: basis.planId, itemKey: "fixture-item",
    idempotencyKey: "fixture-feedback", feedback: { understandingLevel: 4, focusLevel: 3 } });
  assert.equal((await request("/api/llm-chat/feedback", feedback)).data.replayed, true);
  const payload = { bindingToken, proposalId: "fixture-proposal", expectedBasis: basis };
  assert.equal((await request("/api/llm-chat/confirm", { ...payload, studentId: "foreign-student" })).status, 400);
  assert.equal(confirmation, undefined);
  assert.equal((await request("/api/llm-chat/confirm", { ...payload, bindingToken: "invalid" })).status, 401);
  assert.equal(confirmation, undefined);
  const confirmed = await request("/api/llm-chat/confirm", payload);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmation, { studentId: "fixture-student", proposalId: "fixture-proposal", expectedBasis: basis });
  const message = await request("/api/llm-chat/messages", { bindingToken, messages: [{ role: "user", content: "확인" }] });
  assert.equal(message.status, 503); assert.equal(message.data.code, "LLM_NOT_CONFIGURED");
  assert.equal(providerCalls, 0);
  console.log(JSON.stringify({ result: "통과", checks: 17, actualHttp: true, databaseCalls: 0, providerCalls }));
} finally { await app.close(); }
