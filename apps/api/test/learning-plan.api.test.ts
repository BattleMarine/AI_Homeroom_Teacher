import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { createLearningPlanService } from "../src/learning-plan/learning-plan.service.js";
import { learningPlanCatalogHash } from "../src/learning-plan/learning-plan.catalog-basis.js";
import { LearningPlanRepositoryError, type LearningPlanReadBasisResult, type LearningPlanRepository, type LearningPlanSaveProposalInput,
  type LearningPlanVersion, type LearningPlanHeader } from "../src/learning-plan/learning-plan.repository.js";
import type { CourseCatalog } from "../src/course-catalog/course-catalog.types.js";

function catalog(id: string, lengths: number[]): CourseCatalog {
  return { course: { id, title: id, primarySubject: id, includedSubjects: [id], provider: { id: "p", name: "검사" }, instructor: { id: "i", name: "검사" },
    curriculumYear: 2026, lessonCount: lengths.length, orientationCount: 0, contentLessonCount: lengths.length,
    totalDurationSeconds: lengths.reduce((a, b) => a + b, 0), sourceUrl: null, status: "metadata_only" },
  lessons: lengths.map((seconds, i) => ({ id: `${id}-${i}`, courseId: id, sequence: i, lectureNumber: i + 1, title: `${id}-${i}`, lessonType: "lecture",
    subjectAreas: [id], unitNames: [], duration: { display: "", seconds }, sourceUrl: null, playbackTargetId: null })) };
}
/** HTTP/서비스 단위 검사의 저장 경계 대역이다. DB 원자성·복구 통과 근거로 사용하지 않는다. */
function fixture() {
  const catalogs = new Map([catalog("a", [1000, 1000]), catalog("b", [1000, 1000]), catalog("long", [4186])].map((c) => [c.course.id, c]));
  const state: { plan: LearningPlanHeader | null; version: LearningPlanVersion | null; saved: LearningPlanSaveProposalInput[];
    progress: LearningPlanReadBasisResult["progress"]; dailyUsage: LearningPlanReadBasisResult["dailyUsage"]; historicalItems: LearningPlanReadBasisResult["historicalItems"] } = {
    plan: null, version: null, saved: [], progress: [], dailyUsage: [], historicalItems: [],
  };
  const repository: LearningPlanRepository = {
    async readBasis(input) {
      if (input.studentId !== "student" || (input.planId && input.planId !== state.plan?.planId)) throw new LearningPlanRepositoryError("NOT_FOUND", "학생·계획이 없습니다.");
      const catalogSnapshot = input.selections.map((s) => ({ subjectCode: s.subjectCode, catalog: catalogs.get(s.courseId)! }));
      return { ...state, completions: [], catalogSnapshot, basis: { planId: state.plan?.planId ?? null, currentVersionId: state.version?.versionId ?? null,
        planRevision: state.plan?.planRevision ?? 0, completionRevision: state.plan?.completionRevision ?? 0, catalogHash: learningPlanCatalogHash(catalogSnapshot) } };
    },
    async saveProposal(input) { state.saved.push(structuredClone(input)); return { proposalId: "proposal", studentId: input.studentId, targetPlanId: "plan",
      expectedBasis: input.expectedBasis, createdAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-01T00:30:00Z" }; },
    async confirmProposal() { throw new LearningPlanRepositoryError("BASIS_CONFLICT", "오래된 제안"); },
    async recordProgress() { throw new LearningPlanRepositoryError("IDEMPOTENCY_CONFLICT", "재시도 키 충돌"); },
    async recordCompletion() { throw new LearningPlanRepositoryError("INVALID_STATE", "실제 미완료"); },
    async readPlan() { if (!state.plan || !state.version) return undefined;
      return { plan: state.plan, version: state.version, assignments: state.version.candidate.assignments, completions: [],
        progress: state.progress, dailyUsage: state.dailyUsage, historicalItems: state.historicalItems }; },
  };
  const service = createLearningPlanService(repository, () => new Date("2026-10-03T00:00:00Z"));
  function activate() {
    const saved = state.saved.at(-1)!;
    state.plan = { planId: "plan", studentId: "student", currentVersionId: "version", planRevision: 1, completionRevision: 0 };
    state.version = { versionId: "version", planId: "plan", versionNumber: 1, kind: saved.kind, scope: saved.scope, reason: saved.reason, diff: saved.diff,
      candidate: saved.candidate, catalogHash: saved.expectedBasis.catalogHash, createdAt: "2026-10-01T00:00:00Z" };
    state.historicalItems = structuredClone(saved.candidate.items);
  }
  return { repository, service, state, activate };
}
const create = { studentId: "student", selections: [{ subjectCode: "a", courseId: "a" }], startDate: "2026-10-01", deadlineDate: "2026-10-10", availableSecondsPerDay: 1000 };

test("생성은 실제 카탈로그 전체를 배치하고 확인 전 현재 계획은 불변", async () => {
  const f = fixture(); const result = await f.service.create(create);
  assert.equal(result.kind, "proposed"); assert.equal(f.state.plan, null);
  const candidate = f.state.saved[0].candidate;
  assert.equal(f.state.saved[0].studentId, "student");
  assert.deepEqual(candidate.items.map((i) => i.lessonId), ["a-0", "a-1"]);
  assert.equal(candidate.assignments.reduce((s, a) => s + a.durationSeconds, 0), 2000);
  assert.deepEqual(candidate.progressSnapshot, { progress: [], dailyUsage: [] });
});
test("계산 실패는 제안을 저장하지 않으며 계산 확인한 기한 대안만 반환", async () => {
  const f = fixture(); const result = await f.service.create({ ...create, deadlineDate: "2026-10-01" });
  assert.equal(result.kind, "not-plannable"); assert.equal(f.state.saved.length, 0);
  if (result.kind === "not-plannable") { assert.equal(result.shortageSeconds, 1000); assert.ok(result.alternatives.some((a) => a.kind === "extend-deadline")); }
});
test("현재 조회 basis로 새 과목을 추가할 때 새 카탈로그 hash는 서버가 계산", async () => {
  const f = fixture(); await f.service.create(create); f.activate();
  const current = await f.service.read({ studentId: "student" });
  const result = await f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: current.basis, fromDate: "2026-10-03",
    selections: [{ subjectCode: "a", courseId: "a" }, { subjectCode: "b", courseId: "b" }] });
  assert.equal(result.kind, "proposed");
  const saved = f.state.saved.at(-1)!;
  assert.notEqual(saved.expectedBasis.catalogHash, current.basis.catalogHash);
  assert.equal(saved.candidate.items.length, 4);
  assert.equal(saved.candidate.items[0].itemKey, current.version.candidate.items[0].itemKey);
});
test("오늘 추가 시간은 학생 plan 전체 실제 사용을 서버에서 더하고 총한도·실제·잔여 분리", async () => {
  const f = fixture(); await f.service.create(create); f.activate();
  f.state.dailyUsage = [{ studyDate: "2026-10-03", spentSeconds: 600 }];
  const current = await f.service.read({ studentId: "student" });
  await f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: current.basis, todayTime: { mode: "additional", seconds: 1000 } });
  const candidate = f.state.saved.at(-1)!.candidate;
  assert.equal(candidate.normalizedDays[0].capacitySeconds, 1600);
  assert.deepEqual(candidate.progressSnapshot?.dailyUsage, f.state.dailyUsage);
  assert.ok(candidate.assignments.filter((a) => a.date === "2026-10-03").reduce((sum, a) => sum + a.durationSeconds, 0) <= 1000);
});
test("과거 시작일 계획의 최초 이월 날짜와 실제 잔여 위치를 재편성에 보존", async () => {
  const f = fixture(); await f.service.create({ ...create, selections: [{ subjectCode: "long", courseId: "long" }], availableSecondsPerDay: 3000 }); f.activate();
  const key = f.state.version!.candidate.items[0].itemKey;
  f.state.progress = [{ planId: "plan", itemKey: key, positionSeconds: 2100, carryoverSinceDate: null }];
  f.state.dailyUsage = [{ studyDate: "2026-10-03", spentSeconds: 2100 }];
  const current = await f.service.read({ studentId: "student" });
  await f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: current.basis });
  const candidate = f.state.saved.at(-1)!.candidate;
  assert.equal(candidate.items[0].carryoverSinceDate, "2026-10-01");
  assert.equal(candidate.assignments.reduce((s, a) => s + a.durationSeconds, 0), 2086);
  assert.equal(candidate.assignments[0].startOffsetSeconds, 2100);
});
test("명시 이동 충돌은 전체 재편성 없이 저장 불변, 교환은 요청 밖 배치 보존", async () => {
  const f = fixture(); await f.service.create({ ...create, selections: [{ subjectCode: "a", courseId: "a" }, { subjectCode: "b", courseId: "b" }] }); f.activate();
  const current = await f.service.read({ studentId: "student" });
  const before = current.version.candidate.assignments;
  const count = f.state.saved.length;
  const conflict = await f.service.adjust({ studentId: "student", planId: "plan", expectedBasis: current.basis,
    moves: [{ segmentKey: before[0].segmentKey, date: before[1].date, order: before[1].order }] });
  assert.equal(conflict.kind, "conflict"); assert.equal(f.state.saved.length, count);
  const swap = await f.service.adjust({ studentId: "student", planId: "plan", expectedBasis: current.basis,
    moves: [{ segmentKey: before[0].segmentKey, date: before[1].date, order: before[1].order }, { segmentKey: before[1].segmentKey, date: before[0].date, order: before[0].order }] });
  assert.equal(swap.kind, "proposed");
  assert.deepEqual(f.state.saved.at(-1)!.candidate.assignments.slice(2), before.slice(2));
  f.activate();
  const stored = JSON.stringify(f.state.version!.candidate.assignments);
  const sorted = await f.service.read({ studentId: "student" });
  assert.deepEqual(sorted.assignments.map((a) => [a.date, a.order]), [...sorted.assignments].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).map((a) => [a.date, a.order]));
  assert.equal(JSON.stringify(f.state.version!.candidate.assignments), stored);
});
test("제거 이력 강좌의 재등록은 임의 승계·삭제 대신 명시 미지원", async () => {
  const f = fixture(); await f.service.create(create); f.activate();
  const current = await f.service.read({ studentId: "student" });
  await f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: current.basis, selections: [{ subjectCode: "b", courseId: "b" }] });
  f.activate();
  // 저장 경계의 과거 항목 보존을 입력으로 명시한다.
  f.state.historicalItems.push(...current.version.candidate.items);
  const next = await f.service.read({ studentId: "student" });
  await assert.rejects(() => f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: next.basis,
    selections: [{ subjectCode: "a", courseId: "a" }] }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REENROLLMENT_SELECTION_REQUIRED");
});
test("이월 과목 제거·교체의 후보는 현재 항목만 포함하고 과거 진도·이월은 보존", async () => {
  const f = fixture(); await f.service.create(create); f.activate();
  const key = f.state.version!.candidate.items[0].itemKey;
  f.state.progress = [{ planId: "plan", itemKey: key, positionSeconds: 500, carryoverSinceDate: "2026-09-29" }];
  const current = await f.service.read({ studentId: "student" });
  const original = structuredClone(f.state.progress);
  await f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: current.basis, selections: [{ subjectCode: "b", courseId: "b" }] });
  assert.equal(f.state.saved.at(-1)!.candidate.items.some((item) => item.itemKey === key), false);
  assert.equal(f.state.saved.at(-1)!.candidate.carryoverCandidates.some((item) => item.itemKey === key), false);
  assert.deepEqual(f.state.saved.at(-1)!.candidate.progressSnapshot?.progress, [{ itemKey: key, positionSeconds: 500 }]);
  assert.deepEqual(f.state.progress, original);
});

test("마지막 과목 제거는 빈 후보로 명시하고 실제 사용·과거 기록을 보존", async () => {
  const f = fixture(); await f.service.create(create); f.activate();
  f.state.dailyUsage = [{ studyDate: "2026-10-03", spentSeconds: 500 }];
  const current = await f.service.read({ studentId: "student" });
  const original = structuredClone(f.state.historicalItems);
  const result = await f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: current.basis, selections: [] });
  assert.equal(result.kind, "proposed");
  const candidate = f.state.saved.at(-1)!.candidate;
  assert.deepEqual(candidate.items, []); assert.deepEqual(candidate.assignments, []); assert.deepEqual(candidate.catalogSnapshot, []);
  assert.deepEqual(candidate.progressSnapshot?.dailyUsage, f.state.dailyUsage);
  assert.deepEqual(f.state.historicalItems, original);
});

test("HTTP는 구조화 생성·조회·상태 오류를 제공하고 unknown 입력을 조용히 삭제하지 않는다", async () => {
  const f = fixture(); const app = buildApp({ learningPlanRepository: f.repository });
  try {
    const response = await app.inject({ method: "POST", url: "/api/learning-plans/proposals/create", payload: create });
    assert.equal(response.statusCode, 200); assert.equal(response.json().kind, "proposed");
    f.activate();
    const current = await app.inject({ method: "GET", url: "/api/learning-plans?studentId=student" });
    assert.equal(current.statusCode, 200); assert.equal(current.json().basis.planId, "plan");
    const unknown = await app.inject({ method: "POST", url: "/api/learning-plans/proposals/create", payload: { ...create, subjectDeadlines: {} } });
    assert.equal(unknown.statusCode, 400);
    const progress = await app.inject({ method: "POST", url: "/api/learning-plans/plan/progress", payload: { studentId: "student", itemKey: "x", idempotencyKey: "k", positionSeconds: 1, spentSeconds: 1 } });
    assert.equal(progress.statusCode, 409); assert.equal(progress.json().code, "IDEMPOTENCY_CONFLICT");
    const missing = await app.inject({ method: "POST", url: "/api/learning-plans/proposals/create", payload: { ...create, studentId: "other" } });
    assert.equal(missing.statusCode, 404);
    const mismatch = await app.inject({ method: "POST", url: "/api/learning-plans/plan/proposals/rebalance", payload: { studentId: "student", expectedBasis: current.json().basis,
      selections: [{ subjectCode: "fake-subject", courseId: "b" }] } });
    assert.equal(mismatch.statusCode, 422); assert.equal(mismatch.json().code, "SUBJECT_COURSE_MISMATCH");
  } finally { await app.close(); }
});

test("요청 밖 실제 진도 보정은 부분조정에서 충돌, 별도 재편성 뒤 교환 가능", async () => {
  const f = fixture(); await f.service.create({ ...create, selections: [{ subjectCode: "a", courseId: "a" }, { subjectCode: "b", courseId: "b" }], availableSecondsPerDay: 2000 }); f.activate();
  const key = f.state.version!.candidate.items[0].itemKey;
  f.state.progress = [{ planId: "plan", itemKey: key, positionSeconds: 500, carryoverSinceDate: null }];
  const current = await f.service.read({ studentId: "student" });
  const outside = current.version.candidate.assignments.filter((a) => a.itemKey !== key).slice(0, 2);
  const moves = outside.map((a, i) => ({ segmentKey: a.segmentKey, date: outside[1 - i].date, order: outside[1 - i].order }));
  const count = f.state.saved.length;
  const result = await f.service.adjust({ studentId: "student", planId: "plan", expectedBasis: current.basis, moves });
  assert.equal(result.kind, "conflict"); assert.equal(f.state.saved.length, count);
  if (result.kind === "conflict") assert.equal(result.issues[0].code, "EXECUTION_SCOPE_CONFLICT");
  await f.service.rebalance({ studentId: "student", planId: "plan", expectedBasis: current.basis }); f.activate();
  const next = await f.service.read({ studentId: "student" });
  const assignments = next.version.candidate.assignments;
  // 명시적 자기 위치 이동은 재편성 이후 추가 진도 보정 없이 검증할 수 있다.
  assert.equal((await f.service.adjust({ studentId: "student", planId: "plan", expectedBasis: next.basis,
    moves: [{ segmentKey: assignments[0].segmentKey, date: assignments[0].date, order: assignments[0].order }] })).kind, "proposed");
});
test("HTTP 저장 미연결은 mock 대신503, 부족 용량은200의명시실패이며 제안없음", async () => {
  const app = buildApp(); const f = fixture(); const withStorage = buildApp({ learningPlanRepository: f.repository });
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/learning-plans/proposals/create", payload: create })).statusCode, 503);
    const result = await withStorage.inject({ method: "POST", url: "/api/learning-plans/proposals/create", payload: { ...create, deadlineDate: create.startDate } });
    assert.equal(result.statusCode, 200); assert.equal(result.json().kind, "not-plannable"); assert.equal(result.json().proposal, null);
    assert.equal(f.state.saved.length, 0);
  } finally { await app.close(); await withStorage.close(); }
});
