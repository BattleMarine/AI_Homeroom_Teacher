import {
  getCurriculumMap,
  getRequiredCurrentStep,
  getRequiredCurriculumById,
  type CurriculumId,
} from "../features/curriculum";
import {
  analyzeLearningCheck,
  type LearningCheckSubmission,
} from "../features/learning-check";
import {
  generateNextSession,
  generateTodaySession,
  type GeneratedTodaySession,
} from "../features/progress-orchestrator";
import type { DemoStudentState } from "../types/shared.types";

type DemoProgressPreset = {
  currentStepId: string;
  weakConcepts: string[];
  completedStepIds: string[];
};

const demoProgressPresets: Record<CurriculumId, DemoProgressPreset> = {
  "stable-log": {
    currentStepId: "log-graph",
    weakConcepts: ["점근선", "평행이동"],
    completedStepIds: ["log-meaning", "log-calculation"],
  },
  "compressed-log": {
    currentStepId: "log-graph-core",
    weakConcepts: ["점근선", "그래프"],
    completedStepIds: ["log-core-summary", "log-calculation-check"],
  },
  "practice-log": {
    currentStepId: "graph-application",
    weakConcepts: ["그래프", "평행이동"],
    completedStepIds: ["log-calculation-check"],
  },
};

export function createDemoSessionData(selectedCurriculumId: CurriculumId = "stable-log") {
  const demoCurriculum = getRequiredCurriculumById(selectedCurriculumId);
  const progressPreset = demoProgressPresets[selectedCurriculumId];
  const currentStep = getRequiredCurrentStep(demoCurriculum, progressPreset.currentStepId);
  const demoStudentState: DemoStudentState = {
    selectedCurriculumId,
    selectedCurriculumTitle: demoCurriculum.title,
    currentStepId: currentStep.id,
    currentStepTitle: currentStep.title,
    weakConcepts: progressPreset.weakConcepts,
    completedStepCount: progressPreset.completedStepIds.length,
    totalStepCount: demoCurriculum.steps.length,
    completedStepIds: progressPreset.completedStepIds,
    delayedStepIds: [],
  };

  const demoTodaySession = generateTodaySession({
    studentState: demoStudentState,
  });

  const demoLearningCheckSubmission = createDemoLearningCheckSubmission(
    demoTodaySession,
    progressPreset.weakConcepts.slice(0, 1),
  );

  const demoLearningCheckAnalysis = analyzeLearningCheck({
    submission: demoLearningCheckSubmission,
    todaySession: demoTodaySession,
  });

  const demoNextSession = generateNextSession({
    studentState: demoStudentState,
    todaySession: demoTodaySession,
    learningAnalysis: demoLearningCheckAnalysis,
  });

  const demoCurriculumSteps = getCurriculumMap(demoCurriculum, {
    currentStepId: demoStudentState.currentStepId,
    completedStepIds: demoStudentState.completedStepIds,
    delayedStepIds: demoStudentState.delayedStepIds,
    weakConcepts: demoStudentState.weakConcepts,
  });

  return {
    demoCurriculum,
    demoStudentState,
    demoTodaySession,
    demoLearningCheckSubmission,
    demoLearningCheckAnalysis,
    demoNextSession,
    demoCurriculumSteps,
  };
}

export function createDemoLearningCheckSubmission(
  todaySession: GeneratedTodaySession,
  confusedConcepts: string[],
): LearningCheckSubmission {
  return {
    sessionDate: todaySession.date,
    completedItemIds: todaySession.items.slice(0, 2).map((item) => item.id),
    skippedItemIds: todaySession.items.slice(2).map((item) => item.id),
    understandingLevel: 2,
    focusLevel: 3,
    confusedConcepts,
    problemResult: {
      correctCount: 2,
      totalCount: 5,
    },
  };
}

const defaultDemoSessionData = createDemoSessionData();

export const demoCurriculum = defaultDemoSessionData.demoCurriculum;
export const demoStudentState = defaultDemoSessionData.demoStudentState;
export const demoTodaySession = defaultDemoSessionData.demoTodaySession;
export const demoLearningCheckSubmission =
  defaultDemoSessionData.demoLearningCheckSubmission;
export const demoLearningCheckAnalysis = defaultDemoSessionData.demoLearningCheckAnalysis;
export const demoNextSession = defaultDemoSessionData.demoNextSession;
export const demoCurriculumSteps = defaultDemoSessionData.demoCurriculumSteps;
