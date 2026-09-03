import type { Pool, PoolClient } from "pg";
import type {
  CurriculumItemInput,
  CurriculumPresentation,
  CurriculumReadModel,
  CurriculumVersionInput,
  StoredCurriculumItem,
  StoredCurriculumStep,
  StoredCurriculumVersion,
  StudentCurriculum,
  StudentCurriculumDetail,
  StudentCurriculumRepository,
  SubjectEnrollmentInput,
  SubjectEnrollmentResult,
  VersionSaveResult,
} from "./student-curriculum.types.js";

export function createPostgresStudentCurriculumRepository(pool: Pool): StudentCurriculumRepository {
  return {
    async listForStudent(studentId) {
      const rows = await pool.query<CurriculumRow>(
        `SELECT id, student_id, subject_code, title, status, presentation_json, current_version_id, revision, state_json
         FROM student_curricula WHERE student_id = $1 ORDER BY created_at ASC`,
        [studentId],
      );
      return Promise.all(rows.rows.map((row) => getDetail(pool, row)));
    },
    async getById(studentId, curriculumId) {
      const result = await pool.query<CurriculumRow>(
        `SELECT id, student_id, subject_code, title, status, presentation_json, current_version_id, revision, state_json
         FROM student_curricula WHERE student_id = $1 AND id = $2`,
        [studentId, curriculumId],
      );
      return result.rows[0] ? getDetail(pool, result.rows[0]) : undefined;
    },
    async seedCandidate(input) {
      await withTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO students (id, display_name, status, created_at, updated_at)
           VALUES ($1, '데모 학생', 'demo', now(), now()) ON CONFLICT (id) DO NOTHING`,
          [input.studentId],
        );
        await client.query(
          `INSERT INTO student_curricula (
            id, student_id, subject_code, title, status, presentation_json, revision, state_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'candidate', $5::jsonb, 0, $6::jsonb, now(), now())
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title, presentation_json = EXCLUDED.presentation_json, updated_at = now()`,
          [input.id, input.studentId, input.subjectCode, input.title, JSON.stringify(input.presentation), JSON.stringify(input.state)],
        );
        const curriculum = await getLockedCurriculum(client, input.studentId, input.id);
        if (!curriculum) throw new Error("seed할 학생별 커리큘럼을 만들지 못했습니다.");
        if (curriculum.current_version_id) return;
        await insertVersion(client, curriculum, input.version, input.state, curriculum.revision);
      });
    },
    async selectCandidate(studentId, curriculumId) {
      return withTransaction(pool, async (client) => {
        const target = await findCurriculum(client, studentId, curriculumId);
        if (!target) return undefined;
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
          [studentId, target.subject_code],
        );
        const selected = await getLockedCurriculum(client, studentId, curriculumId);
        if (!selected || (selected.status !== "candidate" && selected.status !== "active")) return undefined;
        await client.query(
          `UPDATE student_curricula SET status = 'candidate', updated_at = now()
           WHERE student_id = $1 AND subject_code = $2 AND status = 'active' AND id <> $3`,
          [studentId, selected.subject_code, curriculumId],
        );
        const updated = await client.query<CurriculumRow>(
          `UPDATE student_curricula SET status = 'active', revision = revision + 1, updated_at = now()
           WHERE id = $1 RETURNING id, student_id, subject_code, title, status, current_version_id, revision, state_json`,
          [curriculumId],
        );
        return mapCurriculum(updated.rows[0]);
      });
    },
    async getActiveReadModel(studentId, subjectCode) {
      return withReadTransaction(pool, async (client) => {
        const active = await client.query<CurriculumRow>(
          `SELECT id, student_id, subject_code, title, status, presentation_json, current_version_id, revision, state_json
           FROM student_curricula
           WHERE student_id = $1 AND subject_code = $2 AND status = 'active'`,
          [studentId, subjectCode],
        );
        if (!active.rows[0]) return { kind: "selection-required" } satisfies CurriculumReadModel;
        const state = await client.query<ExecutionStateRow>(
          `SELECT revision, state_json FROM student_learning_states
           WHERE student_id = $1 AND subject_code = $2`,
          [studentId, subjectCode],
        );
        return {
          kind: "active",
          curriculum: await getDetail(client, active.rows[0]),
          executionState: state.rows[0]
            ? { revision: state.rows[0].revision, state: state.rows[0].state_json }
            : null,
        } satisfies CurriculumReadModel;
      });
    },
    async saveNewVersion(input) {
      const result = await withTransaction(pool, async (client): Promise<VersionSaveResult | undefined> => {
        const curriculum = await getLockedCurriculum(client, input.studentId, input.curriculumId);
        if (!curriculum) return undefined;
        if (curriculum.revision !== input.expectedRevision) {
          return { kind: "revision-conflict", currentRevision: curriculum.revision };
        }
        const executionState = await client.query<ExecutionStateRow>(
          `SELECT revision, state_json FROM student_learning_states
           WHERE student_id = $1 AND subject_code = $2 FOR UPDATE`,
          [input.studentId, curriculum.subject_code],
        );
        if (executionState.rows[0] && executionState.rows[0].revision !== curriculum.revision) {
          return { kind: "revision-conflict", currentRevision: executionState.rows[0].revision };
        }
        await insertVersion(client, curriculum, input.version, input.state, curriculum.revision + 1);
        await persistExecutionState(
          client,
          input.studentId,
          curriculum.subject_code,
          input.state,
          curriculum.revision + 1,
        );
        return { kind: "saved", curriculum: await getDetail(client, await getCurriculum(client, input.studentId, input.curriculumId)) };
      });
      return result;
    },
    async enrollSubject(input: SubjectEnrollmentInput): Promise<SubjectEnrollmentResult> {
      return withTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO students (id, display_name, status, created_at, updated_at)
           VALUES ($1, '데모 학생', 'demo', now(), now()) ON CONFLICT (id) DO NOTHING`,
          [input.studentId],
        );
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [input.studentId, input.subjectCode]);
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM student_curricula
           WHERE student_id = $1 AND subject_code = $2 AND status <> 'archived'
           FOR UPDATE`,
          [input.studentId, input.subjectCode],
        );
        if (existing.rows[0]) return { kind: "already-enrolled" };

        await client.query(
          `INSERT INTO student_curricula (
            id, student_id, subject_code, title, status, presentation_json, revision, state_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'active', $5::jsonb, 0, $6::jsonb, now(), now())`,
          [input.id, input.studentId, input.subjectCode, input.title, JSON.stringify(input.presentation), JSON.stringify(input.state)],
        );
        const curriculum = await getLockedCurriculum(client, input.studentId, input.id);
        if (!curriculum) throw new Error("등록할 학생별 커리큘럼을 만들지 못했습니다.");
        await insertVersion(client, curriculum, input.version, input.state, 1);
        await persistExecutionState(client, input.studentId, input.subjectCode, input.state, 1);
        const detail = await getDetail(client, await getCurriculum(client, input.studentId, input.id));
        return { kind: "created", curriculum: detail };
      });
    },
  };
}

type Queryable = Pick<Pool, "query">;
type CurriculumRow = {
  id: string;
  student_id: string;
  subject_code: string;
  title: string;
  status: StudentCurriculum["status"];
  presentation_json: CurriculumPresentation;
  current_version_id: string | null;
  revision: number;
  state_json: Record<string, unknown>;
};
type ExecutionStateRow = { revision: number; state_json: Record<string, unknown> };
type VersionRow = { id: string; version_number: number; change_reason: StoredCurriculumVersion["changeReason"]; change_summary: string | null };
type StepRow = { id: string; sequence: number; source_id: string; title: string; goal: string | null; concept_tags: string[]; estimated_minutes: number };
type ItemRow = {
  id: string; curriculum_step_id: string; sequence: number; source_id: string; kind: CurriculumItemInput["kind"]; lesson_id: string | null;
  title: string; description: string | null; concept_tags: string[]; estimated_minutes: number; required: boolean; reason: string | null;
};

async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withReadTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getCurriculum(queryable: Queryable, studentId: string, curriculumId: string) {
  const result = await findCurriculum(queryable, studentId, curriculumId);
  if (!result) throw new Error("학생별 커리큘럼을 찾을 수 없습니다.");
  return result;
}

async function findCurriculum(queryable: Queryable, studentId: string, curriculumId: string) {
  const result = await queryable.query<CurriculumRow>(
    `SELECT id, student_id, subject_code, title, status, presentation_json, current_version_id, revision, state_json
     FROM student_curricula WHERE student_id = $1 AND id = $2`,
    [studentId, curriculumId],
  );
  return result.rows[0];
}

async function getLockedCurriculum(client: PoolClient, studentId: string, curriculumId: string) {
  const result = await client.query<CurriculumRow>(
    `SELECT id, student_id, subject_code, title, status, presentation_json, current_version_id, revision, state_json
     FROM student_curricula WHERE student_id = $1 AND id = $2 FOR UPDATE`,
    [studentId, curriculumId],
  );
  return result.rows[0];
}

async function getDetail(queryable: Queryable, curriculum: CurriculumRow): Promise<StudentCurriculumDetail> {
  const result: StudentCurriculumDetail = { ...mapCurriculum(curriculum), currentVersion: null };
  if (!curriculum.current_version_id) return result;
  const version = await queryable.query<VersionRow>(
    `SELECT id, version_number, change_reason, change_summary FROM curriculum_versions WHERE id = $1`,
    [curriculum.current_version_id],
  );
  if (!version.rows[0]) throw new Error("현재 커리큘럼 버전을 찾을 수 없습니다.");
  const steps = await queryable.query<StepRow>(
    `SELECT id, sequence, source_id, title, goal, concept_tags, estimated_minutes
     FROM curriculum_steps WHERE curriculum_version_id = $1 ORDER BY sequence ASC`,
    [version.rows[0].id],
  );
  const items = await queryable.query<ItemRow>(
    `SELECT id, curriculum_step_id, sequence, source_id, kind, lesson_id, title, description, concept_tags,
            estimated_minutes, required, reason
     FROM curriculum_items WHERE curriculum_step_id = ANY($1::varchar[]) ORDER BY sequence ASC`,
    [steps.rows.map((step) => step.id)],
  );
  const itemsByStep = new Map<string, StoredCurriculumItem[]>();
  for (const item of items.rows) {
    const stored = mapItem(item);
    itemsByStep.set(item.curriculum_step_id, [...(itemsByStep.get(item.curriculum_step_id) ?? []), stored]);
  }
  result.currentVersion = {
    id: version.rows[0].id,
    versionNumber: version.rows[0].version_number,
    changeReason: version.rows[0].change_reason,
    changeSummary: version.rows[0].change_summary,
    steps: steps.rows.map((step) => ({
      id: step.id,
      sourceId: step.source_id,
      sequence: step.sequence,
      title: step.title,
      goal: step.goal,
      conceptTags: step.concept_tags,
      estimatedMinutes: step.estimated_minutes,
      items: itemsByStep.get(step.id) ?? [],
    })),
  };
  return result;
}

async function insertVersion(
  client: PoolClient,
  curriculum: CurriculumRow,
  version: CurriculumVersionInput,
  state: Record<string, unknown>,
  nextRevision: number,
) {
  validateVersion(version);
  const versionNumber = (await client.query<{ version_number: number }>(
    "SELECT coalesce(max(version_number), 0)::integer AS version_number FROM curriculum_versions WHERE student_curriculum_id = $1",
    [curriculum.id],
  )).rows[0].version_number + 1;
  const versionId = `${curriculum.id}:v${versionNumber}`;
  await client.query(
    `INSERT INTO curriculum_versions (id, student_curriculum_id, version_number, change_reason, change_summary, created_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [versionId, curriculum.id, versionNumber, version.changeReason, version.changeSummary ?? null],
  );
  for (const [stepIndex, step] of version.steps.entries()) {
    const stepId = `${versionId}:${step.sourceId}`;
    await client.query(
      `INSERT INTO curriculum_steps (id, curriculum_version_id, sequence, source_id, title, goal, concept_tags, estimated_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [stepId, versionId, stepIndex, step.sourceId, step.title, step.goal, JSON.stringify(step.conceptTags), step.estimatedMinutes],
    );
    for (const [itemIndex, item] of step.items.entries()) {
      await client.query(
        `INSERT INTO curriculum_items (
          id, curriculum_step_id, sequence, source_id, kind, lesson_id, title, description, concept_tags,
          estimated_minutes, required, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
        [`${stepId}:${item.sourceId}`, stepId, itemIndex, item.sourceId, item.kind, item.lessonId, item.title, item.description,
          JSON.stringify(item.conceptTags), item.estimatedMinutes, item.required, item.reason],
      );
    }
  }
  await client.query(
    `UPDATE student_curricula SET current_version_id = $1, revision = $2, state_json = $3::jsonb, updated_at = now()
     WHERE id = $4`,
    [versionId, nextRevision, JSON.stringify(state), curriculum.id],
  );
}

function validateVersion(version: CurriculumVersionInput) {
  if (version.steps.length === 0) throw new Error("커리큘럼 버전에는 최소 한 개의 단계가 필요합니다.");
  for (const step of version.steps) {
    if (step.items.some((item) => item.kind === "lecture" && !item.lessonId)) {
      throw new Error("강의형 커리큘럼 항목에는 lessonId가 필요합니다.");
    }
  }
}

async function persistExecutionState(
  client: PoolClient,
  studentId: string,
  subjectCode: string,
  state: Record<string, unknown>,
  revision: number,
) {
  const initialPayload = { context: state, appliedCurriculum: null, remediationItems: [] };
  await client.query(
    `INSERT INTO student_learning_states (student_id, subject_code, revision, state_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now(), now())
     ON CONFLICT (student_id, subject_code) DO UPDATE SET
       revision = EXCLUDED.revision,
       state_json = jsonb_set(student_learning_states.state_json, '{context}', EXCLUDED.state_json->'context', true),
       updated_at = now()`,
    [studentId, subjectCode, revision, JSON.stringify(initialPayload)],
  );
}

function mapCurriculum(row: CurriculumRow): StudentCurriculum {
  return {
    id: row.id, studentId: row.student_id, subjectCode: row.subject_code, title: row.title,
    status: row.status, presentation: row.presentation_json, currentVersionId: row.current_version_id,
    revision: row.revision, state: row.state_json,
  };
}

function mapItem(row: ItemRow): StoredCurriculumItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sequence: row.sequence,
    kind: row.kind,
    lessonId: row.lesson_id,
    title: row.title,
    description: row.description,
    conceptTags: row.concept_tags,
    estimatedMinutes: row.estimated_minutes,
    required: row.required,
    reason: row.reason,
  };
}
