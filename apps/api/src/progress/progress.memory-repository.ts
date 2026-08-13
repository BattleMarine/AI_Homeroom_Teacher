import type { PersistedAdjustmentProposal, PersistedProgressState } from "./progress.types.js";
import type { ProgressStateMutation, ProgressStateRepository, ProposalConfirmation } from "./progress-state.repository.js";

export function createMemoryProgressStateRepository(): ProgressStateRepository {
  const states = new Map<string, PersistedProgressState>();
  const proposals = new Map<string, { proposal: PersistedAdjustmentProposal; status: "pending" | "confirmed" | "expired" }>();

  return {
    async getOrCreate(studentId, initialState) {
      const state = states.get(studentId) ?? structuredClone(initialState);
      states.set(studentId, state);
      return structuredClone(state);
    },
    async mutate(studentId, initialState, callback) {
      const current = await this.getOrCreate(studentId, initialState);
      const mutation = callback(current);
      if (mutation.state.revision !== current.revision && mutation.state.revision !== current.revision + 1) {
        throw new Error("학습 상태 revision은 한 번의 변경에서 정확히 1 증가해야 합니다.");
      }
      states.set(studentId, structuredClone(mutation.state));
      return mutation.result;
    },
    async createProposal(proposal) {
      proposals.set(proposal.id, { proposal: structuredClone(proposal), status: "pending" });
    },
    async confirmProposal<T>(studentId: string, adjustmentId: string, expectedRevision: number | undefined, initialState: PersistedProgressState, callback: (state: PersistedProgressState, proposal: PersistedAdjustmentProposal) => ProgressStateMutation<T>): Promise<ProposalConfirmation<T>> {
      const current = await this.getOrCreate(studentId, initialState);
      const stored = proposals.get(adjustmentId);
      if (!stored || stored.status !== "pending" || stored.proposal.studentId !== studentId) return { kind: "not-found" };
      const requiredRevision = expectedRevision ?? stored.proposal.baseRevision;
      if (stored.proposal.baseRevision !== current.revision || requiredRevision !== current.revision) {
        stored.status = "expired";
        return { kind: "revision-conflict", currentRevision: current.revision, expectedRevision: requiredRevision };
      }
      const mutation = callback(current, structuredClone(stored.proposal));
      states.set(studentId, structuredClone(mutation.state));
      stored.status = "confirmed";
      return { kind: "confirmed", result: mutation.result };
    },
  };
}
