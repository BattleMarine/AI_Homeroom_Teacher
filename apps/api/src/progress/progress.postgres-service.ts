import type {
  AdjustmentConfirmationResult,
  CurriculumDefinition,
  LessonFeedbackResult,
  LessonItem,
  PersistedAdjustmentProposal,
  PersistedProgressState,
  ProgressService,
  StatefulProgressService,
  StudentContext,
  ProgressSnapshot,
} from "./progress.types.js";
import { createMockProgressService } from "./progress.mock-service.js";
import type { ProgressStateRepository } from "./progress-state.repository.js";
import type { CurriculumReadModel, StudentCurriculumDetail, StudentCurriculumRepository } from "../student-curriculum/student-curriculum.types.js";

export class CurriculumSelectionRequiredError extends Error {
  constructor() {
    super("학습을 시작할 커리큘럼을 먼저 선택해야 합니다.");
    this.name = "CurriculumSelectionRequiredError";
  }
}

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
    async getProgressSnapshot(studentId) {
      return withState(studentId, (service) => createProgressSnapshot(service, studentId));
    },
  };
}

export function createPostgresProgressService(
  repository: ProgressStateRepository,
  studentCurriculumRepository?: StudentCurriculumRepository,
  subjectCode = "math-logarithm",
): ProgressService {
  if (!studentCurriculumRepository) return createRepositoryProgressService(repository);
  const curriculumRepository = studentCurriculumRepository;

  async function loadActive(studentId: string) {
    const readModel = await curriculumRepository.getActiveReadModel(studentId, subjectCode);
    if (readModel.kind === "selection-required") throw new CurriculumSelectionRequiredError();
    return readModel;
  }

  function createState(studentId: string, readModel: Extract<CurriculumReadModel, { kind: "active" }>) {
    return createPersistedState(studentId, readModel.curriculum, readModel.executionState);
  }

  function createService(state: PersistedProgressState): StatefulProgressService {
    const curriculum = state.appliedCurriculum;
    if (!curriculum) throw new Error("PostgreSQL 커리큘럼을 진도 규칙에 연결하지 못했습니다.");
    const service = createMockProgressService([curriculum]);
    service.restoreState(state);
    return service;
  }

  async function withState<T>(studentId: string, callback: (service: StatefulProgressService) => T | Promise<T>) {
    const readModel = await loadActive(studentId);
    const state = await repository.getOrCreate(studentId, createState(studentId, readModel));
    return callback(createService(attachCurrentCurriculum(studentId, state, readModel.curriculum)));
  }

  async function mutate<T>(
    studentId: string,
    callback: (service: StatefulProgressService) => T,
    feedbackEvent?: (result: T) => { lessonItemId: string; understandingLevel: number; focusLevel: number; reasonCodes: string[] } | undefined,
  ) {
    const readModel = await loadActive(studentId);
    const initialState = createState(studentId, readModel);
    return repository.mutate(studentId, initialState, (state) => {
      const service = createService(attachCurrentCurriculum(studentId, state, readModel.curriculum));
      const result = callback(service);
      return { state: service.exportState(studentId), result, feedbackEvent: feedbackEvent?.(result) };
    });
  }

  return {
    async listCurriculums(studentId) {
      const curriculums = await curriculumRepository.listForStudent(studentId);
      const active = curriculums.find((curriculum) => curriculum.status === "active");
      const activeReadModel = active ? await curriculumRepository.getActiveReadModel(studentId, active.subjectCode) : undefined;
      const activeState = activeReadModel?.kind === "active" ? activeReadModel.executionState?.state : undefined;
      return curriculums.map((curriculum) => ({
        id: curriculum.id,
        title: curriculum.title,
        pace: curriculum.presentation.paceLabel,
        description: curriculum.presentation.description,
        recommendedFor: curriculum.presentation.recommendedFor,
        teacherComment: curriculum.presentation.teacherComment,
        stepCount: curriculum.currentVersion?.steps.length ?? 0,
        selected: curriculum.id === active?.id,
        currentStepId: curriculum.id === active?.id ? getCurrentStepId(activeState) : null,
      }));
    },
    async selectCurriculum(studentId, curriculumId) {
      const curriculum = await curriculumRepository.getById(studentId, curriculumId);
      if (!curriculum || curriculum.subjectCode !== subjectCode || !curriculum.currentVersion) return undefined;
      const initialState = createPersistedState(studentId, curriculum, null);
      if (!repository.selectCurriculum) return undefined;
      return repository.selectCurriculum(studentId, curriculumId, initialState, (current) => {
        const selectedState = {
          ...initialState,
          revision: current.revision,
          context: { ...initialState.context, studentId, selectedCurriculumId: curriculum.id },
        };
        const service = createService(selectedState);
        const result = service.selectCurriculum(studentId, curriculumId);
        return { state: service.exportState(studentId), result };
      });
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
      const readModel = await loadActive(studentId);
      const initialState = createState(studentId, readModel);
      const state = await repository.getOrCreate(studentId, initialState);
      const service = createService(attachCurrentCurriculum(studentId, state, readModel.curriculum));
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
      const readModel = await loadActive(studentId);
      const initialState = createState(studentId, readModel);
      const confirmation = await repository.confirmProposal(
        studentId,
        adjustmentId,
        expectedRevision,
        initialState,
        (state, proposal) => {
          const service = createService(attachCurrentCurriculum(studentId, state, readModel.curriculum));
          service.restoreAdjustmentProposal(proposal);
          const result = service.confirmAdjustment(studentId, adjustmentId, expectedRevision) as Exclude<AdjustmentConfirmationResult, undefined>;
          if (!result || result.kind !== "confirmed") throw new Error("조율 제안 확정 규칙을 실행하지 못했습니다.");
          return { state: service.exportState(studentId), result };
        },
      );
      if (confirmation.kind === "not-found") return undefined;
      if (confirmation.kind === "revision-conflict") {
        return { kind: "revision-conflict" as const, adjustmentId, expectedRevision: confirmation.expectedRevision, currentRevision: confirmation.currentRevision };
      }
      return confirmation.result;
    },
    async recordLessonFeedback(studentId, lessonId, understandingLevel, focusLevel) {
      return mutate(
        studentId,
        (service) => service.recordLessonFeedback(studentId, lessonId, understandingLevel, focusLevel),
        (result) => result
          ? { lessonItemId: lessonId, understandingLevel, focusLevel, reasonCodes: (result as LessonFeedbackResult).reasonCodes }
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
      return withState(studentId, (service) => service.getRevision(studentId));
    },
    async getProgressSnapshot(studentId) {
      const readModel = await loadActive(studentId);
      return createProgressSnapshot(createService(createState(studentId, readModel)), studentId);
    },
  };
}

async function createProgressSnapshot(service: StatefulProgressService, studentId: string): Promise<ProgressSnapshot> {
  return {
    revision: await service.getRevision(studentId),
    studentContext: await service.getStudentContext(studentId),
    todaySession: await service.getTodaySession(studentId),
    curriculumMap: await service.getCurriculumMap(studentId),
    progress: await service.getTodaySessionProgress(studentId),
  };
}

function createPersistedState(
  studentId: string,
  curriculum: StudentCurriculumDetail,
  executionState: Extract<CurriculumReadModel, { kind: "active" }> ["executionState"],
): PersistedProgressState {
  const definition = toCurriculumDefinition(curriculum);
  const baseline = createMockProgressService([definition]).exportState(studentId);
  const rawState = executionState?.state ?? curriculum.state;
  const rawContext = isRecord(rawState.context) ? rawState.context : rawState;
  const currentStepId = typeof rawContext.currentStepId === "string" && definition.steps.some((step) => step.id === rawContext.currentStepId)
    ? rawContext.currentStepId
    : definition.initialProgress.currentStepId;
  const context: StudentContext = {
    ...baseline.context,
    studentId,
    selectedCurriculumId: definition.id,
    currentStepId,
    completedStepIds: stringArray(rawContext.completedStepIds),
    delayedStepIds: stringArray(rawContext.delayedStepIds),
    weakConcepts: stringArray(rawContext.weakConcepts),
    completedLessonItemIds: stringArray(rawContext.completedLessonItemIds),
    deferredLessonItemIds: stringArray(rawContext.deferredLessonItemIds),
    lowFocusRecorded: typeof rawContext.lowFocusRecorded === "boolean" ? rawContext.lowFocusRecorded : false,
    maxSessionMinutes: typeof rawContext.maxSessionMinutes === "number" ? rawContext.maxSessionMinutes : 45,
  };
  return {
    ...baseline,
    revision: executionState?.revision ?? curriculum.revision,
    context,
    appliedCurriculum: definition,
    remediationItems: Array.isArray(rawState.remediationItems) ? rawState.remediationItems as LessonItem[] : [],
  };
}

function attachCurrentCurriculum(studentId: string, state: PersistedProgressState, curriculum: StudentCurriculumDetail): PersistedProgressState {
  const source = createPersistedState(studentId, curriculum, null);
  return {
    ...state,
    context: { ...source.context, ...state.context, studentId, selectedCurriculumId: curriculum.id },
    appliedCurriculum: source.appliedCurriculum,
  };
}

function toCurriculumDefinition(curriculum: StudentCurriculumDetail): CurriculumDefinition {
  const version = curriculum.currentVersion;
  if (!version) throw new Error("현재 커리큘럼 버전이 없습니다.");
  const initialState = curriculum.state;
  const initialStepId = typeof initialState.currentStepId === "string" && version.steps.some((step) => step.sourceId === initialState.currentStepId)
    ? initialState.currentStepId
    : version.steps[0]?.sourceId;
  if (!initialStepId) throw new Error("현재 커리큘럼에는 학습 단계가 없습니다.");
  return {
    id: curriculum.id,
    title: curriculum.title,
    pace: curriculum.presentation.paceLabel,
    description: curriculum.presentation.description,
    recommendedFor: curriculum.presentation.recommendedFor,
    teacherComment: curriculum.presentation.teacherComment,
    initialProgress: {
      currentStepId: initialStepId,
      completedStepIds: stringArray(initialState.completedStepIds),
      weakConcepts: stringArray(initialState.weakConcepts),
    },
    steps: version.steps.map((step) => ({
      id: step.sourceId,
      title: step.title,
      goal: step.goal ?? step.title,
      conceptTags: step.conceptTags,
      estimatedMinutes: step.estimatedMinutes,
      items: step.items.map((item) => ({
        id: item.sourceId,
        kind: item.kind,
        title: item.title,
        description: item.description ?? `${item.title} 학습 항목입니다.`,
        conceptTags: item.conceptTags,
        estimatedMinutes: item.estimatedMinutes,
        required: item.required,
        reason: item.reason ?? "현재 단계 학습",
        playbackTargetId: item.kind === "lecture" && item.lessonId ? `mock-video:${item.lessonId}` : undefined,
        mockPlayback: item.kind === "lecture" && item.lessonId
          ? { kind: "mock-video", targetId: `mock-video:${item.lessonId}`, mediaType: "image", contentType: "image/png", assetKey: "mock-logarithm-lecture", durationSeconds: item.estimatedMinutes * 60 }
          : undefined,
      })),
    })),
  };
}

function getCurrentStepId(state: Record<string, unknown> | undefined) {
  if (!state) return null;
  const context = isRecord(state.context) ? state.context : state;
  return typeof context.currentStepId === "string" ? context.currentStepId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
