import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { LearningPlanCandidate, LearningPlanReadResult, LearningPlanBasis } from "../src/learning-plan/learning-plan.repository.js";
import { openLearningPlanTestPool, startLearningPlanHttpServer } from "../test/helpers/learning-plan-http-harness.js";
import { readLearningPlanStateAudit } from "../test/helpers/learning-plan-state-audit.js";
import { checkLearningPlanIndependently } from "../test/helpers/learning-plan-independent-check.js";

// 브라우저 검사 프로세스와만 통신하는 개발 도구다. 출력은 부모가 비공개로 소비하며 공개 보고서에 복사하지 않는다.
assert.equal(process.env.VERIFY_LLM_ALLOW_PROVIDER, "1");
assert.ok(process.env.MINDLOGIC_API_KEY && process.env.LLM_MODEL);
const pool = await openLearningPlanTestPool();
const studentIds: string[] = [];
let api: Awaited<ReturnType<typeof startLearningPlanHttpServer>> | undefined;
let vite: ChildProcess | undefined;
let closed = false;
let priorStats: unknown;
const catalogBefore = JSON.stringify((await pool.query("SELECT id,course_id,sequence,duration_seconds,lesson_type FROM lessons ORDER BY id")).rows);
const lines = createInterface({ input: process.stdin });
// 부모의 예기치 않은 종료에도 EPIPE로 즉시 끝내지 않고 소유 fixture를 정리한다.
process.stdout.on("error", () => { lines.close(); process.stdin.destroy(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { lines.close(); process.stdin.destroy(); });
try {
  for (let n = 0; n < 2; n++) {
    const id = `learning-plan-browser-${randomUUID()}`;
    await pool.query("INSERT INTO students(id,status,created_at,updated_at) VALUES($1,'active',now(),now())", [id]);
    studentIds.push(id);
  }
  api = await startLearningPlanHttpServer();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: { ...process.env, API_PROXY_TARGET: api.origin }, stdio: "ignore", windowsHide: true,
  });
  let launchFailed = false;
  vite.on("error", () => { launchFailed = true; });
  let ready = false;
  for (let n = 0; n < 100; n++) {
    assert.ok(!launchFailed && vite.exitCode === null, "임시 프론트 시작 실패");
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* 준비 중 */ }
    await delay(100);
  }
  assert.ok(ready, "임시 프론트 준비 실패");
  process.stdout.write(JSON.stringify({ ready: true, origin, students: studentIds }) + "\n");
  for await (const line of lines) {
    const { id, command, input } = JSON.parse(line);
    try {
      let result: unknown;
      if (command === "stats") result = await api.request("/api/llm-chat/runtime-stats");
      else if (command === "audit") {
        const studentId = studentIds[input?.student ?? 0];
        assert.ok(studentId);
        const rows = await readLearningPlanStateAudit(pool, studentId);
        result = { digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
          counts: Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values.length])) };
      } else if (command === "read") {
        result = await api.request(`/api/learning-plans?studentId=${encodeURIComponent(studentIds[input?.student ?? 0])}`);
      } else if (command === "check") {
        const plan: LearningPlanReadResult & { basis: LearningPlanBasis } = await api.request(`/api/learning-plans?studentId=${encodeURIComponent(studentIds[0])}`);
        const candidate: LearningPlanCandidate = plan.version.candidate;
        await check(candidate);
        const version: { candidate_json: LearningPlanCandidate } = (await pool.query("SELECT candidate_json FROM learning_plan_versions WHERE id=$1 AND plan_id=$2", [plan.plan.currentVersionId, plan.plan.planId])).rows[0];
        assert.deepEqual(version.candidate_json, candidate);
        const rows = (await pool.query('SELECT segment_key AS "segmentKey",item_key AS "itemKey",to_char(scheduled_date,\'YYYY-MM-DD\') AS date,item_order AS "order",duration_seconds AS "durationSeconds",start_offset_seconds AS "startOffsetSeconds",end_offset_seconds AS "endOffsetSeconds" FROM learning_plan_assignments WHERE plan_id=$1 AND version_id=$2 ORDER BY scheduled_date,item_order', [plan.plan.planId, plan.plan.currentVersionId])).rows;
        assert.deepEqual(rows, plan.assignments.map(({ segmentKey, itemKey, date, order, durationSeconds, startOffsetSeconds, endOffsetSeconds }) => ({ segmentKey, itemKey, date, order, durationSeconds, startOffsetSeconds, endOffsetSeconds })));
        const usage = (await pool.query('SELECT to_char(study_date,\'YYYY-MM-DD\') AS "studyDate",sum(spent_seconds)::int AS "spentSeconds" FROM learning_plan_progress_events WHERE plan_id=$1 GROUP BY study_date ORDER BY study_date', [plan.plan.planId])).rows;
        assert.deepEqual(usage, plan.dailyUsage);
        const progress = (await pool.query('SELECT item_key AS "itemKey",max(position_seconds)::int AS "positionSeconds" FROM learning_plan_progress_events WHERE plan_id=$1 GROUP BY item_key ORDER BY item_key', [plan.plan.planId])).rows;
        for (const actual of progress) assert.equal(plan.progress.find(p => p.itemKey === actual.itemKey)?.positionSeconds, actual.positionSeconds);
        const completed = (await pool.query('SELECT item_key AS "itemKey" FROM learning_plan_completions WHERE plan_id=$1 ORDER BY item_key', [plan.plan.planId])).rows;
        assert.deepEqual(completed.map(p => p.itemKey), plan.completions.map(p => p.itemKey).sort());
        result = { checked: true, lessons: candidate.items.length, sourceSeconds: candidate.items.reduce((sum, item) => sum + item.durationSeconds, 0) };
      } else if (command === "checkCandidate") {
        await check(input); result = { checked: true };
      } else if (command === "prepare") {
        const selections = (await pool.query('SELECT id AS "courseId",primary_subject AS "subjectCode" FROM courses WHERE primary_subject IN (\'미적분\',\'영어\') ORDER BY id')).rows;
        assert.equal(selections.length, 2);
        const card = await api.request<{ proposal: { proposalId: string; expectedBasis: LearningPlanBasis } }>("/api/learning-plans/proposals/create", { studentId: studentIds[0], selections, startDate: input.startDate, deadlineDate: input.deadlineDate, availableSecondsPerDay: 6000 });
        await api.request(`/api/learning-plans/proposals/${card.proposal.proposalId}/confirm`, { studentId: studentIds[0], expectedBasis: card.proposal.expectedBasis });
        if (input.advanced) {
          let plan = await api.request<LearningPlanReadResult & { basis: LearningPlanBasis }>(`/api/learning-plans?studentId=${encodeURIComponent(studentIds[0])}`);
          const itemKey = plan.assignments[0].itemKey;
          await api.request(`/api/learning-plans/${plan.plan.planId}/progress`, { studentId: studentIds[0], itemKey, idempotencyKey: randomUUID(), positionSeconds: 2100, spentSeconds: 2100 });
          for (const mode of ["total", "additional"] as const) {
            plan = await api.request(`/api/learning-plans?studentId=${encodeURIComponent(studentIds[0])}`);
            const next = await api.request<{ proposal: { proposalId: string; expectedBasis: LearningPlanBasis } }>(`/api/learning-plans/${plan.plan.planId}/proposals/rebalance`, { studentId: studentIds[0], expectedBasis: plan.basis, todayTime: { mode, seconds: 3000 } });
            await api.request(`/api/learning-plans/proposals/${next.proposal.proposalId}/confirm`, { studentId: studentIds[0], expectedBasis: next.proposal.expectedBasis });
          }
        }
        result = { preparedByDirectApi: true };
      } else if (command === "stale") {
        const bound = await api.request<{ bindingToken: string }>("/api/llm-chat/bind", { studentId: studentIds[0] });
        result = await api.request("/api/llm-chat/confirm", { bindingToken: bound.bindingToken, proposalId: input.proposal.proposalId, expectedBasis: input.proposal.expectedBasis }, 409);
      } else if (command === "restart") {
        priorStats = await api.request("/api/llm-chat/runtime-stats");
        const pid = api.pid;
        const port = Number(new URL(api.origin).port);
        await api.stop(); api = await startLearningPlanHttpServer({ port });
        result = { differentPid: api.pid !== pid, providerBeforeRestart: priorStats };
      } else if (command === "close") {
        result = { provider: priorStats ?? await api.request("/api/llm-chat/runtime-stats") };
        await close(); process.stdout.write(JSON.stringify({ id, result: { ...result as object, cleaned: true } }) + "\n"); break;
      } else throw new Error("미지원 검사 명령");
      process.stdout.write(JSON.stringify({ id, result }) + "\n");
    } catch { process.stdout.write(JSON.stringify({ id, error: "통합 검증 명령 실패" }) + "\n"); }
  }
} catch {
  await close();
  process.stdout.write(JSON.stringify({ fatal: true, cleaned: true }) + "\n");
  process.exitCode = 1;
} finally { await close(); }

async function check(candidate: LearningPlanCandidate) {
  const catalog = (await pool.query<{ lessonId: string; courseId: string; sequence: number; durationSeconds: number }>('SELECT id AS "lessonId",course_id AS "courseId",sequence,duration_seconds AS "durationSeconds" FROM lessons WHERE course_id=ANY($1::varchar[]) AND lesson_type IN (\'lecture\',\'mock_exam\') ORDER BY course_id,sequence', [candidate.catalogSnapshot.map(s => s.catalog.course.id)])).rows;
  assert.ok(candidate.progressSnapshot);
  const positions = new Map(candidate.progressSnapshot.progress.map(p => [p.itemKey, p.positionSeconds]));
  checkLearningPlanIndependently({ catalog, segments: candidate.assignments, items: candidate.items.map(item => ({ itemKey: item.itemKey, lessonId: item.lessonId, positionSeconds: positions.get(item.itemKey) ?? 0 })), capacities: candidate.normalizedDays, dailyUsage: candidate.progressSnapshot.dailyUsage });
}
async function close() {
  if (closed) return;
  closed = true;
  try {
    if (vite && vite.exitCode === null) { const stopped = new Promise<void>(resolve => vite!.once("exit", () => resolve())); vite.kill(); await stopped; }
    await api?.stop();
  } finally {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const studentId of studentIds) {
        const plans = (await client.query("SELECT id FROM learning_plans WHERE student_id=$1", [studentId])).rows.map(p => p.id);
        await client.query("DELETE FROM learning_plan_proposals WHERE student_id=$1", [studentId]);
        await client.query("UPDATE learning_plans SET current_version_id=NULL WHERE student_id=$1", [studentId]);
        for (const table of ["learning_plan_progress_events", "learning_plan_feedbacks", "learning_plan_completion_keys", "learning_plan_completions", "learning_plan_assignments", "learning_plan_items", "learning_plan_versions"]) await client.query(`DELETE FROM ${table} WHERE plan_id=ANY($1::varchar[])`, [plans]);
        await client.query("DELETE FROM learning_plans WHERE student_id=$1", [studentId]);
        await client.query("DELETE FROM students WHERE id=$1", [studentId]);
      }
      assert.equal(JSON.stringify((await client.query("SELECT id,course_id,sequence,duration_seconds,lesson_type FROM lessons ORDER BY id")).rows), catalogBefore);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); await pool.end(); }
  }
}
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const address = probe.address(); assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve())); return address.port;
}
