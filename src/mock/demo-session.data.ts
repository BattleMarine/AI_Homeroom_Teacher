import {
  getCurriculumMap,
  getRequiredCurriculumById,
} from "../features/curriculum";
import { generateTodaySession } from "../features/progress-orchestrator";
import type { DemoStudentState } from "../types/shared.types";

export const demoStudentState: DemoStudentState = {
  selectedCurriculumId: "stable-log",
  selectedCurriculumTitle: "안정형 커리큘럼",
  currentStepId: "log-graph",
  currentStepTitle: "로그함수 그래프",
  weakConcepts: ["점근선", "평행이동"],
  completedStepCount: 2,
  totalStepCount: 7,
  completedStepIds: ["log-meaning", "log-calculation"],
  delayedStepIds: [],
};

const demoCurriculum = getRequiredCurriculumById(demoStudentState.selectedCurriculumId);

export const demoTodaySession = generateTodaySession({
  studentState: demoStudentState,
});

export const demoCurriculumSteps = getCurriculumMap(demoCurriculum, {
  currentStepId: demoStudentState.currentStepId,
  completedStepIds: demoStudentState.completedStepIds,
  delayedStepIds: demoStudentState.delayedStepIds,
  weakConcepts: demoStudentState.weakConcepts,
});
