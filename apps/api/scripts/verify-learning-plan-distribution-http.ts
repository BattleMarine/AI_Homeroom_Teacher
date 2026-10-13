import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openLearningPlanTestPool, startLearningPlanHttpServer, type LearningPlanHttpServer } from "../test/helpers/learning-plan-http-harness.js";
import { readLearningPlanStateAudit } from "../test/helpers/learning-plan-state-audit.js";
import { checkLearningPlanIndependently } from "../test/helpers/learning-plan-independent-check.js";
import { assertLearningPlanDistribution } from "../test/helpers/learning-plan-distribution-check.js";
import type { createLearningPlanService } from "../src/learning-plan/learning-plan.service.js";
import type { LearningPlanCandidate, LearningPlanProposal } from "../src/learning-plan/learning-plan.repository.js";

type ReadPlan = Awaited<ReturnType<ReturnType<typeof createLearningPlanService>["read"]>>;
type Plan = Omit<ReadPlan, "plan"> & { plan: NonNullable<ReadPlan["plan"]> };
type Card = { kind: "proposed"; candidate: LearningPlanCandidate; proposal: LearningPlanProposal };
const pool = await openLearningPlanTestPool();
const students: string[] = [];
const checks: string[] = [];
let server: LearningPlanHttpServer | undefined;
let stage = "준비", cleaned = false, restarted = false;
const snapshot = async () => (await pool.query("SELECT id,course_id,sequence,duration_seconds,lesson_type FROM lessons ORDER BY id")).rows;
const beforeCatalog = await snapshot();
try {
  const selections = (await pool.query<{ courseId: string; subjectCode: string }>('SELECT id AS "courseId",primary_subject AS "subjectCode" FROM courses ORDER BY id')).rows;
  assert.equal(selections.length, 3);
  const today = seoulDate();
  const deadline = addDays(today, 42);
  const main = await student(), progressStudent = await student(), isolated = await student();
  server = await startLearningPlanHttpServer();

  stage = "43일 최초 생성";
  const initial = await readLearningPlanStateAudit(pool, main);
  const created = await server.request<Card>("/api/learning-plans/proposals/create", { studentId: main, selections, startDate: today, deadlineDate: deadline, availableSecondsPerDay: 14400 });
  assert.equal(created.kind, "proposed");
  assert.equal(created.candidate.items.length, 126);
  assert.equal(created.candidate.items.reduce((sum, item) => sum + item.durationSeconds, 0), 419939);
  const firstDate = created.candidate.assignments[0].date;
  assert.equal(new Set(created.candidate.assignments.filter(segment => segment.date === firstDate).map(segment => segment.subjectCode)).size, 3, "실제 분산 목표에 세 강의가 들어가는 첫날 과목을 편중했습니다.");
  assert.deepEqual(await readLearningPlanStateAudit(pool, main), initial);
  await server.request(`/api/learning-plans/proposals/${created.proposal.proposalId}/confirm`, { studentId: isolated, expectedBasis: created.proposal.expectedBasis }, 404);
  await confirm(main, created);
  assert.equal((await confirm(main, created)).replayed, true);
  let plan = await read(main);
  await inspect(plan);
  checks.push("실제126강43일·기간분산·제안불변·학생격리·중복확정·원본/SQL일치");

  stage = "오늘180분";
  plan = await change(main, plan, { todayTime: { mode: "total", seconds: 10800 } });
  assert.equal(plan.version.candidate.conditions.availableSecondsPerDay, 14400);
  assert.equal(plan.version.candidate.normalizedDays.find(day => day.date === today)?.capacitySeconds, 10800);
  checks.push("오늘180분예외·평소240분보존·기간분산");

  stage = "지정 주말150분";
  const weekends = Array.from({ length: 43 }, (_, n) => addDays(today, n)).filter(date => [0, 6].includes(new Date(date + "T00:00:00Z").getUTCDay())).map(date => ({ date, totalSeconds: 9000 }));
  const overrides = [{ date: today, totalSeconds: 10800 }, ...weekends];
  plan = await change(main, plan, { dateOverrides: overrides });
  assert.deepEqual(plan.version.candidate.conditions.dateOverrides, overrides);
  checks.push("명시된주말날짜150분·예외원본보존·기간분산");

  stage = "기한73일 연장";
  plan = await change(main, plan, { deadlineDate: addDays(today, 72) });
  assert.deepEqual(plan.version.candidate.conditions.dateOverrides, overrides);
  assert.ok(plan.assignments.at(-1)!.date > deadline);
  checks.push("기한연장후전체기간배치변화·날짜예외를반복규칙으로변경하지않음");

  stage = "기한35일 단축";
  plan = await change(main, plan, { deadlineDate: addDays(today, 34), dateOverrides: [] });
  checks.push("35일단축·원본126강과일별상한·누적/주별분산");

  stage = "기간부족 실패와 대안";
  const state = await readLearningPlanStateAudit(pool, main);
  const failed = await server.request<{ kind: string; code: string; alternatives: unknown[] }>(`/api/learning-plans/${plan.plan.planId}/proposals/rebalance`, { studentId: main, expectedBasis: plan.basis, deadlineDate: today, availableSecondsPerDay: 3000 });
  assert.equal(failed.kind, "not-plannable"); assert.equal(failed.code, "INSUFFICIENT_CAPACITY"); assert.ok(failed.alternatives.length);
  assert.deepEqual(await readLearningPlanStateAudit(pool, main), state);
  checks.push("부족한기간실패·대안·현재상태불변");

  stage = "부분 수강·완료·피드백·오래된 이월";
  const old = await server.request<Card>("/api/learning-plans/proposals/create", { studentId: progressStudent, selections, startDate: addDays(today, -2), deadlineDate: deadline, availableSecondsPerDay: 14400 });
  await confirm(progressStudent, old);
  let progressPlan = await read(progressStudent);
  const first = progressPlan.version.candidate.items.find(item => item.itemKey === progressPlan.assignments[0].itemKey)!;
  const completedItem = progressPlan.version.candidate.items.find(item => item.courseId !== first.courseId && item.sequence === Math.min(...progressPlan.version.candidate.items.filter(other => other.courseId === item.courseId).map(other => other.sequence)))!;
  const partial = { studentId: progressStudent, itemKey: first.itemKey, idempotencyKey: randomUUID(), positionSeconds: 2100, spentSeconds: 2100 };
  await server.request(`/api/learning-plans/${progressPlan.plan.planId}/progress`, partial);
  assert.equal((await server.request<{ replayed: boolean }>(`/api/learning-plans/${progressPlan.plan.planId}/progress`, partial)).replayed, true);
  await server.request(`/api/learning-plans/${progressPlan.plan.planId}/progress`, { studentId: progressStudent, itemKey: completedItem.itemKey, idempotencyKey: randomUUID(), positionSeconds: completedItem.durationSeconds, spentSeconds: completedItem.durationSeconds });
  const feedback = { studentId: progressStudent, itemKey: completedItem.itemKey, idempotencyKey: randomUUID(), feedback: { understandingLevel: 4, focusLevel: 3 } };
  await server.request(`/api/learning-plans/${progressPlan.plan.planId}/feedback`, feedback);
  assert.equal((await server.request<{ replayed: boolean }>(`/api/learning-plans/${progressPlan.plan.planId}/feedback`, feedback)).replayed, true);
  progressPlan = await read(progressStudent);
  const completionBefore = progressPlan.completions;
  assert.equal(progressPlan.dailyUsage.find(day => day.studyDate === today)?.spentSeconds, 2100 + completedItem.durationSeconds);
  progressPlan = await change(progressStudent, progressPlan, { fromDate: today });
  const carry = progressPlan.progress.filter(entry => entry.carryoverSinceDate);
  assert.ok(carry.length, "과거 미완료 이월이 실제로 없는 fixture입니다.");
  assert.deepEqual(progressPlan.completions, completionBefore);
  assert.ok(!progressPlan.assignments.some(segment => segment.itemKey === completedItem.itemKey));
  const firstOrdinary = progressPlan.assignments.findIndex(segment => !progressPlan.version.candidate.items.find(item => item.itemKey === segment.itemKey)?.carryoverSinceDate);
  assert.ok(firstOrdinary >= 0);
  const oldest = [...carry].sort((a, b) => a.carryoverSinceDate!.localeCompare(b.carryoverSinceDate!))[0];
  assert.equal(progressPlan.progress.find(entry => entry.itemKey === progressPlan.assignments[0].itemKey)?.carryoverSinceDate, oldest.carryoverSinceDate);
  assert.ok(progressPlan.assignments.slice(firstOrdinary).every(segment => !progressPlan.version.candidate.items.find(item => item.itemKey === segment.itemKey)?.carryoverSinceDate), "이번 실제 입력에서 일반 진도가 준비된 이월을 앞질렀습니다.");
  progressPlan = await change(progressStudent, progressPlan, { deadlineDate: addDays(today, 72), dateOverrides: [{ date: addDays(today, 2), totalSeconds: 0 }, { date: addDays(today, 3), totalSeconds: 0 }] });
  assert.ok(!progressPlan.assignments.some(segment => [addDays(today, 2), addDays(today, 3)].includes(segment.date)));
  for (const entry of carry) assert.equal(progressPlan.progress.find(p => p.itemKey === entry.itemKey)?.carryoverSinceDate, entry.carryoverSinceDate);
  assert.deepEqual(progressPlan.completions, completionBefore);
  checks.push("실제잔여·동일기록재시도·완료/피드백·이월우선/최초일·0시간날·이월뒤일반진도분산");

  stage = "실제 OS 서버 재시작";
  const mainBefore = await read(main), progressBefore = await read(progressStudent);
  const sqlBefore = await readLearningPlanStateAudit(pool, progressStudent);
  const oldPid = server.pid;
  await server.stop(); server = await startLearningPlanHttpServer();
  assert.notEqual(server.pid, oldPid); restarted = true;
  assert.deepEqual(await read(main), mainBefore); assert.deepEqual(await read(progressStudent), progressBefore);
  assert.deepEqual(await readLearningPlanStateAudit(pool, progressStudent), sqlBefore);
  await inspect(await read(main)); await inspect(await read(progressStudent));
  assert.deepEqual(await snapshot(), beforeCatalog);
  checks.push("실제다른PID서버재시작·계획/실제/SQL복구·카탈로그보존");

  async function change(studentId: string, current: Plan, patch: Record<string, unknown>) {
    const before = await readLearningPlanStateAudit(pool, studentId);
    const proposal = await server!.request<Card>(`/api/learning-plans/${current.plan.planId}/proposals/rebalance`, { studentId, expectedBasis: current.basis, ...patch });
    assert.equal(proposal.kind, "proposed");
    assert.deepEqual(await readLearningPlanStateAudit(pool, studentId), before);
    await confirm(studentId, proposal);
    const result = await read(studentId); await inspect(result); return result;
  }
  async function inspect(current: Plan) {
    const candidate = current.version.candidate;
    assert.deepEqual(Object.keys(candidate.conditions).sort(), ["availableSecondsPerDay", "dateOverrides", "deadlineDate", "startDate"]);
    const stored = (await pool.query("SELECT candidate_json FROM learning_plan_versions WHERE id=$1 AND plan_id=$2", [current.plan.currentVersionId, current.plan.planId])).rows[0].candidate_json;
    assert.deepEqual(stored, candidate);
    const catalog = (await pool.query<{ lessonId: string; courseId: string; sequence: number; durationSeconds: number }>('SELECT id AS "lessonId",course_id AS "courseId",sequence,duration_seconds AS "durationSeconds" FROM lessons WHERE lesson_type IN (\'lecture\',\'mock_exam\') ORDER BY course_id,sequence')).rows;
    const segments = (await pool.query('SELECT a.item_key AS "itemKey",a.segment_key AS "segmentKey",i.lesson_id AS "lessonId",l.course_id AS "courseId",i.subject_code AS "subjectCode",to_char(a.scheduled_date,\'YYYY-MM-DD\') AS date,a.item_order AS "order",a.duration_seconds AS "durationSeconds",a.start_offset_seconds AS "startOffsetSeconds",a.end_offset_seconds AS "endOffsetSeconds" FROM learning_plan_assignments a JOIN learning_plan_items i USING(plan_id,item_key) JOIN lessons l ON l.id=i.lesson_id WHERE a.plan_id=$1 AND a.version_id=$2 ORDER BY a.scheduled_date,a.item_order', [current.plan.planId, current.plan.currentVersionId])).rows;
    assert.deepEqual(segments, current.assignments);
    assert.ok(candidate.progressSnapshot);
    const positions = new Map(candidate.progressSnapshot.progress.map(entry => [entry.itemKey, entry.positionSeconds]));
    checkLearningPlanIndependently({ catalog, items: candidate.items.map(item => ({ ...item, positionSeconds: positions.get(item.itemKey) ?? 0 })), segments, capacities: candidate.normalizedDays, dailyUsage: candidate.progressSnapshot.dailyUsage });
    const daily = (await pool.query('SELECT to_char(study_date,\'YYYY-MM-DD\') AS "studyDate",sum(spent_seconds)::int AS "spentSeconds" FROM learning_plan_progress_events WHERE plan_id=$1 GROUP BY study_date ORDER BY study_date', [current.plan.planId])).rows;
    assert.deepEqual(daily, current.dailyUsage);
    const actual = (await pool.query('SELECT plan_id AS "planId",item_key AS "itemKey",position_seconds AS "positionSeconds",to_char(carryover_since_date,\'YYYY-MM-DD\') AS "carryoverSinceDate" FROM learning_plan_items WHERE plan_id=$1 ORDER BY item_key', [current.plan.planId])).rows;
    assert.deepEqual(actual, current.progress);
    const completions = (await pool.query('SELECT c.plan_id AS "planId",c.item_key AS "itemKey",coalesce(f.payload_json,c.payload_json) AS payload,c.completed_at AS "completedAt",c.completion_revision AS "completionRevision",f.submitted_at AS "feedbackSubmittedAt",f.feedback_revision AS "feedbackRevision" FROM learning_plan_completions c LEFT JOIN learning_plan_feedbacks f ON f.plan_id=c.plan_id AND f.item_key=c.item_key WHERE c.plan_id=$1 ORDER BY c.completion_revision', [current.plan.planId])).rows
      .map(row => ({ ...row, completedAt: (row.completedAt as Date).toISOString(), feedbackSubmittedAt: row.feedbackSubmittedAt ? (row.feedbackSubmittedAt as Date).toISOString() : null }));
    assert.deepEqual(completions, current.completions);
    const quality = assertLearningPlanDistribution({ items: candidate.items, assignments: segments, days: candidate.normalizedDays, progress: candidate.progressSnapshot.progress, dailyUsage: candidate.progressSnapshot.dailyUsage });
    console.log(JSON.stringify({ stage, lastAssignedDate: quality.lastAssignedDate, assignedDays: quality.assignedAvailableDays, maxPrefixDeviationSeconds: Math.round(quality.maxPrefixDeviationSeconds), toleranceSeconds: quality.prefixToleranceSeconds, maxEmptyDays: quality.maxEmptyAvailableDays, carryoverSeconds: quality.carryoverSeconds }));
  }
  async function student() { const id = `learning-plan-distribution-${randomUUID()}`; await pool.query("INSERT INTO students(id,status,created_at,updated_at) VALUES($1,'active',now(),now())", [id]); students.push(id); return id; }
  async function confirm(studentId: string, card: Card) { return server!.request<{ replayed: boolean }>(`/api/learning-plans/proposals/${card.proposal.proposalId}/confirm`, { studentId, expectedBasis: card.proposal.expectedBasis }); }
  async function read(studentId: string) { return server!.request<Plan>(`/api/learning-plans?studentId=${encodeURIComponent(studentId)}`); }
} catch {
  console.log(JSON.stringify({ failedStage: stage })); process.exitCode = 1;
} finally {
  try { await server?.stop(); }
  finally {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const studentId of students) {
        const plans = (await client.query("SELECT id FROM learning_plans WHERE student_id=$1", [studentId])).rows.map(row => row.id);
        await client.query("DELETE FROM learning_plan_proposals WHERE student_id=$1", [studentId]);
        await client.query("UPDATE learning_plans SET current_version_id=NULL WHERE student_id=$1", [studentId]);
        for (const table of ["learning_plan_progress_events", "learning_plan_feedbacks", "learning_plan_completion_keys", "learning_plan_completions", "learning_plan_assignments", "learning_plan_items", "learning_plan_versions"]) await client.query(`DELETE FROM ${table} WHERE plan_id=ANY($1::varchar[])`, [plans]);
        await client.query("DELETE FROM learning_plans WHERE student_id=$1", [studentId]); await client.query("DELETE FROM students WHERE id=$1", [studentId]);
      }
      await client.query("COMMIT"); cleaned = true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); await pool.end(); }
  }
  console.log(JSON.stringify({ checks, actualProcessRestart: restarted, fixtureCleaned: cleaned, providerCalls: 0 }));
}
function seoulDate() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(); return ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("-"); }
function addDays(date: string, days: number) { const result = new Date(date + "T00:00:00Z"); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); }
