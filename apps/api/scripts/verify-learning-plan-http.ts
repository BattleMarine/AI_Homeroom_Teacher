import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { openLearningPlanTestPool, startLearningPlanHttpServer, type LearningPlanHttpServer } from "../test/helpers/learning-plan-http-harness.js";
import { checkLearningPlanIndependently } from "../test/helpers/learning-plan-independent-check.js";

type Basis = { planId: string | null; currentVersionId: string | null; planRevision: number; completionRevision: number; catalogHash: string };
type Selection = { subjectCode: string; courseId: string };
type Item = { itemKey: string; lessonId: string; courseId: string; subjectCode: string; durationSeconds: number };
type Segment = { itemKey: string; segmentKey: string; lessonId: string; courseId: string; subjectCode: string;
  date: string; order: number; durationSeconds: number; startOffsetSeconds: number; endOffsetSeconds: number };
type Candidate = { items: Item[]; assignments: Segment[]; normalizedDays: Array<{ date: string; capacitySeconds: number }>;
  conditions: Record<string, unknown>; progressSnapshot: { progress: Array<{ itemKey: string; positionSeconds: number }>; dailyUsage: Array<{ studyDate: string; spentSeconds: number }> } };
type Proposal = { kind: "proposed"; candidate: Candidate; proposal: { proposalId: string; expectedBasis: Basis } };
type Plan = { plan: { planId: string; currentVersionId: string; planRevision: number; completionRevision: number }; basis: Basis;
  version: { candidate: Candidate }; assignments: Segment[]; progress: Array<{ itemKey: string; positionSeconds: number; carryoverSinceDate: string | null }>;
  dailyUsage: Array<{ studyDate: string; spentSeconds: number }>; completions: unknown[] };

const pool = await openLearningPlanTestPool();
const students: string[] = [];
const checks: string[] = [];
let server: LearningPlanHttpServer | undefined;
try {
  const selections = (await pool.query<{ courseId: string; subjectCode: string }>(
    'SELECT id AS "courseId",primary_subject AS "subjectCode" FROM courses ORDER BY id',
  )).rows;
  assert.equal(selections.length, 3);
  const today = seoulDate();
  const deadline = addDays(today, 180);
  server = await startLearningPlanHttpServer();
  const primary = await student();
  const isolated = await student();

  const failed = await server.request<{ kind: string; code: string; shortageSeconds: number; alternatives: unknown[] }>(
    "/api/learning-plans/proposals/create", { studentId: isolated, selections, startDate: today, deadlineDate: today, availableSecondsPerDay: 3_000 },
  );
  assert.equal(failed.kind, "not-plannable");
  assert.equal(failed.code, "INSUFFICIENT_CAPACITY");
  assert.equal(failed.shortageSeconds, 419_939 - 3_000);
  assert.ok(failed.alternatives.length > 0);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_proposals WHERE student_id=$1", [isolated])).rows[0].count, 0);
  await server.request("/api/learning-plans/proposals/create", { studentId: isolated, selections: [{ subjectCode: "unrelated-subject", courseId: selections[0].courseId }], startDate: today, deadlineDate: deadline, availableSecondsPerDay: 10_800 }, 422);
  checks.push("부족 용량·대안·실패 제안 미저장");

  // 원본 강의 전체로 제품 API를 직접 호출한다.
  const created = await proposeCreate(primary, selections, addDays(today, -2), deadline, 10_800);
  assert.equal(created.candidate.items.length, 126);
  assert.equal(created.candidate.items.reduce((sum, item) => sum + item.durationSeconds, 0), 419_939);
  assert.equal(created.candidate.assignments.length, 126, "하루 한도에 들어가는 강의를 균형 때문에 나눴습니다.");
  // 긴 기간의 유연 목표는 첫날 세 과목을 모두 채울 의무가 아니다.
  // 같은 날 세 과목을 담는 검사는 별도 기간 분산 HTTP 검증의 43일 실제 입력과 순수 회귀에 둔다.
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plans WHERE student_id=$1", [primary])).rows[0].count, 0);
  await server.request(`/api/learning-plans/proposals/${created.proposal.proposalId}/confirm`, { studentId: isolated, expectedBasis: created.proposal.expectedBasis }, 404);
  await confirm(primary, created);
  let plan = await read(primary);
  await server.request(`/api/learning-plans/${plan.plan.planId}?studentId=${encodeURIComponent(isolated)}`, undefined, 404);
  await independentSql(plan, selections);
  checks.push("실제126강 전체 생성·확정 전 불변·독립SQL 구간/시간/순서");

  const replay = await confirm(primary, created);
  assert.equal(replay.replayed, true);
  const first = [...plan.version.candidate.items].find((item) => item.lessonId === plan.assignments[0].lessonId)!;
  const actual = { studentId: primary, itemKey: first.itemKey, idempotencyKey: randomUUID(), positionSeconds: Math.min(2_100, first.durationSeconds - 1), spentSeconds: 2_100 };
  const recorded = await server.request(`/api/learning-plans/${plan.plan.planId}/progress`, actual);
  const repeated = await server.request<Record<string, unknown>>(`/api/learning-plans/${plan.plan.planId}/progress`, actual);
  assert.equal(repeated.replayed, true);
  const afterActual = await read(primary);
  assert.equal(afterActual.dailyUsage.find((day) => day.studyDate === today)?.spentSeconds, 2_100);
  await server.request(`/api/learning-plans/${plan.plan.planId}/progress`, { ...actual, spentSeconds: 2_101 }, 409);
  assert.deepEqual((await read(primary)).dailyUsage, afterActual.dailyUsage);
  assert.ok(recorded);
  checks.push("실제 부분 수강·당일 시간·재시도 중복 가산 방지");

  const total = await rebalance(primary, afterActual, { fromDate: today, todayTime: { mode: "total", seconds: 3_000 } });
  assert.deepEqual((await read(primary)).assignments, afterActual.assignments);
  await confirm(primary, total);
  plan = await read(primary);
  await independentSql(plan, selections);
  assert.equal(plan.version.candidate.normalizedDays.find((day) => day.date === today)?.capacitySeconds, 3_000);
  assert.ok(plan.assignments.filter((segment) => segment.date === today).reduce((sum, row) => sum + row.durationSeconds, 0) <= 900);
  assert.equal(plan.version.candidate.conditions.availableSecondsPerDay, 10_800);
  const carryover = plan.progress.filter((row) => row.carryoverSinceDate !== null);
  assert.ok(carryover.length > 0, "지난 미완료 일정의 최초 이월일을 저장하지 않았습니다.");
  const additional = await rebalance(primary, plan, { fromDate: today, todayTime: { mode: "additional", seconds: 3_000 } });
  assert.equal(additional.candidate.normalizedDays.find((day) => day.date === today)?.capacitySeconds, 5_100);
  await confirm(primary, additional);
  plan = await read(primary);
  await independentSql(plan, selections);
  for (const previous of carryover) assert.equal(plan.progress.find((row) => row.itemKey === previous.itemKey)?.carryoverSinceDate, previous.carryoverSinceDate);
  checks.push("오늘 총시간·추가 시간 정규화·최초 이월일 보존");

  const swap = await chooseAdjacentSwap(plan, selections);
  assert.ok(swap, "실카탈로그 일정에서 유효한 인접 날짜 교환 입력을 찾지 못했습니다.");
  const partial = await server.request<Proposal>(`/api/learning-plans/${plan.plan.planId}/proposals/adjust`, {
    studentId: primary, expectedBasis: plan.basis, moves: swap.moves,
  });
  assert.equal(partial.kind, "proposed");
  const requested = new Set(swap.moves.map((move) => move.segmentKey));
  for (const previous of plan.assignments.filter((row) => !requested.has(row.segmentKey))) {
    assert.deepEqual(partial.candidate.assignments.find((row) => row.segmentKey === previous.segmentKey), previous, "부분 교환이 요청 밖 일정을 변경했습니다.");
  }
  assert.deepEqual((await read(primary)).assignments, plan.assignments);
  await confirm(primary, partial);
  plan = await read(primary);
  await independentSql(plan, selections);
  const crowded = findCapacityConflict(plan);
  assert.ok(crowded, "가득 찬 날짜로의 충돌 입력을 찾지 못했습니다.");
  const beforeConflict = plan;
  const conflict = await server.request<{ kind: string }>(`/api/learning-plans/${plan.plan.planId}/proposals/adjust`, {
    studentId: primary, expectedBasis: plan.basis, moves: [crowded],
  }, 409);
  assert.ok(conflict);
  assert.deepEqual(await read(primary), beforeConflict, "부분 조정 충돌이 현재 계획을 변경했습니다.");
  const separatelyRebalanced = await rebalance(primary, plan, { fromDate: today, deadlineDate: addDays(deadline, 2) });
  await confirm(primary, separatelyRebalanced);
  plan = await read(primary);
  await independentSql(plan, selections);
  checks.push("인접 날짜 명시 교환·요청 밖 일정 불변·가득 찬 날짜 충돌·별도 재편성");

  const failing = await rebalance(primary, plan, { fromDate: today, deadlineDate: addDays(deadline, 3) });
  const failureName = `verify_learning_plan_fail_${randomUUID().replaceAll("-", "")}`;
  assert.match(plan.plan.planId, /^[a-f0-9-]+$/);
  await pool.query(`CREATE FUNCTION ${failureName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.plan_id='${plan.plan.planId}' THEN RAISE EXCEPTION '통합 검증용 저장 실패'; END IF; RETURN NEW; END $$`);
  try {
    await pool.query(`CREATE TRIGGER ${failureName} BEFORE INSERT ON learning_plan_assignments FOR EACH ROW EXECUTE FUNCTION ${failureName}()`);
    await server.request(`/api/learning-plans/proposals/${failing.proposal.proposalId}/confirm`, { studentId: primary, expectedBasis: failing.proposal.expectedBasis }, 500);
    assert.deepEqual(await read(primary), plan);
    assert.equal((await pool.query("SELECT status FROM learning_plan_proposals WHERE id=$1", [failing.proposal.proposalId])).rows[0].status, "pending");
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${failureName} ON learning_plan_assignments`);
    await pool.query(`DROP FUNCTION IF EXISTS ${failureName}()`);
  }
  await confirm(primary, failing);
  plan = await read(primary);
  await independentSql(plan, selections);
  checks.push("실제 HTTP 확정 중 저장 실패·전체 롤백·동일 제안 재시도 복구");

  // 국어 첫 강의의 실제 4186초는 하루 50분 한도보다 길다.
  const korean = selections.find(({ courseId }) => courseId === "ebsi-2027-suneungwanseong-choeseohee-korean-language-media-all");
  assert.ok(korean, "검증용 실제 국어 강좌가 없습니다.");
  const longStudent = await student();
  const longPlan = await proposeCreate(longStudent, [korean], today, deadline, 3_000);
  const firstLong = longPlan.candidate.items[0];
  assert.equal(firstLong.durationSeconds, 4_186);
  const originalSegments = longPlan.candidate.assignments.filter((row) => row.itemKey === firstLong.itemKey);
  assert.deepEqual(originalSegments.map(({ durationSeconds }) => durationSeconds), [3_000, 1_186]);
  await confirm(longStudent, longPlan);
  let longRead = await read(longStudent);
  await server.request(`/api/learning-plans/${longRead.plan.planId}/progress`, {
    studentId: longStudent, itemKey: firstLong.itemKey, idempotencyKey: randomUUID(), positionSeconds: 2_100, spentSeconds: 2_100,
  });
  longRead = await read(longStudent);
  const longRebalanced = await rebalance(longStudent, longRead, { fromDate: today });
  assert.equal(longRebalanced.candidate.assignments.filter((row) => row.itemKey === firstLong.itemKey).reduce((sum, row) => sum + row.durationSeconds, 0), 2_086);
  await confirm(longStudent, longRebalanced);
  longRead = await read(longStudent);
  await independentSql(longRead, [korean]);
  checks.push("긴 실제 강의 이어보기·예정 50분과 실제 수강 35분의 잔여 계산");

  const stale = await rebalance(longStudent, longRead, { fromDate: today, deadlineDate: addDays(deadline, 1) });
  const finish = { studentId: longStudent, itemKey: firstLong.itemKey, idempotencyKey: randomUUID(), positionSeconds: firstLong.durationSeconds, spentSeconds: 2_086 };
  await server.request(`/api/learning-plans/${longRead.plan.planId}/progress`, finish);
  await server.request(`/api/learning-plans/${longRead.plan.planId}/progress`, finish);
  longRead = await read(longStudent);
  assert.equal(longRead.dailyUsage.find((day) => day.studyDate === today)?.spentSeconds, 4_186);
  await server.request(`/api/learning-plans/proposals/${stale.proposal.proposalId}/confirm`, { studentId: longStudent, expectedBasis: stale.proposal.expectedBasis }, 409);
  const feedback = { studentId: longStudent, itemKey: firstLong.itemKey, idempotencyKey: randomUUID(), feedback: { understandingLevel: 4, focusLevel: 4 } };
  await server.request(`/api/learning-plans/${longRead.plan.planId}/feedback`, feedback);
  const feedbackReplay = await server.request<{ replayed: boolean }>(`/api/learning-plans/${longRead.plan.planId}/feedback`, { ...feedback, idempotencyKey: randomUUID() });
  assert.equal(feedbackReplay.replayed, true);
  await server.request(`/api/learning-plans/${longRead.plan.planId}/feedback`, { ...feedback, idempotencyKey: randomUUID(), feedback: { understandingLevel: 3, focusLevel: 4 } }, 409);
  longRead = await read(longStudent);
  assert.equal(longRead.dailyUsage.find((day) => day.studyDate === today)?.spentSeconds, 4_186);
  const finalLong = await rebalance(longStudent, longRead, { fromDate: today });
  assert.ok(!finalLong.candidate.assignments.some((row) => row.itemKey === firstLong.itemKey));
  assert.ok(!finalLong.candidate.assignments.some((row) => row.date === today), "실제 수강이 새 총한도보다 클 때 신규 배정했습니다.");
  await confirm(longStudent, finalLong);
  longRead = await read(longStudent);
  await independentSql(longRead, [korean]);
  checks.push("실제 완료·첫 피드백·중복/다른 피드백 충돌·실행 revision 충돌");

  const math = selections.find(({ courseId }) => courseId === "ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all");
  const english = selections.find(({ courseId }) => courseId === "ebsi-2027-suneungwanseong-kimjehee-english-all");
  assert.ok(math && english, "검증용 실제 수학·영어 강좌가 없습니다.");
  const added = await rebalance(longStudent, longRead, { fromDate: today, selections: [korean, math] });
  const concurrent = await Promise.all([confirm(longStudent, added), confirm(longStudent, added)]);
  assert.equal(concurrent.filter(({ replayed }) => replayed).length, 1);
  longRead = await read(longStudent);
  await independentSql(longRead, [korean, math]);
  const preserved = { progress: longRead.progress, completions: longRead.completions, dailyUsage: longRead.dailyUsage };
  const removed = await rebalance(longStudent, longRead, { fromDate: today, selections: [math] });
  await confirm(longStudent, removed);
  longRead = await read(longStudent);
  await independentSql(longRead, [math]);
  assert.deepEqual(longRead.completions, preserved.completions);
  assert.deepEqual(longRead.dailyUsage, preserved.dailyUsage);
  assert.equal(longRead.progress.find((row) => row.itemKey === firstLong.itemKey)?.positionSeconds, firstLong.durationSeconds);
  const replaced = await rebalance(longStudent, longRead, { fromDate: today, selections: [english], availableSecondsPerDay: 4_000, deadlineDate: addDays(deadline, 10) });
  await confirm(longStudent, replaced);
  longRead = await read(longStudent);
  await independentSql(longRead, [english]);
  await server.request(`/api/learning-plans/${longRead.plan.planId}/proposals/rebalance`, { studentId: longStudent, expectedBasis: longRead.basis, selections: [english, korean] }, 422);
  assert.deepEqual((await read(longStudent)).assignments, longRead.assignments);
  const empty = await rebalance(longStudent, longRead, { fromDate: today, selections: [] });
  assert.equal(empty.candidate.items.length, 0);
  assert.equal(empty.candidate.assignments.length, 0);
  await confirm(longStudent, empty);
  const emptyRead = await read(longStudent);
  await independentSql(emptyRead, []);
  assert.deepEqual(emptyRead.dailyUsage, longRead.dailyUsage);
  assert.deepEqual(emptyRead.completions, longRead.completions);
  longRead = emptyRead;
  checks.push("과목 추가·제거·교체·조건 변경·과거 기록 보존·재등록 미결 명시");

  const beforeRestart = await read(primary);
  const longBeforeRestart = await read(longStudent);
  const firstPid = server.pid;
  await server.stop();
  server = await startLearningPlanHttpServer();
  assert.notEqual(server.pid, firstPid);
  assert.deepEqual(await read(primary), beforeRestart);
  assert.deepEqual(await read(longStudent), longBeforeRestart);
  await independentSql(await read(primary), selections);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plans WHERE student_id=$1", [isolated])).rows[0].count, 0);
  checks.push("실제 OS 서버 프로세스 재시작·상태 복구·학생 격리");
  console.log(JSON.stringify({ passed: checks, originalLessons: 126, originalSeconds: 419_939, osProcessRestart: true }, null, 2));

  async function student() {
    const id = `learning-plan-http-${randomUUID()}`;
    await pool.query("INSERT INTO students(id,status,created_at,updated_at) VALUES($1,'active',now(),now())", [id]);
    students.push(id); return id;
  }
  async function proposeCreate(studentId: string, selected: Selection[], startDate: string, deadlineDate: string, availableSecondsPerDay: number) {
    const result = await server!.request<Proposal>("/api/learning-plans/proposals/create", { studentId, selections: selected, startDate, deadlineDate, availableSecondsPerDay });
    assert.equal(result.kind, "proposed"); return result;
  }
  async function confirm(studentId: string, proposal: Proposal) {
    return server!.request<{ replayed: boolean }>(`/api/learning-plans/proposals/${proposal.proposal.proposalId}/confirm`, { studentId, expectedBasis: proposal.proposal.expectedBasis });
  }
  async function read(studentId: string): Promise<Plan> {
    return server!.request<Plan>(`/api/learning-plans?studentId=${encodeURIComponent(studentId)}`);
  }
  async function rebalance(studentId: string, current: Plan, patch: Record<string, unknown>) {
    const result = await server!.request<Proposal>(`/api/learning-plans/${current.plan.planId}/proposals/rebalance`, { studentId, expectedBasis: current.basis, ...patch });
    assert.equal(result.kind, "proposed"); return result;
  }
} finally {
  try { await server?.stop(); }
  finally {
    try { await cleanup(pool, students); }
    finally { await pool.end(); }
  }
}

async function independentSql(plan: Plan, selections: Selection[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const version = (await client.query("SELECT candidate_json FROM learning_plan_versions WHERE id=$1 AND plan_id=$2", [plan.plan.currentVersionId, plan.plan.planId])).rows[0];
    assert.deepEqual(version.candidate_json, plan.version.candidate);
    const catalog = (await client.query<{ lessonId: string; courseId: string; sequence: number; durationSeconds: number }>(
      'SELECT id AS "lessonId",course_id AS "courseId",sequence,duration_seconds AS "durationSeconds" FROM lessons WHERE course_id=ANY($1::varchar[]) AND lesson_type IN (\'lecture\',\'mock_exam\') ORDER BY course_id,sequence',
      [selections.map(({ courseId }) => courseId)],
    )).rows;
    const segments = (await client.query<Segment>(
      'SELECT a.item_key AS "itemKey",a.segment_key AS "segmentKey",i.lesson_id AS "lessonId",l.course_id AS "courseId",i.subject_code AS "subjectCode",to_char(a.scheduled_date,\'YYYY-MM-DD\') AS date,a.item_order AS "order",a.duration_seconds AS "durationSeconds",a.start_offset_seconds AS "startOffsetSeconds",a.end_offset_seconds AS "endOffsetSeconds" FROM learning_plan_assignments a JOIN learning_plan_items i USING(plan_id,item_key) JOIN lessons l ON l.id=i.lesson_id WHERE a.plan_id=$1 AND a.version_id=$2 ORDER BY a.scheduled_date,a.item_order',
      [plan.plan.planId, plan.plan.currentVersionId],
    )).rows;
    assert.deepEqual(segments, plan.assignments);
    const positions = new Map(plan.version.candidate.progressSnapshot.progress.map(({ itemKey, positionSeconds }) => [itemKey, positionSeconds]));
    checkLearningPlanIndependently({ catalog, segments, items: plan.version.candidate.items.map(({ itemKey, lessonId }) => ({ itemKey, lessonId, positionSeconds: positions.get(itemKey) ?? 0 })), capacities: plan.version.candidate.normalizedDays, dailyUsage: plan.version.candidate.progressSnapshot.dailyUsage });
    const daily = (await client.query<{ studyDate: string; spentSeconds: number }>(
      'SELECT to_char(study_date,\'YYYY-MM-DD\') AS "studyDate",sum(spent_seconds)::int AS "spentSeconds" FROM learning_plan_progress_events WHERE plan_id=$1 GROUP BY study_date ORDER BY study_date', [plan.plan.planId],
    )).rows;
    assert.deepEqual(daily, plan.dailyUsage);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function chooseAdjacentSwap(plan: Plan, selections: Selection[]) {
  const catalog = (await pool.query<{ lessonId: string; courseId: string; sequence: number; durationSeconds: number }>(
    'SELECT id AS "lessonId",course_id AS "courseId",sequence,duration_seconds AS "durationSeconds" FROM lessons WHERE course_id=ANY($1::varchar[]) AND lesson_type IN (\'lecture\',\'mock_exam\') ORDER BY course_id,sequence',
    [selections.map(({ courseId }) => courseId)],
  )).rows;
  const position = new Map(plan.version.candidate.progressSnapshot.progress.map((row) => [row.itemKey, row.positionSeconds]));
  const rows = plan.assignments;
  for (const first of rows) for (const second of rows) {
    if (second.date !== addDays(first.date, 1) || first.courseId === second.courseId) continue;
    const segments = rows.map((row) => row.segmentKey === first.segmentKey ? { ...row, date: second.date, order: second.order }
      : row.segmentKey === second.segmentKey ? { ...row, date: first.date, order: first.order } : row);
    try {
      checkLearningPlanIndependently({ catalog, segments,
        items: plan.version.candidate.items.map(({ itemKey, lessonId }) => ({ itemKey, lessonId, positionSeconds: position.get(itemKey) ?? 0 })),
        capacities: plan.version.candidate.normalizedDays, dailyUsage: plan.version.candidate.progressSnapshot.dailyUsage });
    } catch { continue; }
    return { moves: [{ segmentKey: first.segmentKey, date: second.date, order: second.order },
      { segmentKey: second.segmentKey, date: first.date, order: first.order }] };
  }
}

function findCapacityConflict(plan: Plan) {
  for (const day of plan.version.candidate.normalizedDays) {
    const rows = plan.assignments.filter((row) => row.date === day.date);
    if (!rows.length) continue;
    const current = rows.reduce((sum, row) => sum + row.durationSeconds, 0);
    const used = plan.version.candidate.progressSnapshot.dailyUsage.find((row) => row.studyDate === day.date)?.spentSeconds ?? 0;
    const source = plan.assignments.find((row) => row.date !== day.date && row.durationSeconds > Math.max(0, day.capacitySeconds - used - current));
    if (source) return { segmentKey: source.segmentKey, date: day.date, order: Math.max(...rows.map((row) => row.order)) + 1 };
  }
}

function seoulDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
async function cleanup(pool: Pool, students: string[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const studentId of students) {
      const plans = (await client.query("SELECT id FROM learning_plans WHERE student_id=$1", [studentId])).rows.map(({ id }) => id);
      await client.query("DELETE FROM learning_plan_proposals WHERE student_id=$1", [studentId]);
      await client.query("UPDATE learning_plans SET current_version_id=NULL WHERE student_id=$1", [studentId]);
      for (const table of ["learning_plan_progress_events", "learning_plan_feedbacks", "learning_plan_completion_keys", "learning_plan_completions", "learning_plan_assignments", "learning_plan_items", "learning_plan_versions"]) {
        await client.query(`DELETE FROM ${table} WHERE plan_id=ANY($1::varchar[])`, [plans]);
      }
      await client.query("DELETE FROM learning_plans WHERE student_id=$1", [studentId]);
      await client.query("DELETE FROM students WHERE id=$1", [studentId]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
