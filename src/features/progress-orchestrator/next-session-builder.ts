import {
  getNextStep,
  getRequiredCurrentStep,
  getRequiredCurriculumById,
  type CurriculumStep,
} from "../curriculum";
import { createNextSessionResponse } from "../teacher-response";
import type { LessonItem } from "../../types/shared.types";
import {
  createWeakConceptReviewItem,
  DEFAULT_TODAY_SESSION_MAX_MINUTES,
  fitLessonItemsToMaxMinutes,
  hasWeakConceptReviewItem,
  sumLessonMinutes,
} from "./orchestrator.rules";
import type {
  GeneratedNextSession,
  GenerateNextSessionInput,
  NextSessionReasonCode,
} from "./progress.types";

const REDUCED_NEXT_SESSION_MAX_MINUTES = 35;

export function generateNextSession({
  studentState,
  todaySession,
  learningAnalysis,
  previousDelayedItems = todaySession.delayedItems,
  maxMinutes = DEFAULT_TODAY_SESSION_MAX_MINUTES,
  date = getTomorrowDateText(),
}: GenerateNextSessionInput): GeneratedNextSession {
  const curriculum = getRequiredCurriculumById(studentState.selectedCurriculumId);
  const currentStep = getRequiredCurrentStep(curriculum, studentState.currentStepId);
  const nextStep = getNextStep(curriculum, studentState.currentStepId);
  const shouldDelayProgress = learningAnalysis.progressDelayRequired;
  const targetStep = shouldDelayProgress ? currentStep : nextStep ?? currentStep;
  const effectiveMaxMinutes = learningAnalysis.reduceNextSessionLoad
    ? Math.min(maxMinutes, REDUCED_NEXT_SESSION_MAX_MINUTES)
    : maxMinutes;
  const carryOverItems = createCarryOverItems({
    todayItems: todaySession.items,
    carryOverItemIds: learningAnalysis.carryOverItemIds,
  });
  const reasonCodes = getNextSessionReasonCodes({
    learningAnalysis,
    hasNextStep: Boolean(nextStep),
    shouldDelayProgress,
  });
  const lessonItems = buildNextLessonItems({
    targetStep,
    reviewConcepts: learningAnalysis.reviewConcepts,
    carryOverItems,
    previousDelayedItems,
    shouldDelayProgress,
  });
  const { selectedItems, delayedItems } = fitLessonItemsToMaxMinutes(
    lessonItems,
    effectiveMaxMinutes,
  );

  if (delayedItems.length > 0) {
    reasonCodes.push("session_time_limit");
  }

  const teacherResponse = createNextSessionResponse({
    targetStep,
    reviewConcepts: learningAnalysis.reviewConcepts,
    carryOverItems,
    delayedItems,
    maxMinutes: effectiveMaxMinutes,
    reasonCodes,
  });

  return {
    date,
    targetStepId: targetStep.id,
    targetStepTitle: targetStep.title,
    goal: shouldDelayProgress
      ? `${targetStep.title}에서 남은 필수 항목 마무리`
      : targetStep.goal,
    estimatedMinutes: sumLessonMinutes(selectedItems),
    items: selectedItems,
    reviewConcepts: learningAnalysis.reviewConcepts,
    carryOverItems,
    delayedItems,
    explanationItems: teacherResponse.explanationItems,
    reasonCodes,
    adjustmentReason: teacherResponse.adjustmentReason,
    teacherComment: teacherResponse.teacherComment,
  };
}

function buildNextLessonItems({
  targetStep,
  reviewConcepts,
  carryOverItems,
  previousDelayedItems,
  shouldDelayProgress,
}: {
  targetStep: CurriculumStep;
  reviewConcepts: string[];
  carryOverItems: LessonItem[];
  previousDelayedItems: LessonItem[];
  shouldDelayProgress: boolean;
}): LessonItem[] {
  const baseItems = shouldDelayProgress ? [] : [...targetStep.defaultItems];
  const reviewItems =
    reviewConcepts.length > 0 && !hasWeakConceptReviewItem(baseItems, reviewConcepts)
      ? [createWeakConceptReviewItem(reviewConcepts)]
      : [];
  const delayedCandidateItems = shouldDelayProgress ? [] : previousDelayedItems;

  return uniqueLessonItems([
    ...reviewItems,
    ...carryOverItems,
    ...delayedCandidateItems,
    ...baseItems,
  ]);
}

function createCarryOverItems({
  todayItems,
  carryOverItemIds,
}: {
  todayItems: LessonItem[];
  carryOverItemIds: string[];
}): LessonItem[] {
  const carryOverItemIdSet = new Set(carryOverItemIds);

  return todayItems
    .filter((item) => carryOverItemIdSet.has(item.id))
    .map((item) => ({
      ...item,
      id: `${item.id}-carry-over`,
      title: `${item.title} 이어서 마무리`,
      required: true,
      reason: "미완료 필수 항목 이월",
    }));
}

function getNextSessionReasonCodes({
  learningAnalysis,
  hasNextStep,
  shouldDelayProgress,
}: {
  learningAnalysis: GenerateNextSessionInput["learningAnalysis"];
  hasNextStep: boolean;
  shouldDelayProgress: boolean;
}): NextSessionReasonCode[] {
  const reasonCodes: NextSessionReasonCode[] = ["learning_check_based"];

  if (learningAnalysis.reviewRequired) {
    reasonCodes.push("review_inserted");
  }

  if (shouldDelayProgress) {
    reasonCodes.push("progress_delayed");
  } else if (hasNextStep) {
    reasonCodes.push("next_step_selected");
  } else {
    reasonCodes.push("curriculum_completed");
  }

  if (learningAnalysis.reduceNextSessionLoad) {
    reasonCodes.push("next_session_load_reduced");
  }

  return reasonCodes;
}

function uniqueLessonItems(items: LessonItem[]): LessonItem[] {
  const seenIds = new Set<string>();

  return items.filter((item) => {
    if (seenIds.has(item.id)) {
      return false;
    }

    seenIds.add(item.id);
    return true;
  });
}

function getTomorrowDateText(): string {
  const tomorrow = new Date();

  tomorrow.setDate(tomorrow.getDate() + 1);

  return tomorrow.toISOString().slice(0, 10);
}
