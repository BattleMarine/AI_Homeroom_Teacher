import { mockCurriculums } from "./progress.mock-data.js";
import type {
  CurriculumDefinition,
  CurriculumId,
  LessonItem,
  ProgressService,
  StudentRequestKind,
  StudentContext,
  TodaySession,
} from "./progress.types.js";

const defaultStudentId = "demo-student";

export function createMockProgressService(): ProgressService {
  const contexts = new Map<string, StudentContext>();
  const adjustmentProposals = new Map<string, AdjustmentProposal>();

  function getContext(studentId: string): StudentContext {
    const normalizedStudentId = studentId || defaultStudentId;
    const existingContext = contexts.get(normalizedStudentId);

    if (existingContext) return existingContext;

    const initialContext = createInitialContext(normalizedStudentId, getCurriculum("stable-log"));
    contexts.set(normalizedStudentId, initialContext);
    return initialContext;
  }

  function getCurrentCurriculum(studentId: string): CurriculumDefinition {
    return getCurriculum(getContext(studentId).selectedCurriculumId);
  }

  function getTodaySession(studentId: string): TodaySession {
    const context = getContext(studentId);
    const currentStep = getRequiredStep(getCurrentCurriculum(studentId), context.currentStepId);
    const { selectedItems, delayedItems } = fitItemsToMaxMinutes(
      currentStep.items,
      context.maxSessionMinutes,
    );

    return {
      id: `${context.studentId}:${currentStep.id}`,
      date: new Date().toISOString().slice(0, 10),
      goal: currentStep.goal,
      estimatedMinutes: sumMinutes(selectedItems),
      items: selectedItems,
      delayedItems,
      reasonCodes: getTodayReasonCodes(context, currentStep),
      explanationItems: createExplanationItems(context, currentStep, delayedItems),
      adjustmentReason: context.weakConcepts.length > 0
        ? "취약 개념을 현재 수업의 앞부분에서 먼저 확인합니다."
        : "현재 진도를 기준으로 필수 학습 항목을 편성했습니다.",
      teacherComment: context.weakConcepts.length > 0
        ? "헷갈렸던 개념을 짧게 확인한 뒤 핵심 진도로 이어가겠습니다."
        : "현재 단계의 핵심 흐름을 차분히 이어가겠습니다.",
    };
  }

  function getTodaySessionProgress(studentId: string): Record<string, unknown> {
    const context = getContext(studentId);
    const session = getTodaySession(studentId);
    const completedItems = session.items.filter((item) => context.completedLessonItemIds.includes(item.id));
    const incompleteItems = session.items.filter((item) => !context.completedLessonItemIds.includes(item.id));
    const nextLesson = incompleteItems.find((item) => item.required) ?? incompleteItems[0];
    const requiredItems = session.items.filter((item) => item.required);
    const isCompleted = requiredItems.every((item) => context.completedLessonItemIds.includes(item.id));

    return {
      sessionId: session.id,
      completedItemIds: completedItems.map((item) => item.id),
      completedItemCount: completedItems.length,
      totalItemCount: session.items.length,
      progressPercent: session.items.length === 0 ? 100 : Math.round((completedItems.length / session.items.length) * 100),
      completedItems,
      carryOverItems: session.delayedItems,
      isCompleted,
      nextRecommendedLesson: nextLesson ?? null,
      teacherReport: isCompleted
        ? "오늘 수업의 필수 항목을 모두 마쳤습니다. 다음 수업 편성에 학습 기록을 반영하겠습니다."
        : nextLesson
          ? `다음으로 ${nextLesson.title}을(를) 이어서 진행해 보겠습니다.`
          : "오늘 수업 진행 상황을 정리했습니다.",
    };
  }

  function getLessonItem(studentId: string, lessonItemId: string): Record<string, unknown> | undefined {
    const context = getContext(studentId);
    const curriculum = getCurrentCurriculum(studentId);
    const currentStep = getRequiredStep(curriculum, context.currentStepId);
    const item = curriculum.steps.flatMap((step) => step.items).find((candidate) => candidate.id === lessonItemId);

    if (!item) return undefined;

    return {
      ...item,
      currentSessionId: `${context.studentId}:${currentStep.id}`,
      sessionReason: item.reason,
      completed: context.completedLessonItemIds.includes(item.id),
      playback: item.playbackTargetId ? { kind: "mock-video", targetId: item.playbackTargetId } : null,
    };
  }

  function createAdjustmentProposal(studentId: string, message: string): Record<string, unknown> | undefined {
    const context = getContext(studentId);
    const request = interpretStudentRequest(message, getRequiredStep(getCurrentCurriculum(studentId), context.currentStepId));

    if (!request) return undefined;

    const proposalId = `adjustment-${context.studentId}-${Date.now()}-${adjustmentProposals.size + 1}`;
    const proposedContext: StudentContext = {
      ...context,
      weakConcepts: [...context.weakConcepts],
      maxSessionMinutes: request.maxSessionMinutes,
    };

    if (request.conditionKinds.includes("review_first")) {
      addUniqueConcepts(proposedContext.weakConcepts, request.currentStepConcepts.slice(0, 2));
    }

    if (request.conditionKinds.includes("confused_concept") && request.focusConcept) {
      addUniqueConcepts(proposedContext.weakConcepts, [request.focusConcept]);
    }

    const proposal: AdjustmentProposal = {
      id: proposalId,
      studentId: context.studentId,
      request,
      proposedContext,
      createdAt: new Date().toISOString(),
    };
    adjustmentProposals.set(proposalId, proposal);

    return {
      adjustmentId: proposal.id,
      interpretedRequest: {
        kind: request.kind,
        conditionKinds: request.conditionKinds,
        summary: request.summary,
        focusConcept: request.focusConcept ?? null,
        maxSessionMinutes: request.maxSessionMinutes,
      },
      before: summarizeSession(getTodaySession(studentId)),
      proposedSession: createTodaySessionFromContext(proposedContext),
      teacherNote: request.teacherNote,
      requiresConfirmation: true,
      availableActions: ["confirm", "continue_conversation"],
    };
  }

  function confirmAdjustment(studentId: string, adjustmentId: string): Record<string, unknown> | undefined {
    const proposal = adjustmentProposals.get(adjustmentId);

    if (!proposal || proposal.studentId !== (studentId || defaultStudentId)) return undefined;

    const confirmedContext = {
      ...proposal.proposedContext,
      completedStepIds: [...proposal.proposedContext.completedStepIds],
      delayedStepIds: [...proposal.proposedContext.delayedStepIds],
      weakConcepts: [...proposal.proposedContext.weakConcepts],
      completedLessonItemIds: [...proposal.proposedContext.completedLessonItemIds],
    };
    contexts.set(confirmedContext.studentId, confirmedContext);
    adjustmentProposals.delete(adjustmentId);

    return {
      adjustmentId,
      confirmed: true,
      studentContext: confirmedContext,
      session: getTodaySession(confirmedContext.studentId),
      curriculumMap: getCurriculumMap(confirmedContext.studentId),
      teacherNote: "요청한 조건을 오늘 수업에 반영했습니다. 이 편성으로 진행해 볼게요.",
    };
  }

  return {
    listCurriculums(studentId) {
      const context = getContext(studentId);
      return mockCurriculums.map((curriculum) => ({
        id: curriculum.id,
        title: curriculum.title,
        pace: curriculum.pace,
        description: curriculum.description,
        recommendedFor: curriculum.recommendedFor,
        stepCount: curriculum.steps.length,
        selected: curriculum.id === context.selectedCurriculumId,
        currentStepId: curriculum.id === context.selectedCurriculumId ? context.currentStepId : null,
      }));
    },

    selectCurriculum(studentId, curriculumId) {
      const curriculum = mockCurriculums.find((item) => item.id === curriculumId);
      if (!curriculum) return undefined;
      const context = createInitialContext(studentId || defaultStudentId, curriculum);
      contexts.set(context.studentId, context);
      adjustmentProposals.forEach((proposal, proposalId) => {
        if (proposal.studentId === context.studentId) adjustmentProposals.delete(proposalId);
      });
      return context;
    },

    getStudentContext(studentId) {
      return getContext(studentId);
    },

    getTodaySession,

    getTodaySessionProgress,

    getCurriculumMap(studentId) {
      const context = getContext(studentId);
      const curriculum = getCurrentCurriculum(studentId);
      return {
        curriculumId: curriculum.id,
        curriculumTitle: curriculum.title,
        currentStepId: context.currentStepId,
        completedStepIds: context.completedStepIds,
        delayedStepIds: context.delayedStepIds,
        weakConcepts: context.weakConcepts,
        steps: curriculum.steps.map((step) => ({
          id: step.id,
          title: step.title,
          conceptTags: step.conceptTags,
          estimatedMinutes: step.estimatedMinutes,
          status: getStepStatus(step, context),
        })),
      };
    },

    getLessonItem,

    createAdjustmentProposal,

    confirmAdjustment,

    recordLessonFeedback(studentId, lessonId, understandingLevel, focusLevel) {
      const context = getContext(studentId);
      const lesson = getLessonItem(studentId, lessonId) as (LessonItem & { completed: boolean }) | undefined;
      if (!lesson) return undefined;
      if (!context.completedLessonItemIds.includes(lessonId)) context.completedLessonItemIds.push(lessonId);

      const reasonCodes: string[] = [];
      if (understandingLevel <= 2) {
        addUniqueConcepts(context.weakConcepts, lesson.conceptTags);
        reasonCodes.push("low_understanding", "weak_concept_review");
      }
      if (focusLevel <= 2) {
        context.lowFocusRecorded = true;
        reasonCodes.push("low_focus", "reduce_next_session_load");
      }
      if (reasonCodes.length === 0) reasonCodes.push("stable_progress");

      return {
        responseType: "mock" as const,
        lessonId,
        recorded: true as const,
        completedLesson: { ...lesson, completed: true },
        appliedFeedback: { understandingLevel, focusLevel },
        weakConcepts: context.weakConcepts,
        reasonCodes,
        teacherNote: createFeedbackNote(understandingLevel, focusLevel),
        progress: getTodaySessionProgress(studentId),
      };
    },
  };
}

function createInitialContext(studentId: string, curriculum: CurriculumDefinition): StudentContext {
  return {
    studentId,
    selectedCurriculumId: curriculum.id,
    currentStepId: curriculum.initialProgress.currentStepId,
    completedStepIds: [...curriculum.initialProgress.completedStepIds],
    delayedStepIds: [],
    weakConcepts: [...curriculum.initialProgress.weakConcepts],
    completedLessonItemIds: [],
    lowFocusRecorded: false,
    maxSessionMinutes: 45,
  };
}

function getCurriculum(curriculumId: CurriculumId): CurriculumDefinition {
  const curriculum = mockCurriculums.find((item) => item.id === curriculumId);
  if (!curriculum) throw new Error(`존재하지 않는 mock 커리큘럼입니다: ${curriculumId}`);
  return curriculum;
}

function getRequiredStep(curriculum: CurriculumDefinition, stepId: string) {
  const step = curriculum.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`현재 단계를 찾을 수 없습니다: ${stepId}`);
  return step;
}

function getStepStatus(step: CurriculumDefinition["steps"][number], context: StudentContext) {
  if (context.completedStepIds.includes(step.id)) return "완료";
  if (context.delayedStepIds.includes(step.id)) return "연기됨";
  if (step.id === context.currentStepId) return "진행 중";
  if (step.conceptTags.some((concept) => context.weakConcepts.includes(concept))) return "보강 필요";
  return "예정";
}

function getTodayReasonCodes(context: StudentContext, currentStep: CurriculumDefinition["steps"][number]) {
  const reasonCodes = ["current_step_based"];
  if (currentStep.conceptTags.some((concept) => context.weakConcepts.includes(concept))) reasonCodes.push("weak_concept_review");
  if (context.lowFocusRecorded) reasonCodes.push("next_session_load_reduced");
  return reasonCodes;
}

function createExplanationItems(context: StudentContext, currentStep: CurriculumDefinition["steps"][number], delayedItems: LessonItem[]) {
  const explanationItems = [`현재 단계인 ${currentStep.title}을(를) 기준으로 수업을 편성했습니다.`];
  if (context.weakConcepts.length > 0) explanationItems.push(`취약 개념 ${context.weakConcepts.slice(0, 2).join("·")}을(를) 먼저 확인합니다.`);
  if (delayedItems.length > 0) explanationItems.push("선택 항목은 이월 후보로 분리했습니다.");
  return explanationItems;
}

function createFeedbackNote(understandingLevel: number, focusLevel: number) {
  if (understandingLevel <= 2) return "이해도가 낮게 기록되어, 해당 강의의 개념을 취약 개념으로 반영했습니다.";
  if (focusLevel <= 2) return "집중도가 낮게 기록되어, 다음 수업의 분량을 가볍게 조율하는 신호로 반영했습니다.";
  return "강의별 응답을 기록했고, 다음 추천 강의와 수업 조율에 반영하겠습니다.";
}

function addUniqueConcepts(target: string[], concepts: string[]) {
  concepts.forEach((concept) => {
    if (!target.includes(concept)) target.push(concept);
  });
}

function sumMinutes(items: LessonItem[]) {
  return items.reduce((total, item) => total + item.estimatedMinutes, 0);
}

type AdjustmentProposal = {
  id: string;
  studentId: string;
  request: InterpretedStudentRequest;
  proposedContext: StudentContext;
  createdAt: string;
};

type InterpretedStudentRequest = {
  kind: StudentRequestKind;
  conditionKinds: StudentRequestKind[];
  summary: string;
  teacherNote: string;
  maxSessionMinutes: number;
  focusConcept?: string;
  currentStepConcepts: string[];
};

function createTodaySessionFromContext(context: StudentContext): TodaySession {
  const curriculum = getCurriculum(context.selectedCurriculumId);
  const currentStep = getRequiredStep(curriculum, context.currentStepId);
  const { selectedItems, delayedItems } = fitItemsToMaxMinutes(currentStep.items, context.maxSessionMinutes);

  return {
    id: `${context.studentId}:${currentStep.id}`,
    date: new Date().toISOString().slice(0, 10),
    goal: currentStep.goal,
    estimatedMinutes: sumMinutes(selectedItems),
    items: selectedItems,
    delayedItems,
    reasonCodes: getTodayReasonCodes(context, currentStep),
    explanationItems: createExplanationItems(context, currentStep, delayedItems),
    adjustmentReason: "학생 요청을 반영해 수업량과 항목 순서를 조율했습니다.",
    teacherComment: "제안 내용을 확인해 주시면 오늘 수업에 반영하겠습니다.",
  };
}

function summarizeSession(session: TodaySession) {
  return {
    estimatedMinutes: session.estimatedMinutes,
    itemIds: session.items.map((item) => item.id),
    delayedItemIds: session.delayedItems.map((item) => item.id),
  };
}

function interpretStudentRequest(
  message: string,
  currentStep: CurriculumDefinition["steps"][number],
): InterpretedStudentRequest | undefined {
  const normalizedMessage = message.trim();
  const currentStepConcepts = currentStep.conceptTags;
  const focusConcept = currentStepConcepts.find((concept) => normalizedMessage.includes(concept));
  const conditionKinds: StudentRequestKind[] = [];
  const summaries: string[] = [];
  const teacherNotes: string[] = [];

  if (normalizedMessage.includes("시간") || normalizedMessage.includes("부족")) {
    conditionKinds.push("short_time");
    summaries.push("오늘 시간이 부족해요");
    teacherNotes.push("핵심 보강과 필수 확인만 남기고 선택 항목은 다음 수업 후보로 넘기겠습니다.");
  }

  if (normalizedMessage.includes("복습")) {
    conditionKinds.push("review_first");
    summaries.push("복습 위주로 진행하고 싶어요");
    teacherNotes.push("현재 단계의 헷갈린 개념을 먼저 안정시키겠습니다.");
  }

  if (normalizedMessage.includes("새 강의") || normalizedMessage.includes("진도") || normalizedMessage.includes("줄")) {
    conditionKinds.push("reduce_new_lecture");
    summaries.push("새 강의는 줄이고 싶어요");
    teacherNotes.push("새 강의 비중은 줄이고 꼭 필요한 확인과 보강을 중심으로 조절하겠습니다.");
  }

  if (focusConcept || normalizedMessage.includes("헷갈")) {
    conditionKinds.push("confused_concept");
    summaries.push(`${focusConcept ?? "현재 개념"}이 아직 헷갈려요`);
    teacherNotes.push("요청한 개념을 취약 개념으로 반영해 보강 흐름을 배치하겠습니다.");
  }

  if (conditionKinds.length === 0) return undefined;

  return {
    kind: conditionKinds[0],
    conditionKinds,
    summary: summaries.join(", "),
    teacherNote: teacherNotes.join(" "),
    maxSessionMinutes: conditionKinds.includes("short_time")
      ? 25
      : conditionKinds.includes("reduce_new_lecture")
        ? 30
        : conditionKinds.includes("review_first")
          ? 35
          : 40,
    focusConcept: focusConcept ?? (conditionKinds.includes("confused_concept") ? currentStepConcepts[0] : undefined),
    currentStepConcepts,
  };
}

function fitItemsToMaxMinutes(items: LessonItem[], maxMinutes: number) {
  const selectedItems = [...items];
  const delayedItems: LessonItem[] = [];

  while (sumMinutes(selectedItems) > maxMinutes && selectedItems.length > 1) {
    const deferredIndex = selectedItems.reduce((candidateIndex, item, index) => {
      const candidate = selectedItems[candidateIndex];
      return getDeferralPriority(item) >= getDeferralPriority(candidate) ? index : candidateIndex;
    }, 0);
    const [deferredItem] = selectedItems.splice(deferredIndex, 1);
    delayedItems.unshift(deferredItem);
  }

  return { selectedItems, delayedItems };
}

function getDeferralPriority(item: LessonItem) {
  if (!item.required) return 10;
  return { review: 1, check: 2, lecture: 3, practice: 4 }[item.kind];
}
