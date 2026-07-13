import {
  getRequiredCurrentStep,
  getRequiredCurriculumById,
  type CurriculumStep,
} from "../curriculum";
import { createTodaySessionResponse } from "../teacher-response";
import type { LessonItem } from "../../types/shared.types";
import {
  createWeakConceptReviewItem,
  DEFAULT_TODAY_SESSION_MAX_MINUTES,
  fitLessonItemsToMaxMinutes,
  getRelatedWeakConcepts,
  hasWeakConceptReviewItem,
  orderLessonItemsForToday,
  sumLessonMinutes,
} from "./orchestrator.rules";
import type {
  GeneratedTodaySession,
  GenerateTodaySessionInput,
  OrchestrationReasonCode,
} from "./progress.types";

export function generateTodaySession({
  studentState,
  maxMinutes = DEFAULT_TODAY_SESSION_MAX_MINUTES,
  date = getTodayDateText(),
}: GenerateTodaySessionInput): GeneratedTodaySession {
  const curriculum = getRequiredCurriculumById(studentState.selectedCurriculumId);
  const currentStep = getRequiredCurrentStep(curriculum, studentState.currentStepId);
  const relatedWeakConcepts = getRelatedWeakConcepts(currentStep, studentState.weakConcepts);
  const reasonCodes: OrchestrationReasonCode[] = ["current_step_based"];

  let lessonItems = buildInitialLessonItems(currentStep, relatedWeakConcepts);

  if (relatedWeakConcepts.length > 0) {
    reasonCodes.push("weak_concept_review");
    lessonItems = orderLessonItemsForToday(lessonItems, relatedWeakConcepts);
  }

  const { selectedItems, delayedItems } = fitLessonItemsToMaxMinutes(lessonItems, maxMinutes);

  if (delayedItems.length > 0) {
    reasonCodes.push("session_time_limit");
  }

  if (relatedWeakConcepts.length === 0 && delayedItems.length === 0) {
    reasonCodes.push("ready_for_next_step");
  }

  const teacherResponse = createTodaySessionResponse({
    currentStep,
    relatedWeakConcepts,
    delayedItems,
    maxMinutes,
    reasonCodes,
  });

  return {
    date,
    goal: currentStep.goal,
    estimatedMinutes: sumLessonMinutes(selectedItems),
    items: selectedItems,
    delayedItems,
    explanationItems: teacherResponse.explanationItems,
    reasonCodes,
    adjustmentReason: teacherResponse.adjustmentReason,
    teacherComment: teacherResponse.teacherComment,
  };
}

function buildInitialLessonItems(
  currentStep: CurriculumStep,
  relatedWeakConcepts: string[],
): LessonItem[] {
  const defaultItems = [...currentStep.defaultItems];

  if (
    relatedWeakConcepts.length === 0 ||
    hasWeakConceptReviewItem(defaultItems, relatedWeakConcepts)
  ) {
    return defaultItems;
  }

  return [createWeakConceptReviewItem(relatedWeakConcepts), ...defaultItems];
}

function getTodayDateText(): string {
  return new Date().toISOString().slice(0, 10);
}
