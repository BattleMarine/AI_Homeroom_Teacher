import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { LearningPlanBasis, LearningPlanCandidate, LearningPlanProposal, LearningPlanReadResult } from "../src/learning-plan/learning-plan.repository.js";
import { checkLearningPlanIndependently } from "../test/helpers/learning-plan-independent-check.js";
import { readLearningPlanStateAudit } from "../test/helpers/learning-plan-state-audit.js";
import { openLearningPlanTestPool, startLearningPlanHttpServer, type LearningPlanHttpServer } from "../test/helpers/learning-plan-http-harness.js";

type Plan = LearningPlanReadResult & { basis: LearningPlanBasis };
type Card = { proposal: LearningPlanProposal; candidate: LearningPlanCandidate; diff: unknown; warnings: unknown[] };
type Reply = { message: Message; proposalCards: Card[]; toolResults: Array<{ tool: string; kind: string; code?: string }> };
type Selection = { courseId: string; subjectCode: string };
type Message = { role: "user" | "assistant"; content: string };

// 기본 회귀에는 포함하지 않는다. 비용이 발생하는 제공사 검증은 명시적으로 실행한다.
assert.equal(process.env.VERIFY_LLM_ALLOW_PROVIDER, "1", "실제 제공사 검증의 명시 허용이 필요합니다.");
assert.ok(process.env.MINDLOGIC_API_KEY && process.env.LLM_MODEL, "로컬 제공사 설정이 필요합니다.");
const providerBudget = Number(process.env.VERIFY_LLM_PROVIDER_BUDGET ?? "40");
assert.ok(Number.isSafeInteger(providerBudget) && providerBudget >= 6 && providerBudget <= 40, "이번 실행의 남은 제공사 요청 한도는 6~40회여야 합니다.");
const phase = process.env.VERIFY_LLM_PHASE ?? "all";
assert.ok(phase === "all" || phase === "remaining", "검증 범위는 all 또는 remaining입니다.");
const setupStages = new Set(["최초 생성", "오늘 총시간", "추가시간", "지속 시간 변경", "명시 부분 교환"]);
let setupMoves: Array<{ segmentKey: string; date: string; order: number }> = [];
const pool = await openLearningPlanTestPool();
const students: string[] = [];
const passed: string[] = [];
let server: LearningPlanHttpServer | undefined;
let bindingToken = "";
let history: Message[] = [];
let stage = "준비";
let stats: unknown;
let cleanupCompleted = false;
let restarted = false;
try {
  const selections = (await pool.query<Selection>('SELECT id AS "courseId",primary_subject AS "subjectCode" FROM courses ORDER BY id')).rows;
  const math = selections.find((s) => s.subjectCode === "미적분");
  const english = selections.find((s) => s.subjectCode === "영어");
  const korean = selections.find((s) => s.subjectCode === "국어");
  assert.ok(math && english && korean && selections.length === 3, "실제 EBSi 세 강좌가 필요합니다.");
  const catalogBefore = await catalogSnapshot(pool);
  const today = seoulDate();
  const deadline = addDays(today, 240);
  const primary = await student();
  const isolated = await student();
  server = await startLearningPlanHttpServer();
  bindingToken = (await bind(primary)).bindingToken;
  const isolatedBinding = (await bind(isolated)).bindingToken;
  const initial = await readLearningPlanStateAudit(pool, primary);

  stage = "최초 생성";
  const created = await proposal(`수학 강좌 ${math.courseId}와 영어 강좌 ${english.courseId}의 전체 강의를 계획해줘. 시작일은 ${addDays(today, -2)}, 마감일은 ${deadline}, 평소 하루 100분이야. 계획은 제안만 해줘.`);
  assert.deepEqual(await readLearningPlanStateAudit(pool, primary), initial, "제안이 현재 학습 상태를 변경했습니다.");
  assert.equal(created.candidate.items.length, 91);
  await checkCandidate(created.candidate, [math, english]);
  await server.request("/api/llm-chat/confirm", { bindingToken: isolatedBinding, proposalId: created.proposal.proposalId, expectedBasis: created.proposal.expectedBasis }, 404);
  const confirmed = await confirm(created);
  assert.equal(confirmed.replayed, false);
  assert.equal((await confirm(created)).replayed, true);
  let plan = await read(primary);
  await checkStored(plan, [math, english]);
  passed.push("실모델 생성·실제91강·제안 전 불변·학생 격리·명시 확정·중복 확정");

  const first = plan.version.candidate.items.find((i) => i.lessonId === plan.assignments[0].lessonId)!;
  const actual = { studentId: primary, itemKey: first.itemKey, idempotencyKey: randomUUID(), positionSeconds: 2100, spentSeconds: 2100 };
  await server.request(`/api/learning-plans/${plan.plan.planId}/progress`, actual);
  await server.request(`/api/learning-plans/${plan.plan.planId}/progress`, actual);
  assert.equal((await read(primary)).dailyUsage.find((d) => d.studyDate === today)?.spentSeconds, 2100);

  stage = "오늘 총시간";
  const total = await unchangedProposal(primary, "오늘만 공부 시간이 총 50분밖에 없어. 평소 하루 100분은 유지하고 남은 전체 진도를 기존 마감일까지 재편성해줘.");
  assert.equal(total.candidate.normalizedDays.find((d) => d.date === today)?.capacitySeconds, 3000);
  assert.equal(total.candidate.conditions.availableSecondsPerDay, 6000);
  assert.ok(total.candidate.assignments.filter((s) => s.date === today).reduce((sum, s) => sum + s.durationSeconds, 0) <= 900);
  await confirm(total); plan = await read(primary); await checkStored(plan, [math, english]);
  const carry = plan.progress.filter((p) => p.carryoverSinceDate);
  assert.ok(carry.length > 0, "이월 기준일을 보존하지 않았습니다.");
  passed.push("오늘50분 총한도·실제35분 차감·평소100분 유지·이월 기록");

  stage = "추가시간";
  const additional = await unchangedProposal(primary, "지금부터 오늘 공부할 시간을 50분 더 확보했어. 이미 공부한 시간에 추가하는 50분이고 평소 시간은 유지해서 다시 재편성해줘.");
  assert.equal(additional.candidate.normalizedDays.find((d) => d.date === today)?.capacitySeconds, 5100);
  assert.equal(additional.candidate.conditions.availableSecondsPerDay, 6000);
  await confirm(additional); plan = await read(primary); await checkStored(plan, [math, english]);
  passed.push("추가50분 서버 덧셈·총한도85분·실제 진행 중복 가산 방지");

  stage = "지속 시간 변경";
  const reduced = await unchangedProposal(primary, "앞으로 평소 공부 시간을 하루 80분으로 줄여줘. 오늘의 예외 총시간은 유지하고, 기존 마감일까지 남은 진도를 전체 재편성해줘.");
  assert.equal(reduced.candidate.conditions.availableSecondsPerDay, 4800);
  await confirm(reduced); plan = await read(primary); await checkStored(plan, [math, english]);
  passed.push("지속80분 변경·오늘 예외 유지");

  stage = "명시 부분 교환";
  const swap = await chooseSwap(plan, [math, english]);
  assert.ok(swap, "독립 검사에서 유효한 부분 교환을 찾지 못했습니다.");
  setupMoves = swap;
  const swapped = await unchangedProposal(primary, `전체 재편성 대신 다음 두 예정 구간만 정확히 교환해줘. ${swap[0].segmentKey}를 ${swap[0].date}의 순서 ${swap[0].order}로, ${swap[1].segmentKey}를 ${swap[1].date}의 순서 ${swap[1].order}로 이동하고 나머지 배치는 그대로 유지해줘.`);
  const requested = new Set(swap.map((m) => m.segmentKey));
  for (const segment of plan.assignments.filter((s) => !requested.has(s.segmentKey))) assert.deepEqual(swapped.candidate.assignments.find((s) => s.segmentKey === segment.segmentKey), segment);
  await confirm(swapped); plan = await read(primary); await checkStored(plan, [math, english]);
  passed.push("실모델 명시 교환·요청 밖 일정 불변");

  stage = "완료와 이월 재편성";
  await server.request(`/api/learning-plans/${plan.plan.planId}/progress`, { studentId: primary, itemKey: first.itemKey, idempotencyKey: randomUUID(), positionSeconds: first.durationSeconds, spentSeconds: first.durationSeconds - 2100 });
  await server.request(`/api/learning-plans/${plan.plan.planId}/feedback`, { studentId: primary, itemKey: first.itemKey, idempotencyKey: randomUUID(), feedback: { understandingLevel: 4, focusLevel: 4 } });
  const completed = await read(primary);
  const rebalanced = await unchangedProposal(primary, `밀린 진도를 오늘 ${today}부터 기존 마감일 ${deadline}까지 남은 기간에 다시 나눠줘. 완료와 피드백, 평소 하루 80분 및 오늘 시간 예외를 유지해줘.`);
  assert.ok(!rebalanced.candidate.assignments.some((s) => s.itemKey === first.itemKey));
  await confirm(rebalanced); plan = await read(primary); await checkStored(plan, [math, english]);
  assert.deepEqual(plan.completions, completed.completions);
  for (const old of carry) assert.equal(plan.progress.find((p) => p.itemKey === old.itemKey)?.carryoverSinceDate, old.carryoverSinceDate);
  passed.push("이월 전체 재편성·완료/피드백·최초 이월일 보존");

  stage = "과목 추가";
  const added = await unchangedProposal(primary, `국어도 추가해줘. 국어 강좌는 ${korean.courseId}야. 기존 수학·영어와 완료·피드백을 유지해서 같은 마감일과 시간 조건으로 전체 계획에 통합해줘.`);
  assert.equal(added.candidate.items.length, 126);
  assert.equal(added.candidate.items.reduce((sum, i) => sum + i.durationSeconds, 0), 419939);
  await checkCandidate(added.candidate, selections);
  await confirm(added); plan = await read(primary); await checkStored(plan, selections);
  assert.deepEqual(plan.completions, completed.completions);
  passed.push("국어 추가·기존 두 과목 보존·실제126강419939초");

  stage = "모호한 요청";
  const beforeAmbiguous = await readLearningPlanStateAudit(pool, isolated);
  const priorBinding = bindingToken; const priorHistory = history;
  bindingToken = isolatedBinding; history = [];
  const ambiguous = await turn("학습 계획을 만들어줘.");
  assert.equal(ambiguous.proposalCards.length, 0);
  assert.ok(ambiguous.message.content.includes("?") || /알려|선택|필요/.test(ambiguous.message.content));
  assert.deepEqual(await readLearningPlanStateAudit(pool, isolated), beforeAmbiguous);
  bindingToken = priorBinding; history = priorHistory;
  passed.push("모호한 요청 질문·학생 간 대화/학습 상태 분리");

  stage = "실제 프로세스 재시작";
  stats = await server.request("/api/llm-chat/runtime-stats");
  const beforeRestart = await read(primary);
  const beforeSql = await readLearningPlanStateAudit(pool, primary);
  const oldPid = server.pid;
  await server.stop(); server = await startLearningPlanHttpServer();
  assert.notEqual(server.pid, oldPid);
  assert.deepEqual(await read(primary), beforeRestart);
  assert.deepEqual(await readLearningPlanStateAudit(pool, primary), beforeSql);
  bindingToken = (await bind(primary)).bindingToken;
  await checkStored(await read(primary), selections);
  restarted = true;
  assert.deepEqual(await catalogSnapshot(pool), catalogBefore);
  passed.push("실제 OS 서버 재시작·HTTP/SQL 복구·원본 카탈로그 보존");

  async function student() {
    const id = `learning-plan-llm-${randomUUID()}`;
    await pool.query("INSERT INTO students(id,status,created_at,updated_at) VALUES($1,'active',now(),now())", [id]);
    students.push(id); return id;
  }
  async function bind(studentId: string) { return server!.request<{ bindingToken: string }>("/api/llm-chat/bind", { studentId }); }
  async function read(studentId: string) { return server!.request<Plan>(`/api/learning-plans?studentId=${encodeURIComponent(studentId)}`); }
  async function confirm(card: Card) { return server!.request<{ replayed: boolean }>("/api/llm-chat/confirm", { bindingToken, proposalId: card.proposal.proposalId, expectedBasis: card.proposal.expectedBasis }); }
  async function turn(content: string) {
    const before = await server!.request<{ attempts: number }>("/api/llm-chat/runtime-stats");
    assert.ok(Number.isSafeInteger(before.attempts) && before.attempts + 6 <= providerBudget, "실제 제공사 요청 잔여 상한을 초과할 수 있어 중단합니다.");
    const messages: Message[] = [...history, { role: "user", content }];
    const reply = await server!.request<Reply>("/api/llm-chat/messages", { bindingToken, messages }, 200, 70000);
    history = [...messages, reply.message];
    const after = await server!.request<{ attempts: number }>("/api/llm-chat/runtime-stats");
    console.log(JSON.stringify({ stage, providerAttempts: after.attempts }));
    return reply;
  }
  async function proposal(content: string) {
    // 이미 실모델로 통과한 앞 단계의 상태는 직접 제품 API로 준비한다. 모델 결과를 대역으로 반환하지 않는다.
    if (phase === "remaining" && setupStages.has(stage)) {
      if (stage === "최초 생성") return server!.request<Card>("/api/learning-plans/proposals/create", { studentId: primary, selections: [math, english], startDate: addDays(today, -2), deadlineDate: deadline, availableSecondsPerDay: 6000 });
      const current = await read(primary);
      const root = `/api/learning-plans/${current.plan.planId}/proposals/`;
      const patch = stage === "오늘 총시간" ? { todayTime: { mode: "total", seconds: 3000 } }
        : stage === "추가시간" ? { todayTime: { mode: "additional", seconds: 3000 } }
        : stage === "지속 시간 변경" ? { availableSecondsPerDay: 4800 }
        : { moves: setupMoves };
      return server!.request<Card>(root + (stage === "명시 부분 교환" ? "adjust" : "rebalance"), { studentId: primary, expectedBasis: current.basis, ...patch });
    }
    const reply = await turn(content); assert.equal(reply.proposalCards.length, 1, "실제 도구 제안 카드가 없습니다."); return reply.proposalCards[0];
  }
  async function unchangedProposal(studentId: string, content: string) {
    const before = await readLearningPlanStateAudit(pool, studentId); const card = await proposal(content);
    assert.deepEqual(await readLearningPlanStateAudit(pool, studentId), before, "제안이 학습 상태를 변경했습니다."); return card;
  }
} catch (error) {
  // 대화·결속 토큰·제공사 원문·SQL 값은 출력하지 않는다.
  const safeCode = error instanceof Error ? /오류 코드: ([A-Z_]+)/.exec(error.message)?.[1] : undefined;
  console.error(JSON.stringify({ failedStage: stage, errorType: error instanceof assert.AssertionError ? "검증 불일치" : "실행 실패", ...(safeCode ? { code: safeCode } : {}) }));
  process.exitCode = 1;
} finally {
  try {
    if (server && !stats) { try { stats = await server.request("/api/llm-chat/runtime-stats"); } catch { /* 종료된 서버의 값은 추정하지 않는다. */ } }
    await server?.stop();
  } finally {
    try { await cleanup(pool, students); cleanupCompleted = true; }
    finally { await pool.end(); }
  }
  console.log(JSON.stringify({ phase, passed: passed.map((label, index) => phase === "remaining" && index < 5 ? `직접 API 준비: ${label.replaceAll("실모델", "")}` : label), provider: stats ?? null, osProcessRestart: restarted, fixtureCleaned: cleanupCompleted }, null, 2));
}

async function sourceCatalog(selected: Selection[]) {
  return (await pool.query<{ lessonId: string; courseId: string; sequence: number; durationSeconds: number }>(
    'SELECT id AS "lessonId",course_id AS "courseId",sequence,duration_seconds AS "durationSeconds" FROM lessons WHERE course_id=ANY($1::varchar[]) AND lesson_type IN (\'lecture\',\'mock_exam\') ORDER BY course_id,sequence', [selected.map((s) => s.courseId)],
  )).rows;
}
async function checkCandidate(candidate: LearningPlanCandidate, selected: Selection[]) {
  assert.ok(candidate.progressSnapshot);
  const positions = new Map(candidate.progressSnapshot.progress.map((p) => [p.itemKey, p.positionSeconds]));
  return checkLearningPlanIndependently({ catalog: await sourceCatalog(selected), segments: candidate.assignments,
    items: candidate.items.map((i) => ({ itemKey: i.itemKey, lessonId: i.lessonId, positionSeconds: positions.get(i.itemKey) ?? 0 })),
    capacities: candidate.normalizedDays, dailyUsage: candidate.progressSnapshot.dailyUsage });
}
async function checkStored(plan: Plan, selected: Selection[]) {
  const version = (await pool.query("SELECT candidate_json FROM learning_plan_versions WHERE id=$1 AND plan_id=$2", [plan.plan.currentVersionId, plan.plan.planId])).rows[0];
  assert.deepEqual(version.candidate_json, plan.version.candidate);
  const stored = (await pool.query('SELECT segment_key AS "segmentKey",item_key AS "itemKey",to_char(scheduled_date,\'YYYY-MM-DD\') AS date,item_order AS "order",duration_seconds AS "durationSeconds",start_offset_seconds AS "startOffsetSeconds",end_offset_seconds AS "endOffsetSeconds" FROM learning_plan_assignments WHERE plan_id=$1 AND version_id=$2 ORDER BY scheduled_date,item_order', [plan.plan.planId, plan.plan.currentVersionId])).rows;
  assert.deepEqual(stored, plan.assignments.map(({ segmentKey, itemKey, date, order, durationSeconds, startOffsetSeconds, endOffsetSeconds }) => ({ segmentKey, itemKey, date, order, durationSeconds, startOffsetSeconds, endOffsetSeconds })));
  const daily = (await pool.query('SELECT to_char(study_date,\'YYYY-MM-DD\') AS "studyDate",sum(spent_seconds)::int AS "spentSeconds" FROM learning_plan_progress_events WHERE plan_id=$1 GROUP BY study_date ORDER BY study_date', [plan.plan.planId])).rows;
  assert.deepEqual(daily, plan.dailyUsage);
  await checkCandidate(plan.version.candidate, selected);
}
async function chooseSwap(plan: Plan, selected: Selection[]) {
  const catalog = await sourceCatalog(selected);
  const snapshot = plan.version.candidate.progressSnapshot;
  assert.ok(snapshot);
  const positions = new Map(snapshot.progress.map((p) => [p.itemKey, p.positionSeconds]));
  for (const first of plan.assignments) for (const second of plan.assignments) {
    if (second.date !== addDays(first.date, 1) || first.courseId === second.courseId) continue;
    const assignments = plan.assignments.map((s) => s.segmentKey === first.segmentKey ? { ...s, date: second.date, order: second.order } : s.segmentKey === second.segmentKey ? { ...s, date: first.date, order: first.order } : s);
    try { checkLearningPlanIndependently({ catalog, segments: assignments,
      items: plan.version.candidate.items.map((i) => ({ itemKey: i.itemKey, lessonId: i.lessonId, positionSeconds: positions.get(i.itemKey) ?? 0 })),
      capacities: plan.version.candidate.normalizedDays, dailyUsage: snapshot.dailyUsage }); } catch { continue; }
    return [{ segmentKey: first.segmentKey, date: second.date, order: second.order }, { segmentKey: second.segmentKey, date: first.date, order: first.order }];
  }
}
async function catalogSnapshot(testPool: Pool) { return (await testPool.query("SELECT id,course_id,sequence,duration_seconds,lesson_type FROM lessons ORDER BY id")).rows; }
function seoulDate() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(); return ["year", "month", "day"].map((t) => parts.find((p) => p.type === t)!.value).join("-"); }
function addDays(date: string, days: number) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
async function cleanup(testPool: Pool, ids: string[]) {
  const client = await testPool.connect();
  try {
    await client.query("BEGIN");
    for (const studentId of ids) {
      const plans = (await client.query("SELECT id FROM learning_plans WHERE student_id=$1", [studentId])).rows.map((p) => p.id);
      await client.query("DELETE FROM learning_plan_proposals WHERE student_id=$1", [studentId]);
      await client.query("UPDATE learning_plans SET current_version_id=NULL WHERE student_id=$1", [studentId]);
      for (const table of ["learning_plan_progress_events", "learning_plan_feedbacks", "learning_plan_completion_keys", "learning_plan_completions", "learning_plan_assignments", "learning_plan_items", "learning_plan_versions"]) await client.query(`DELETE FROM ${table} WHERE plan_id=ANY($1::varchar[])`, [plans]);
      await client.query("DELETE FROM learning_plans WHERE student_id=$1", [studentId]);
      await client.query("DELETE FROM students WHERE id=$1", [studentId]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
