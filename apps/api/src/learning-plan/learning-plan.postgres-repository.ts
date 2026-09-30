import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { createPostgresCourseCatalogRepository } from "../course-catalog/course-catalog.postgres-repository.js";
import type { LearningPlanCatalogSelection } from "./learning-plan.types.js";
import { canonicalLearningPlanJson, learningPlanCatalogHash } from "./learning-plan.catalog-basis.js";
import { validateLearningPlanSegments } from "./learning-plan.validation.js";
import { learningPlanProposalTtlSeconds, LearningPlanRepositoryError,
  type LearningPlanBasis, type LearningPlanCandidate, type LearningPlanCompletion, type LearningPlanConfirmResult,
  type LearningPlanHeader, type LearningPlanJsonObject, type LearningPlanProposal, type LearningPlanRepository,
  type LearningPlanSaveProposalInput, type LearningPlanSelection, type LearningPlanVersion } from "./learning-plan.repository.js";
import type { LearningPlanDailyUsage, LearningPlanProgress, LearningPlanStoredItem,
  LearningPlanRecordProgressResult, LearningPlanProgressSnapshot } from "./learning-plan.repository.js";

type PlanRow = { id: string; student_id: string; current_version_id: string | null; plan_revision: number; completion_revision: number };
type VersionRow = { id: string; plan_id: string; version_number: number; kind: LearningPlanVersion["kind"];
  scope_json: LearningPlanJsonObject; reason: string; diff_json: LearningPlanJsonObject;
  candidate_json: LearningPlanCandidate; catalog_hash: string; created_at: Date };
type CompletionRow = { plan_id: string; item_key: string; payload_json: LearningPlanJsonObject | null;
  completed_at: Date; completion_revision: number; submitted_at: Date | null; feedback_revision: number | null };
type ItemRow = { plan_id: string; item_key: string; lesson_id: string; subject_code: string;
  item_snapshot_json: LearningPlanStoredItem; position_seconds: number; carryover_date: string | null };
type ProposalRow = { id: string; student_id: string; target_plan_id: string; expected_basis_json: LearningPlanBasis;
  input_json: LearningPlanSaveProposalInput; status: "pending" | "confirmed" | "expired";
  created_at: Date; expires_at: Date; result_json: Omit<LearningPlanConfirmResult, "replayed"> | null; expired: boolean };

export function createPostgresLearningPlanRepository(pool: Pool): LearningPlanRepository {
  async function transaction<T>(action: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async readBasis(input) {
      input = cloneInput(input);
      requireJsonObject(input);
      return transaction(async (client) => {
        await requireStudent(client, input.studentId);
        const plan = await findPlan(client, input.studentId, input.planId);
        const snapshot = await readCatalogs(client, input.selections);
        const execution = plan ? await readExecution(client, plan.id) : { progress: [], dailyUsage: [], historicalItems: [] };
        return {
          plan: plan ? header(plan) : null,
          version: plan?.current_version_id ? await readVersion(client, plan.id, plan.current_version_id) : null,
          completions: plan ? await readCompletions(client, plan.id) : [],
          catalogSnapshot: snapshot, basis: basis(plan, learningPlanCatalogHash(snapshot)),
          ...execution,
        };
      }, true);
    },

    async saveProposal(input) {
      const safe = cloneInput(input);
      requireJsonObject(safe); requireJsonObject(safe.candidate);
      return transaction(async (client) => {
        await lockStudent(client, safe.studentId);
        const plan = await findPlan(client, safe.studentId, undefined, true);
        await checkBasis(client, plan, safe.expectedBasis, safe.candidate.catalogSnapshot);
        await checkCandidate(client, plan, safe);
        const result = await client.query<ProposalRow>(
          `INSERT INTO learning_plan_proposals (id,student_id,target_plan_id,expected_plan_id,
            expected_basis_json,input_json,status,created_at,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,'pending',clock_timestamp(),clock_timestamp()+$7*interval '1 second')
           RETURNING *`,
          [randomUUID(), safe.studentId, plan?.id ?? randomUUID(), plan?.id ?? null,
            JSON.stringify(safe.expectedBasis), JSON.stringify(safe), learningPlanProposalTtlSeconds],
        );
        return proposal(result.rows[0]);
      });
    },

    async confirmProposal(input) {
      input = cloneInput(input);
      requireJsonObject(input);
      const expected = cloneInput(input.expectedBasis);
      const result = await transaction(async (client): Promise<LearningPlanConfirmResult | "expired"> => {
        await lockStudent(client, input.studentId);
        const rows = await client.query<ProposalRow>(
          `SELECT *, expires_at <= clock_timestamp() AS expired FROM learning_plan_proposals
           WHERE id=$1 AND student_id=$2 FOR UPDATE`, [input.proposalId, input.studentId],
        );
        const saved = rows.rows[0];
        if (!saved) fail("NOT_FOUND", "학생의 제안을 찾을 수 없습니다.");
        if (canonicalLearningPlanJson(saved.expected_basis_json) !== canonicalLearningPlanJson(expected)) {
          fail("BASIS_CONFLICT", "제안의 최초 기준과 요청 기준이 다릅니다.");
        }
        // 정확한 재시도는 최신 상태·시간과 무관하게 당시 확정 결과를 반환한다.
        if (saved.status === "confirmed") {
          if (!saved.result_json) fail("INVALID_STATE", "확정 결과가 없습니다.");
          return { ...saved.result_json, replayed: true };
        }
        if (saved.status === "expired" || saved.expired) {
          await client.query("UPDATE learning_plan_proposals SET status='expired' WHERE id=$1", [saved.id]);
          return "expired";
        }
        const candidateInput = saved.input_json;
        const plan = await findPlan(client, input.studentId, undefined, true);
        await checkBasis(client, plan, expected, candidateInput.candidate.catalogSnapshot);
        await checkCandidate(client, plan, candidateInput);
        const planId = saved.target_plan_id;
        if (plan && plan.id !== planId) fail("BASIS_CONFLICT", "제안의 계획 귀속이 다릅니다.");
        // 카탈로그 잠금 대기/저장 중 만료된 경우 새 버전 전체를 되돌리고 만료만 보존한다.
        await client.query("SAVEPOINT confirm_candidate");
        if (!plan) {
          await client.query(
            `INSERT INTO learning_plans (id,student_id,created_at,updated_at)
             VALUES ($1,$2,clock_timestamp(),clock_timestamp())`, [planId, input.studentId],
          );
        }
        for (const item of candidateInput.candidate.items) {
          await client.query(
            `INSERT INTO learning_plan_items (plan_id,item_key,lesson_id,subject_code,item_snapshot_json)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (plan_id,item_key) DO NOTHING`,
            [planId, item.itemKey, item.lessonId, item.subjectCode, JSON.stringify(item)],
          );
        }
        for (const carryover of candidateInput.candidate.carryoverCandidates) {
          await client.query(`UPDATE learning_plan_items SET carryover_since_date=COALESCE(carryover_since_date,$3::date)
            WHERE plan_id=$1 AND item_key=$2`, [planId, carryover.itemKey, carryover.carryoverSinceDate]);
        }
        const versionId = randomUUID();
        const revision = (plan?.plan_revision ?? 0) + 1;
        const versionRow = (await client.query<VersionRow>(
          `INSERT INTO learning_plan_versions (id,plan_id,version_number,kind,scope_json,reason,diff_json,
            candidate_json,catalog_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()) RETURNING *`,
          [versionId, planId, revision, candidateInput.kind, JSON.stringify(candidateInput.scope), candidateInput.reason,
            JSON.stringify(candidateInput.diff), JSON.stringify(candidateInput.candidate), expected.catalogHash],
        )).rows[0];
        for (const assignment of candidateInput.candidate.assignments) {
          await client.query(
            `INSERT INTO learning_plan_assignments (plan_id,version_id,item_key,scheduled_date,item_order,duration_seconds,
              segment_key,start_offset_seconds,end_offset_seconds) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
            [planId, versionId, assignment.itemKey, assignment.date, assignment.order, assignment.durationSeconds,
              assignment.segmentKey, assignment.startOffsetSeconds, assignment.endOffsetSeconds],
          );
        }
        await client.query(
          `UPDATE learning_plans SET current_version_id=$2,plan_revision=$3,updated_at=clock_timestamp() WHERE id=$1`,
          [planId, versionId, revision],
        );
        const confirmed: Omit<LearningPlanConfirmResult, "replayed"> = {
          planId, version: version(versionRow), basis: { ...expected, planId, currentVersionId: versionId, planRevision: revision },
        };
        const marked = await client.query(
          `UPDATE learning_plan_proposals SET status='confirmed',confirmed_at=clock_timestamp(),
             confirmed_version_id=$2,result_json=$3 WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id`,
          [saved.id, versionId, JSON.stringify(confirmed)],
        );
        if (!marked.rowCount) {
          await client.query("ROLLBACK TO SAVEPOINT confirm_candidate");
          await client.query("UPDATE learning_plan_proposals SET status='expired' WHERE id=$1", [saved.id]);
          return "expired";
        }
        return { ...confirmed, replayed: false };
      });
      if (result === "expired") fail("PROPOSAL_EXPIRED", "제안이 만료되었습니다.");
      return result;
    },

    async recordCompletion(input) {
      const safe = cloneInput(input);
      requireJsonObject(safe);
      requireId(safe.itemKey, 200); requireId(safe.idempotencyKey, 200);
      requireJsonObject(safe.payload);
      return transaction(async (client) => {
        await lockStudent(client, safe.studentId);
        const plan = await findPlan(client, safe.studentId, safe.planId, true);
        if (!plan) fail("NOT_FOUND", "학생의 계획을 찾을 수 없습니다.");
        const accepted = (await client.query<{ item_key: string }>(
          "SELECT item_key FROM learning_plan_completion_keys WHERE plan_id=$1 AND idempotency_key=$2",
          [plan.id, safe.idempotencyKey],
        )).rows[0];
        if (accepted && accepted.item_key !== safe.itemKey) fail("IDEMPOTENCY_CONFLICT", "재시도 키가 다른 항목에 사용되었습니다.");
        const item = await readItem(client, plan.id, safe.itemKey);
        if (!item) fail("NOT_FOUND", "학습 항목을 찾을 수 없습니다.");
        if (item.position_seconds !== item.item_snapshot_json.durationSeconds) fail("INVALID_STATE", "실제 수강이 끝난 강의에만 feedback을 제출할 수 있습니다.");
        const existing = await readCompletion(client, plan.id, safe.itemKey);
        if (!existing) fail("INVALID_STATE", "실제 완료 기록이 없습니다.");
        if (existing.feedback_revision !== null) {
          if (canonicalLearningPlanJson(existing.payload_json) !== canonicalLearningPlanJson(safe.payload)) {
            fail("IDEMPOTENCY_CONFLICT", "최초 완료·피드백과 다른 내용을 덮어쓸 수 없습니다.");
          }
          if (!accepted) await insertCompletionKey(client, plan.id, safe.itemKey, safe.idempotencyKey);
          return { completion: completion(existing), replayed: true };
        }
        const revision = plan.completion_revision + 1;
        await storeFeedback(client, plan.id, safe.itemKey, safe.payload, revision);
        await insertCompletionKey(client, plan.id, safe.itemKey, safe.idempotencyKey);
        await client.query("UPDATE learning_plans SET completion_revision=$2,updated_at=clock_timestamp() WHERE id=$1", [plan.id, revision]);
        return { completion: completion((await readCompletion(client, plan.id, safe.itemKey))!), replayed: false };
      });
    },

    async recordProgress(input) {
      const safe = cloneInput(input);
      requireJsonObject(safe); requireId(safe.itemKey, 200); requireId(safe.idempotencyKey, 200);
      if (!Number.isSafeInteger(safe.positionSeconds) || safe.positionSeconds < 0 || !Number.isSafeInteger(safe.spentSeconds)
        || safe.spentSeconds < 0 || safe.spentSeconds > 86400) fail("INVALID_CANDIDATE", "진도와 실제 소비 시간은 유효한 정수 초여야 합니다.");
      if (safe.feedback !== undefined) requireJsonObject(safe.feedback);
      return transaction(async (client) => {
        await lockStudent(client, safe.studentId);
        const plan = await findPlan(client, safe.studentId, safe.planId, true);
        if (!plan) fail("NOT_FOUND", "학생의 계획을 찾을 수 없습니다.");
        const request = { itemKey: safe.itemKey, positionSeconds: safe.positionSeconds, spentSeconds: safe.spentSeconds,
          ...(safe.feedback === undefined ? {} : { feedback: safe.feedback }) };
        const prior = (await client.query<{ request_json: typeof request; result_json: LearningPlanRecordProgressResult }>(
          "SELECT request_json,result_json FROM learning_plan_progress_events WHERE plan_id=$1 AND idempotency_key=$2",
          [plan.id, safe.idempotencyKey],
        )).rows[0];
        if (prior) {
          if (canonicalLearningPlanJson(request) !== canonicalLearningPlanJson(prior.request_json)) fail("IDEMPOTENCY_CONFLICT", "실제 event key의 대상·내용이 다릅니다.");
          return { ...prior.result_json, replayed: true };
        }
        const item = await readItem(client, plan.id, safe.itemKey);
        const current = plan.current_version_id ? await readVersion(client, plan.id, plan.current_version_id) : null;
        if (!item || !current?.candidate.items.some(({ itemKey }) => itemKey === safe.itemKey)) fail("NOT_FOUND", "현재 계획의 학습 항목을 찾을 수 없습니다.");
        if (safe.positionSeconds > item.item_snapshot_json.durationSeconds) fail("INVALID_CANDIDATE", "원본 강의 범위를 넘는 진도입니다.");
        if (safe.positionSeconds < item.position_seconds) fail("BASIS_CONFLICT", "이미 기록한 실제 진도를 되돌릴 수 없습니다.");
        if (safe.positionSeconds === item.position_seconds && safe.spentSeconds === 0) fail("INVALID_STATE", "변화 없는 실제 event는 기록하지 않습니다.");
        if (safe.feedback !== undefined && safe.positionSeconds !== item.item_snapshot_json.durationSeconds) fail("INVALID_STATE", "feedback은 실제 수강 종료에만 동봉할 수 있습니다.");
        const clock = (await client.query<{ now: Date; study_date: string }>(
          `WITH clock AS (SELECT clock_timestamp() AS at) SELECT at AS now,
           to_char(at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS study_date FROM clock`,
        )).rows[0];
        const revision = plan.completion_revision + 1;
        await client.query("UPDATE learning_plan_items SET position_seconds=$3 WHERE plan_id=$1 AND item_key=$2", [plan.id, safe.itemKey, safe.positionSeconds]);
        if (safe.positionSeconds === item.item_snapshot_json.durationSeconds) {
          await client.query(`INSERT INTO learning_plan_completions(plan_id,item_key,payload_json,completed_at,completion_revision)
            VALUES($1,$2,NULL,$3,$4) ON CONFLICT(plan_id,item_key) DO NOTHING`, [plan.id, safe.itemKey, clock.now, revision]);
          if (safe.feedback !== undefined) await storeFeedback(client, plan.id, safe.itemKey, safe.feedback, revision, clock.now);
        }
        const completed = await readCompletion(client, plan.id, safe.itemKey);
        const result: LearningPlanRecordProgressResult = {
          event: { eventId: randomUUID(), planId: plan.id, itemKey: safe.itemKey, idempotencyKey: safe.idempotencyKey,
            positionSeconds: safe.positionSeconds, spentSeconds: safe.spentSeconds, studyDate: clock.study_date,
            createdAt: clock.now.toISOString(), executionRevision: revision },
          progress: { planId: plan.id, itemKey: safe.itemKey, positionSeconds: safe.positionSeconds, carryoverSinceDate: item.carryover_date },
          completion: completed ? completion(completed) : null, completionRevision: revision, replayed: false,
        };
        await client.query(`INSERT INTO learning_plan_progress_events(id,plan_id,item_key,idempotency_key,position_seconds,
          spent_seconds,study_date,created_at,execution_revision,request_json,result_json) VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11)`,
          [result.event.eventId, plan.id, safe.itemKey, safe.idempotencyKey, safe.positionSeconds, safe.spentSeconds,
            clock.study_date, clock.now, revision, JSON.stringify(request), JSON.stringify(result)]);
        await client.query("UPDATE learning_plans SET completion_revision=$2,updated_at=$3 WHERE id=$1", [plan.id, revision, clock.now]);
        return result;
      });
    },

    async readPlan(input) {
      input = cloneInput(input);
      requireJsonObject(input);
      if (input.date !== undefined) requireDate(input.date);
      return transaction(async (client) => {
        await requireStudent(client, input.studentId);
        const plan = await findPlan(client, input.studentId, input.planId);
        if (!plan?.current_version_id) return undefined;
        const stored = await readVersion(client, plan.id, input.versionId ?? plan.current_version_id);
        const rows = (await client.query<{ item_key: string; date: string; item_order: number; duration_seconds: number;
          segment_key: string; start_offset_seconds: number; end_offset_seconds: number }>(
          `SELECT item_key,to_char(scheduled_date,'YYYY-MM-DD') AS date,item_order,duration_seconds,
             segment_key,start_offset_seconds,end_offset_seconds FROM learning_plan_assignments
           WHERE plan_id=$1 AND version_id=$2 ${input.date === undefined ? "" : "AND scheduled_date=$3::date"}
           ORDER BY scheduled_date,item_order`, input.date === undefined ? [plan.id, stored.versionId] : [plan.id, stored.versionId, input.date],
        )).rows;
        const items = new Map(stored.candidate.items.map((item) => [item.itemKey, item]));
        return { plan: header(plan), version: stored,
          assignments: rows.map((row) => {
            const item = items.get(row.item_key);
            if (!item) fail("INVALID_STATE", "배치 항목의 버전 snapshot이 없습니다.");
            return { itemKey: row.item_key, lessonId: item.lessonId, subjectCode: item.subjectCode,
              courseId: item.courseId, date: row.date, order: row.item_order, durationSeconds: row.duration_seconds,
              segmentKey: row.segment_key, startOffsetSeconds: row.start_offset_seconds, endOffsetSeconds: row.end_offset_seconds };
          }),
          completions: await readCompletions(client, plan.id), ...await readExecution(client, plan.id) };
      }, true);
    },
  };
}

async function requireStudent(client: PoolClient, studentId: string) {
  requireId(studentId, 100);
  if (!(await client.query("SELECT id FROM students WHERE id=$1", [studentId])).rowCount) {
    fail("NOT_FOUND", "학생을 찾을 수 없습니다.");
  }
}
async function lockStudent(client: PoolClient, studentId: string) {
  requireId(studentId, 100);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`learning-plan:${studentId}`]);
  await requireStudent(client, studentId);
}
async function findPlan(client: PoolClient, studentId: string, planId?: string, lock = false): Promise<PlanRow | undefined> {
  const rows = await client.query<PlanRow>(
    `SELECT * FROM learning_plans WHERE student_id=$1 ${planId === undefined ? "" : "AND id=$2"} ${lock ? "FOR UPDATE" : ""}`,
    planId === undefined ? [studentId] : [studentId, planId],
  );
  if (planId !== undefined && !rows.rows[0]) fail("NOT_FOUND", "학생의 계획을 찾을 수 없습니다.");
  return rows.rows[0];
}
async function readVersion(client: PoolClient, planId: string, versionId: string): Promise<LearningPlanVersion> {
  const row = (await client.query<VersionRow>("SELECT * FROM learning_plan_versions WHERE plan_id=$1 AND id=$2", [planId, versionId])).rows[0];
  if (!row) fail("NOT_FOUND", "계획의 버전을 찾을 수 없습니다.");
  return version(row);
}
async function readCompletions(client: PoolClient, planId: string) {
  return (await client.query<CompletionRow>(`${completionSelect} WHERE c.plan_id=$1 ORDER BY c.completion_revision`, [planId])).rows.map(completion);
}
const completionSelect = `SELECT c.plan_id,c.item_key,COALESCE(f.payload_json,c.payload_json) AS payload_json,
  c.completed_at,c.completion_revision,f.submitted_at,f.feedback_revision FROM learning_plan_completions c
  LEFT JOIN learning_plan_feedbacks f ON f.plan_id=c.plan_id AND f.item_key=c.item_key`;
async function readCompletion(client: PoolClient, planId: string, itemKey: string) {
  return (await client.query<CompletionRow>(`${completionSelect} WHERE c.plan_id=$1 AND c.item_key=$2`, [planId, itemKey])).rows[0];
}
async function readItem(client: PoolClient, planId: string, itemKey: string) {
  return (await client.query<ItemRow>(`SELECT *,to_char(carryover_since_date,'YYYY-MM-DD') AS carryover_date
    FROM learning_plan_items WHERE plan_id=$1 AND item_key=$2`, [planId, itemKey])).rows[0];
}
async function readExecution(client: PoolClient, planId: string) {
  const items = (await client.query<ItemRow>(`SELECT *,to_char(carryover_since_date,'YYYY-MM-DD') AS carryover_date
    FROM learning_plan_items WHERE plan_id=$1 ORDER BY item_key`, [planId])).rows;
  const progress: LearningPlanProgress[] = items.map((item) => ({ planId, itemKey: item.item_key,
    positionSeconds: item.position_seconds, carryoverSinceDate: item.carryover_date }));
  const historicalItems = items.map((item) => ({ ...item.item_snapshot_json, carryoverSinceDate: item.carryover_date }));
  const usage = (await client.query<{ date: string; spent: string }>(`SELECT to_char(study_date,'YYYY-MM-DD') AS date,
    sum(spent_seconds)::text AS spent FROM learning_plan_progress_events WHERE plan_id=$1 GROUP BY study_date ORDER BY study_date`, [planId])).rows;
  const dailyUsage: LearningPlanDailyUsage[] = usage.map(({ date, spent }) => {
    const seconds = Number(spent);
    if (!Number.isSafeInteger(seconds)) fail("INVALID_STATE", "실제 일별 소비 시간 합계가 안전한 범위를 넘습니다.");
    return { studyDate: date, spentSeconds: seconds };
  });
  return { progress, historicalItems, dailyUsage };
}
async function storeFeedback(client: PoolClient, planId: string, itemKey: string, payload: LearningPlanJsonObject,
  revision: number, now?: Date) {
  const existing = await readCompletion(client, planId, itemKey);
  if (existing?.feedback_revision !== null && existing?.feedback_revision !== undefined) {
    if (canonicalLearningPlanJson(existing.payload_json) !== canonicalLearningPlanJson(payload)) {
      fail("IDEMPOTENCY_CONFLICT", "최초 제출한 feedback을 덮어쓸 수 없습니다.");
    }
    return;
  }
  await client.query(`INSERT INTO learning_plan_feedbacks(plan_id,item_key,payload_json,submitted_at,feedback_revision)
    VALUES($1,$2,$3,COALESCE($4::timestamptz,clock_timestamp()),$5)`, [planId, itemKey, JSON.stringify(payload), now ?? null, revision]);
}
async function readCatalogs(client: PoolClient, selections: readonly LearningPlanSelection[]): Promise<LearningPlanCatalogSelection[]> {
  if (!Array.isArray(selections)) fail("INVALID_CANDIDATE", "명시적인 카탈로그 선택이 필요합니다.");
  const selected = new Set<string>();
  const result: LearningPlanCatalogSelection[] = [];
  // 모든 조회가 같은 transaction client를 사용한다.
  const repository = createPostgresCourseCatalogRepository(client as unknown as Pool);
  for (const selection of selections) {
    requireJsonObject(selection);
    requireId(selection.courseId, 200); requireId(selection.subjectCode, 100);
    if (selected.has(selection.courseId)) fail("INVALID_CANDIDATE", "강좌 선택이 중복되었습니다.");
    selected.add(selection.courseId);
    const catalog = await repository.getCourseCatalog(selection.courseId);
    if (!catalog) fail("NOT_FOUND", "선택한 실제 강좌를 찾을 수 없습니다.");
    result.push({ subjectCode: selection.subjectCode, catalog });
  }
  return result;
}
async function checkBasis(client: PoolClient, plan: PlanRow | undefined, expected: LearningPlanBasis,
  snapshot: LearningPlanCatalogSelection[]) {
  if (!expected || !Number.isSafeInteger(expected.planRevision) || !Number.isSafeInteger(expected.completionRevision) ||
    expected.planRevision < 0 || expected.completionRevision < 0 || !/^[a-f0-9]{64}$/.test(expected.catalogHash)) {
    fail("INVALID_CANDIDATE", "기준 revision과 카탈로그 hash가 유효하지 않습니다.");
  }
  const current = basis(plan, expected.catalogHash);
  if (canonicalLearningPlanJson(current) !== canonicalLearningPlanJson(expected)) fail("BASIS_CONFLICT", "계획 또는 완료 기준이 변경되었습니다.");
  if (!Array.isArray(snapshot)) fail("INVALID_CANDIDATE", "카탈로그 snapshot이 필요합니다.");
  for (const selection of snapshot) {
    requireJsonObject(selection); requireJsonObject(selection.catalog); requireJsonObject(selection.catalog.course);
    if (!Array.isArray(selection.catalog.lessons)) fail("INVALID_CANDIDATE", "카탈로그 강의 목록이 필요합니다.");
  }
  // 카탈로그 변경/행 추가도 확정 중 끼어들지 못하게 한다. 소규모 기준 데이터용 보수적 잠금이다.
  await client.query("LOCK TABLE courses, lessons IN SHARE MODE");
  const catalogs = await readCatalogs(client, snapshot.map(({ subjectCode, catalog }) => ({ subjectCode, courseId: catalog.course.id })));
  if (learningPlanCatalogHash(catalogs) !== expected.catalogHash) fail("CATALOG_CONFLICT", "계산 기준의 카탈로그가 변경되었습니다.");
  let snapshotHash: string;
  try { snapshotHash = learningPlanCatalogHash(snapshot); }
  catch { return fail("INVALID_CANDIDATE", "후보의 카탈로그 snapshot 형식이 유효하지 않습니다."); }
  if (snapshotHash !== expected.catalogHash) fail("INVALID_CANDIDATE", "후보 snapshot이 계산 기준과 다릅니다.");
}

async function checkCandidate(client: PoolClient, plan: PlanRow | undefined, input: LearningPlanSaveProposalInput) {
  const candidate = input.candidate;
  if (!["create", "adjust", "rebalance"].includes(input.kind) || typeof input.reason !== "string" || input.reason.trim().length === 0) {
    fail("INVALID_CANDIDATE", "변경 종류와 명시적인 이유가 필요합니다.");
  }
  if ((input.kind === "create") !== !plan) fail("INVALID_STATE", "최초 생성과 기존 계획 변경의 상태가 다릅니다.");
  requireJsonObject(input.scope); requireJsonObject(input.diff); requireJsonObject(candidate.conditions);
  if (![candidate.items, candidate.assignments, candidate.normalizedDays, candidate.excludedItems].every(Array.isArray)) {
    fail("INVALID_CANDIDATE", "후보의 항목·배치·날짜·제외 근거가 필요합니다.");
  }
  let previousDate = "";
  for (const day of candidate.normalizedDays) {
    requireJsonObject(day);
    requireDate(day.date);
    if (day.date <= previousDate) fail("INVALID_CANDIDATE", "정규화 날짜는 중복 없이 날짜 순서여야 합니다.");
    previousDate = day.date;
  }
  const source = new Map(candidate.catalogSnapshot.flatMap(({ subjectCode, catalog }) => catalog.lessons.map((lesson) =>
    [lesson.id, { lessonId: lesson.id, subjectCode, courseId: lesson.courseId, sequence: lesson.sequence,
      durationSeconds: lesson.duration.seconds, lessonType: lesson.lessonType }] as const)));
  const coverage = new Set<string>();
  const keys = new Map<string, LearningPlanCandidate["items"][number]>();
  const existingItems = plan ? (await client.query<ItemRow>(`SELECT *,to_char(carryover_since_date,'YYYY-MM-DD') AS carryover_date
    FROM learning_plan_items WHERE plan_id=$1`, [plan.id])).rows : [];
  const existing = new Map(existingItems.map((item) => [item.item_key, item]));
  for (const item of candidate.items) {
    requireJsonObject(item);
    requireId(item.itemKey, 200);
    if (keys.has(item.itemKey)) fail("INVALID_CANDIDATE", "항목 key가 중복되었습니다.");
    const reference = source.get(item.lessonId);
    const { itemKey: _, carryoverSinceDate: __, ...metadata } = item;
    if (!reference || canonicalLearningPlanJson(reference) !== canonicalLearningPlanJson(metadata)) {
      fail("INVALID_CANDIDATE", "항목의 실제 카탈로그 참조·초·순서가 다릅니다.");
    }
    const original = existing.get(item.itemKey);
    if (original && (original.lesson_id !== item.lessonId || original.subject_code !== item.subjectCode
      || original.item_snapshot_json.durationSeconds !== item.durationSeconds)) {
      fail("INVALID_CANDIDATE", "항목 key의 강의·과목 귀속을 변경할 수 없습니다.");
    }
    keys.set(item.itemKey, item);
    if (coverage.has(item.lessonId)) fail("INVALID_CANDIDATE", "같은 강의가 중복되었습니다.");
    coverage.add(item.lessonId);
  }
  for (const excluded of candidate.excludedItems) {
    requireJsonObject(excluded);
    const { reason, ...metadata } = excluded;
    if (reason !== "lesson-type-excluded" || coverage.has(excluded.lessonId) ||
      canonicalLearningPlanJson(source.get(excluded.lessonId) ?? null) !== canonicalLearningPlanJson(metadata)) {
      fail("INVALID_CANDIDATE", "카탈로그 제외 근거가 누락되거나 유효하지 않습니다.");
    }
    coverage.add(excluded.lessonId);
  }
  if (coverage.size !== source.size) fail("INVALID_CANDIDATE", "카탈로그 항목은 포함하거나 제외 근거를 보존해야 합니다.");
  const execution = plan ? await readExecution(client, plan.id) : { progress: [], dailyUsage: [], historicalItems: [] };
  requireJsonObject(candidate.progressSnapshot);
  const snapshot = candidate.progressSnapshot!;
  if (!Array.isArray(snapshot.progress) || !Array.isArray(snapshot.dailyUsage) || !Array.isArray(candidate.carryoverCandidates)) {
    fail("INVALID_CANDIDATE", "실제 진도·시간 snapshot과 이월 후보가 필요합니다.");
  }
  for (const entry of [...snapshot.progress, ...snapshot.dailyUsage]) requireJsonObject(entry);
  const actualSnapshot = { progress: execution.progress.map(({ itemKey, positionSeconds }) => ({ itemKey, positionSeconds })), dailyUsage: execution.dailyUsage };
  if (canonicalLearningPlanJson(sortedSnapshot(snapshot)) !== canonicalLearningPlanJson(sortedSnapshot(actualSnapshot))) {
    fail("BASIS_CONFLICT", "후보가 사용한 실제 진도·소비 시간 snapshot이 현재 기록과 다릅니다.");
  }
  const carryover = new Map<string, string>();
  const today = (await client.query<{ date: string }>("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS date")).rows[0].date;
  for (const proposed of candidate.carryoverCandidates) {
    requireJsonObject(proposed); requireId(proposed.itemKey, 200); requireDate(proposed.carryoverSinceDate);
    if (!keys.has(proposed.itemKey) || carryover.has(proposed.itemKey)) fail("INVALID_CANDIDATE", "이월 후보의 항목이 없거나 중복됐습니다.");
    const original = existing.get(proposed.itemKey);
    if (!original || !plan) fail("INVALID_CANDIDATE", "과거 예정 구간이 없는 새 항목에 이월을 만들 수 없습니다.");
    if (original.carryover_date !== null) {
      if (proposed.carryoverSinceDate !== original.carryover_date) fail("INVALID_CANDIDATE", "최초 이월 기준일을 변경할 수 없습니다.");
    } else {
      const oldest = (await client.query<{ date: string | null }>(`SELECT to_char(min(scheduled_date),'YYYY-MM-DD') AS date
        FROM learning_plan_assignments WHERE plan_id=$1 AND version_id=$2 AND item_key=$3
        AND end_offset_seconds>$4 AND scheduled_date<$5::date`, [plan.id, plan.current_version_id, proposed.itemKey, original.position_seconds, today])).rows[0].date;
      if (oldest !== proposed.carryoverSinceDate) fail("INVALID_CANDIDATE", "이월 기준일이 실제 미완료 과거 구간의 최초 날짜와 다릅니다.");
    }
    carryover.set(proposed.itemKey, proposed.carryoverSinceDate);
  }
  for (const item of candidate.items) {
    const date = existing.get(item.itemKey)?.carryover_date ?? carryover.get(item.itemKey) ?? null;
    if (item.carryoverSinceDate !== undefined && item.carryoverSinceDate !== date) fail("INVALID_CANDIDATE", "후보에서 최초 이월을 없애거나 변경할 수 없습니다.");
    if (date !== null) item.carryoverSinceDate = date;
  }
  for (const assignment of candidate.assignments) {
    requireJsonObject(assignment);
    requireDate(assignment.date);
    const item = keys.get(assignment.itemKey);
    if (!item || item.lessonId !== assignment.lessonId || item.courseId !== assignment.courseId || item.subjectCode !== assignment.subjectCode) {
      fail("INVALID_CANDIDATE", "배치 항목의 key·강의·과목 귀속이 다릅니다.");
    }
    requireId(assignment.segmentKey, 200);
  }
  const validation = validateLearningPlanSegments({ items: candidate.items, days: candidate.normalizedDays,
    assignments: candidate.assignments, progress: snapshot.progress.filter(({ itemKey }) => keys.has(itemKey)), dailyUsage: snapshot.dailyUsage });
  if (validation.kind !== "valid") fail("INVALID_CANDIDATE", "후보의 커버리지·시간·순서 제약이 유효하지 않습니다.");
}

async function insertCompletionKey(client: PoolClient, planId: string, itemKey: string, key: string) {
  await client.query("INSERT INTO learning_plan_completion_keys (plan_id,idempotency_key,item_key) VALUES ($1,$2,$3)", [planId, key, itemKey]);
}
function basis(plan: PlanRow | undefined, catalogHash: string): LearningPlanBasis {
  return { planId: plan?.id ?? null, currentVersionId: plan?.current_version_id ?? null,
    planRevision: plan?.plan_revision ?? 0, completionRevision: plan?.completion_revision ?? 0, catalogHash };
}
function header(row: PlanRow): LearningPlanHeader {
  if (!row.current_version_id) fail("INVALID_STATE", "현재 계획 버전이 없습니다.");
  return { planId: row.id, studentId: row.student_id, currentVersionId: row.current_version_id,
    planRevision: row.plan_revision, completionRevision: row.completion_revision };
}
function version(row: VersionRow): LearningPlanVersion {
  const raw = row.candidate_json;
  const legacy = raw.progressSnapshot === undefined || raw.assignments.some((item) => item.segmentKey === undefined);
  const candidate = legacy ? { ...raw, assignments: raw.assignments.map((item) => ({ ...item,
    segmentKey: item.segmentKey ?? item.itemKey, startOffsetSeconds: item.startOffsetSeconds ?? 0,
    endOffsetSeconds: item.endOffsetSeconds ?? item.durationSeconds })), progressSnapshot: raw.progressSnapshot ?? null,
    carryoverCandidates: raw.carryoverCandidates ?? [] } : raw;
  return { versionId: row.id, planId: row.plan_id, versionNumber: row.version_number, kind: row.kind,
    scope: row.scope_json, reason: row.reason, diff: row.diff_json, candidate,
    catalogHash: row.catalog_hash, createdAt: row.created_at.toISOString(), ...(legacy ? { legacyNormalized: true } : {}) };
}
function completion(row: CompletionRow): LearningPlanCompletion {
  return { planId: row.plan_id, itemKey: row.item_key, payload: row.payload_json,
    completedAt: row.completed_at.toISOString(), completionRevision: row.completion_revision,
    feedbackSubmittedAt: row.submitted_at?.toISOString() ?? null, feedbackRevision: row.feedback_revision };
}
function sortedSnapshot(value: LearningPlanProgressSnapshot): LearningPlanProgressSnapshot {
  return { progress: [...value.progress].sort((a, b) => a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0),
    dailyUsage: [...value.dailyUsage].sort((a, b) => a.studyDate < b.studyDate ? -1 : a.studyDate > b.studyDate ? 1 : 0) };
}
function proposal(row: ProposalRow): LearningPlanProposal {
  return { proposalId: row.id, studentId: row.student_id, targetPlanId: row.target_plan_id,
    expectedBasis: row.expected_basis_json, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() };
}
function requireId(value: unknown, limit: number) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > limit) {
    fail("INVALID_CANDIDATE", "유효한 opaque 식별자가 필요합니다.");
  }
}
function requireDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("INVALID_CANDIDATE", "날짜는 YYYY-MM-DD 키여야 합니다.");
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || !length || day < 1 || day > length) fail("INVALID_CANDIDATE", "유효한 달력 날짜가 필요합니다.");
}
function requireJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_CANDIDATE", "명시적인 JSON 객체가 필요합니다.");
}
function cloneInput<T>(value: T): T {
  try {
    // TS 선택 인자의 명시적 undefined는 생략과 같다. 중첩된 정책/feedback JSON은 그대로 엄격 검사한다.
    const root = value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
      ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) : value;
    return JSON.parse(canonicalLearningPlanJson(root)) as T;
  }
  catch { return fail("INVALID_CANDIDATE", "입력은 유효한 JSON이어야 합니다."); }
}
function fail(code: LearningPlanRepositoryError["code"], message: string): never {
  throw new LearningPlanRepositoryError(code, message);
}
