import type { Pool, PoolClient } from "pg";
import type {
  PersistedSubjectEnrollmentProposal,
  SubjectEnrollmentProposal,
  SubjectEnrollmentProposalInput,
  SubjectEnrollmentProposalPersistenceResult,
  SubjectEnrollmentProposalRepository,
} from "./subject-enrollment.types.js";
import type { SubjectEnrollmentInput } from "../student-curriculum/student-curriculum.types.js";

export function createPostgresSubjectEnrollmentProposalRepository(pool: Pool): SubjectEnrollmentProposalRepository {
  return {
    async create(proposal, input) {
      await withTransaction(pool, async (client) => {
        await ensureStudent(client, proposal.studentId);
        await client.query(
          `INSERT INTO subject_enrollment_proposals (
            id, student_id, subject_code, course_id, base_revision, request_json, proposal_json,
            status, expires_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'pending', $8, now(), now())
          ON CONFLICT (id) DO NOTHING`,
          [
            proposal.proposalId, proposal.studentId, proposal.subjectCode, input.courseId, proposal.baseRevision,
            JSON.stringify(input), JSON.stringify(proposal), proposal.expiresAt,
          ],
        );
      });
    },

    async get(studentId, proposalId) {
      const result = await pool.query<ProposalRow>(
        `SELECT id, student_id, subject_code, course_id, base_revision, request_json, proposal_json,
                status, expires_at, curriculum_id
         FROM subject_enrollment_proposals
         WHERE id = $1 AND student_id = $2`,
        [proposalId, studentId],
      );
      return result.rows[0] ? mapProposal(result.rows[0]) : undefined;
    },

    async confirm(input) {
      return withTransaction(pool, async (client): Promise<SubjectEnrollmentProposalPersistenceResult> => {
        const proposalResult = await client.query<ProposalRow>(
          `SELECT id, student_id, subject_code, course_id, base_revision, request_json, proposal_json,
                  status, expires_at, curriculum_id
           FROM subject_enrollment_proposals
           WHERE id = $1 AND student_id = $2 FOR UPDATE`,
          [input.proposalId, input.studentId],
        );
        const proposalRow = proposalResult.rows[0];
        if (!proposalRow) return { kind: "proposal-not-found" };
        if (proposalRow.status === "confirmed" && proposalRow.curriculum_id) {
          return { kind: "confirmed", curriculumId: proposalRow.curriculum_id };
        }
        if (proposalRow.status !== "pending") {
          return proposalRow.status === "expired" ? { kind: "proposal-expired" } : { kind: "subject-already-enrolled" };
        }
        if (proposalRow.expires_at.getTime() <= Date.now()) {
          await updateProposalStatus(client, proposalRow.id, "expired");
          return { kind: "proposal-expired" };
        }

        const proposal = mapProposal(proposalRow);
        if (!matchesProposal(proposal, input.enrollment)) {
          throw new Error("과목 등록 제안과 확정 입력이 일치하지 않습니다.");
        }

        await ensureStudent(client, input.studentId);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [input.studentId, proposalRow.subject_code]);
        const currentState = await client.query<{ revision: number }>(
          `SELECT revision FROM student_learning_states
           WHERE student_id = $1 AND subject_code = $2 FOR UPDATE`,
          [input.studentId, proposalRow.subject_code],
        );
        const currentRevision = currentState.rows[0]?.revision ?? 0;
        const expectedRevision = input.expectedRevision ?? proposalRow.base_revision;
        if (proposalRow.base_revision !== currentRevision || expectedRevision !== currentRevision) {
          await updateProposalStatus(client, proposalRow.id, "expired");
          return { kind: "revision-conflict", currentRevision };
        }

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM student_curricula
           WHERE student_id = $1 AND subject_code = $2 AND status <> 'archived' FOR UPDATE`,
          [input.studentId, proposalRow.subject_code],
        );
        if (existing.rows[0]) {
          await updateProposalStatus(client, proposalRow.id, "cancelled");
          return { kind: "subject-already-enrolled" };
        }

        await validateEnrollmentLessons(client, proposalRow.course_id, proposal.proposal.after.contentLessonCount, input.enrollment);
        await insertEnrollment(client, input.enrollment);
        await persistInitialState(client, input.enrollment);
        await client.query(
          `UPDATE subject_enrollment_proposals
           SET status = 'confirmed', curriculum_id = $1, confirmed_at = now(), updated_at = now()
           WHERE id = $2`,
          [input.enrollment.id, proposalRow.id],
        );
        return { kind: "confirmed", curriculumId: input.enrollment.id };
      });
    },
  };
}

type ProposalRow = {
  id: string;
  student_id: string;
  subject_code: string;
  course_id: string;
  base_revision: number;
  request_json: SubjectEnrollmentProposalInput;
  proposal_json: SubjectEnrollmentProposal;
  status: "pending" | "confirmed" | "expired" | "cancelled";
  expires_at: Date;
  curriculum_id: string | null;
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

async function ensureStudent(client: PoolClient, studentId: string) {
  await client.query(
    `INSERT INTO students (id, status, created_at, updated_at)
     VALUES ($1, 'active', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [studentId],
  );
}

function mapProposal(row: ProposalRow): PersistedSubjectEnrollmentProposal {
  return {
    proposal: row.proposal_json,
    input: row.request_json,
    status: row.status,
    curriculumId: row.curriculum_id,
  };
}

function matchesProposal(proposal: PersistedSubjectEnrollmentProposal, enrollment: SubjectEnrollmentInput) {
  return proposal.proposal.studentId === enrollment.studentId &&
    proposal.proposal.subjectCode === enrollment.subjectCode &&
    proposal.input.courseId === proposal.proposal.interpretedRequest.courseId;
}

async function updateProposalStatus(client: PoolClient, proposalId: string, status: "expired" | "cancelled") {
  await client.query(
    "UPDATE subject_enrollment_proposals SET status = $1, updated_at = now() WHERE id = $2",
    [status, proposalId],
  );
}

async function validateEnrollmentLessons(
  client: PoolClient,
  courseId: string,
  expectedContentLessonCount: number,
  enrollment: SubjectEnrollmentInput,
) {
  const lectureIds = enrollment.version.steps.flatMap((step) => step.items)
    .filter((item) => item.kind === "lecture")
    .map((item) => item.lessonId)
    .filter((lessonId): lessonId is string => lessonId !== null);
  const uniqueLectureIds = [...new Set(lectureIds)];
  if (lectureIds.length !== expectedContentLessonCount || uniqueLectureIds.length !== expectedContentLessonCount) {
    throw new Error("과목 등록 커리큘럼의 콘텐츠 강의 수가 제안과 일치하지 않습니다.");
  }
  const contentCount = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM lessons WHERE course_id = $1 AND lesson_type <> 'orientation'",
    [courseId],
  );
  if (Number(contentCount.rows[0]?.count ?? 0) !== expectedContentLessonCount) {
    throw new Error("과목 등록 제안의 콘텐츠 강의 수가 현재 강좌와 일치하지 않습니다.");
  }
  const lessons = await client.query<{ id: string }>(
    `SELECT id FROM lessons
     WHERE course_id = $1 AND lesson_type <> 'orientation' AND id = ANY($2::varchar[])`,
    [courseId, uniqueLectureIds],
  );
  if (lessons.rows.length !== expectedContentLessonCount) {
    throw new Error("과목 등록 커리큘럼의 강의 연결이 유효하지 않습니다.");
  }
}

async function insertEnrollment(client: PoolClient, enrollment: SubjectEnrollmentInput) {
  const versionId = `${enrollment.id}:v1`;
  await client.query(
    `INSERT INTO student_curricula (
      id, student_id, subject_code, title, status, presentation_json, revision, state_json, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'active', $5::jsonb, 0, $6::jsonb, now(), now())`,
    [
      enrollment.id, enrollment.studentId, enrollment.subjectCode, enrollment.title,
      JSON.stringify(enrollment.presentation), JSON.stringify(enrollment.state),
    ],
  );
  await client.query(
    `INSERT INTO curriculum_versions (id, student_curriculum_id, version_number, change_reason, change_summary, created_at)
     VALUES ($1, $2, 1, $3, $4, now())`,
    [versionId, enrollment.id, enrollment.version.changeReason, enrollment.version.changeSummary ?? null],
  );
  for (const [stepIndex, step] of enrollment.version.steps.entries()) {
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
        [
          `${stepId}:${item.sourceId}`, stepId, itemIndex, item.sourceId, item.kind, item.lessonId, item.title,
          item.description, JSON.stringify(item.conceptTags), item.estimatedMinutes, item.required, item.reason,
        ],
      );
    }
  }
  await client.query(
    `UPDATE student_curricula SET current_version_id = $1, revision = 1, state_json = $2::jsonb, updated_at = now()
     WHERE id = $3`,
    [versionId, JSON.stringify(enrollment.state), enrollment.id],
  );
}

async function persistInitialState(client: PoolClient, enrollment: SubjectEnrollmentInput) {
  const payload = { context: enrollment.state, appliedCurriculum: null, remediationItems: [] };
  await client.query(
    `INSERT INTO student_learning_states (student_id, subject_code, revision, state_json, created_at, updated_at)
     VALUES ($1, $2, 1, $3::jsonb, now(), now())
     ON CONFLICT (student_id, subject_code) DO UPDATE SET
       revision = EXCLUDED.revision, state_json = EXCLUDED.state_json, updated_at = now()`,
    [enrollment.studentId, enrollment.subjectCode, JSON.stringify(payload)],
  );
}
