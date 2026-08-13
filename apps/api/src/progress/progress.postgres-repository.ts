import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PersistedAdjustmentProposal, PersistedProgressState } from "./progress.types.js";
import type { ProgressStateMutation, ProgressStateRepository, ProposalConfirmation } from "./progress-state.repository.js";

export function createPostgresProgressStateRepository(pool: Pool): ProgressStateRepository {
  return {
    async getOrCreate(studentId, initialState) {
      return withTransaction(pool, async (client) => getLockedState(client, studentId, initialState));
    },

    async mutate(studentId, initialState, callback) {
      return withTransaction(pool, async (client) => {
        const current = await getLockedState(client, studentId, initialState);
        const mutation = callback(current);
        await persistMutation(client, current, mutation, studentId);
        return mutation.result;
      });
    },

    async createProposal(proposal) {
      await withTransaction(pool, async (client) => {
        await ensureStudent(client, proposal.studentId);
        await client.query(
          `INSERT INTO session_adjustment_proposals (
            id, student_id, base_revision, proposal_json, status, created_at
          ) VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)`,
          [proposal.id, proposal.studentId, proposal.baseRevision, JSON.stringify(proposal), proposal.createdAt],
        );
      });
    },

    async confirmProposal<T>(studentId: string, adjustmentId: string, expectedRevision: number | undefined, initialState: PersistedProgressState, callback: (state: PersistedProgressState, proposal: PersistedAdjustmentProposal) => ProgressStateMutation<T>): Promise<ProposalConfirmation<T>> {
      return withTransaction(pool, async (client): Promise<ProposalConfirmation<T>> => {
        const current = await getLockedState(client, studentId, initialState);
        const proposalResult = await client.query<ProposalRow>(
          `SELECT id, student_id, base_revision, proposal_json, status
           FROM session_adjustment_proposals WHERE id = $1 FOR UPDATE`,
          [adjustmentId],
        );
        const proposalRow = proposalResult.rows[0];
        if (!proposalRow || proposalRow.student_id !== studentId || proposalRow.status !== "pending") return { kind: "not-found" };

        const proposal = proposalRow.proposal_json as PersistedAdjustmentProposal;
        const requiredRevision = expectedRevision ?? proposal.baseRevision;
        if (proposal.baseRevision !== current.revision || requiredRevision !== current.revision) {
          await client.query("UPDATE session_adjustment_proposals SET status = 'expired' WHERE id = $1", [adjustmentId]);
          return { kind: "revision-conflict", currentRevision: current.revision, expectedRevision: requiredRevision };
        }

        const mutation = callback(current, proposal);
        await persistMutation(client, current, mutation, studentId);
        await client.query(
          "UPDATE session_adjustment_proposals SET status = 'confirmed', confirmed_at = now() WHERE id = $1",
          [adjustmentId],
        );
        return { kind: "confirmed", result: mutation.result };
      });
    },
  };
}

type StateRow = { student_id: string; revision: number; state_json: PersistedProgressPayload };
type ProposalRow = { id: string; student_id: string; base_revision: number; proposal_json: unknown; status: string };
type PersistedProgressPayload = Omit<PersistedProgressState, "studentId" | "revision">;

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

async function getLockedState(client: PoolClient, studentId: string, initialState: PersistedProgressState) {
  await ensureStudent(client, studentId);
  await client.query(
    `INSERT INTO student_learning_states (student_id, revision, state_json, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, now(), now()) ON CONFLICT (student_id) DO NOTHING`,
    [studentId, initialState.revision, JSON.stringify(toPayload(initialState))],
  );
  const result = await client.query<StateRow>(
    "SELECT student_id, revision, state_json FROM student_learning_states WHERE student_id = $1 FOR UPDATE",
    [studentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("학생 학습 상태를 초기화하지 못했습니다.");
  return fromRow(row);
}

async function persistMutation<T>(
  client: PoolClient,
  current: PersistedProgressState,
  mutation: ProgressStateMutation<T>,
  studentId: string,
) {
  if (mutation.state.revision === current.revision) return;
  if (mutation.state.revision !== current.revision + 1) {
    throw new Error("학습 상태 revision은 한 번의 변경에서 정확히 1 증가해야 합니다.");
  }
  await client.query(
    `UPDATE student_learning_states
     SET revision = $1, state_json = $2::jsonb, updated_at = now()
     WHERE student_id = $3 AND revision = $4`,
    [mutation.state.revision, JSON.stringify(toPayload(mutation.state)), studentId, current.revision],
  );
  if (mutation.feedbackEvent) {
    await client.query(
      `INSERT INTO lesson_feedback_events (
        id, student_id, lesson_item_id, understanding_level, focus_level, reason_codes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [randomUUID(), studentId, mutation.feedbackEvent.lessonItemId, mutation.feedbackEvent.understandingLevel,
        mutation.feedbackEvent.focusLevel, JSON.stringify(mutation.feedbackEvent.reasonCodes)],
    );
  }
}

function fromRow(row: StateRow): PersistedProgressState {
  return { studentId: row.student_id, revision: row.revision, ...row.state_json };
}

function toPayload(state: PersistedProgressState): PersistedProgressPayload {
  return { context: state.context, appliedCurriculum: state.appliedCurriculum, remediationItems: state.remediationItems };
}
