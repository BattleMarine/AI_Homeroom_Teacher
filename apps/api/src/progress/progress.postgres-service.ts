import type { ProgressService, StatefulProgressService, PersistedProgressState } from "./progress.types.js";
import { createMockProgressService } from "./progress.mock-service.js";
import type { ProgressStateRepository } from "./progress-state.repository.js";

export function createRepositoryProgressService(repository: ProgressStateRepository): ProgressService {
  async function initialState(studentId: string) {
    return createMockProgressService().exportState(studentId);
  }

  async function withState<T>(studentId: string, callback: (service: StatefulProgressService) => T | Promise<T>) {
    const state = await repository.getOrCreate(studentId, await initialState(studentId));
    const service = createMockProgressService();
    service.restoreState(state);
    return callback(service);
  }

  async function mutate<T>(
    studentId: string,
    callback: (service: StatefulProgressService) => T,
    feedbackEvent?: (result: T) => { lessonItemId: string; understandingLevel: number; focusLevel: number; reasonCodes: string[] } | undefined,
  ) {
    return repository.mutate(studentId, await initialState(studentId), (state) => {
      const service = createMockProgressService();
      service.restoreState(state);
      const result = callback(service);
      return { state: service.exportState(studentId), result, feedbackEvent: feedbackEvent?.(result) };
    });
  }

  return {
    async listCurriculums(studentId) {
      return withState(studentId, (service) => service.listCurriculums(studentId));
    },
    async selectCurriculum(studentId, curriculumId) {
      if (repository.selectCurriculum) {
        const selected = await repository.selectCurriculum(studentId, curriculumId, await initialState(studentId), (state) => {
          const service = createMockProgressService();
          service.restoreState(state);
          const result = service.selectCurriculum(studentId, curriculumId);
          return { state: service.exportState(studentId), result };
        });
        if (selected) return selected;
      }
      return mutate(studentId, (service) => service.selectCurriculum(studentId, curriculumId));
    },
    async getStudentContext(studentId) {
      return withState(studentId, (service) => service.getStudentContext(studentId));
    },
    async getTodaySession(studentId) {
      return withState(studentId, (service) => service.getTodaySession(studentId));
    },
    async getCurriculumMap(studentId) {
      return withState(studentId, (service) => service.getCurriculumMap(studentId));
    },
    async getLessonItem(studentId, lessonItemId) {
      return withState(studentId, (service) => service.getLessonItem(studentId, lessonItemId));
    },
    async getLessonPlayback(studentId, lessonItemId) {
      return withState(studentId, (service) => service.getLessonPlayback(studentId, lessonItemId));
    },
    async createAdjustmentProposal(studentId, message) {
      const state = await repository.getOrCreate(studentId, await initialState(studentId));
      const service = createMockProgressService();
      service.restoreState(state);
      const result = service.createAdjustmentProposal(studentId, message) as Record<string, unknown> | undefined;
      if (!result) return undefined;
      const adjustmentId = result.adjustmentId;
      if (typeof adjustmentId !== "string") throw new Error("조율 제안 식별자를 생성하지 못했습니다.");
      const proposal = service.exportAdjustmentProposal(adjustmentId);
      if (!proposal) throw new Error("조율 제안 상태를 저장하지 못했습니다.");
      await repository.createProposal(proposal);
      return result;
    },
    async confirmAdjustment(studentId, adjustmentId, expectedRevision) {
      const confirmation = await repository.confirmProposal(
        studentId,
        adjustmentId,
        expectedRevision,
        await initialState(studentId),
        (state, proposal) => {
          const service = createMockProgressService();
          service.restoreState(state);
          service.restoreAdjustmentProposal(proposal);
          const result = service.confirmAdjustment(studentId, adjustmentId, expectedRevision) as Exclude<import("./progress.types.js").AdjustmentConfirmationResult, undefined>;
          if (!result || result.kind !== "confirmed") throw new Error("조율 제안 확정 규칙을 실행하지 못했습니다.");
          return { state: service.exportState(studentId), result };
        },
      );
      if (confirmation.kind === "not-found") return undefined;
      if (confirmation.kind === "revision-conflict") {
        return {
          kind: "revision-conflict" as const,
          adjustmentId,
          expectedRevision: confirmation.expectedRevision,
          currentRevision: confirmation.currentRevision,
        };
      }
      return confirmation.result;
    },
    async recordLessonFeedback(studentId, lessonId, understandingLevel, focusLevel) {
      return mutate(
        studentId,
        (service) => service.recordLessonFeedback(studentId, lessonId, understandingLevel, focusLevel),
        (result) => result
          ? { lessonItemId: lessonId, understandingLevel, focusLevel, reasonCodes: (result as import("./progress.types.js").LessonFeedbackResult).reasonCodes }
          : undefined,
      );
    },
    async getTodaySessionProgress(studentId) {
      return withState(studentId, (service) => service.getTodaySessionProgress(studentId));
    },
    async applyCurriculumPlan(studentId, plan) {
      return mutate(studentId, (service) => service.applyCurriculumPlan(studentId, plan));
    },
    async insertRemediation(studentId, input) {
      return mutate(studentId, (service) => service.insertRemediation(studentId, input));
    },
    async deferLessonItem(studentId, lessonItemId) {
      return mutate(studentId, (service) => service.deferLessonItem(studentId, lessonItemId));
    },
    async assessScheduleImpact(studentId, input) {
      return withState(studentId, (service) => service.assessScheduleImpact(studentId, input));
    },
    async getRevision(studentId) {
      return (await repository.getOrCreate(studentId, await initialState(studentId))).revision;
    },
  };
}

export function createPostgresProgressService(repository: ProgressStateRepository): ProgressService {
  return createRepositoryProgressService(repository);
}
