import type { LessonItem } from "../../types/shared.types";
import type {
  LearningCheckAnalysis,
  LearningCheckAnalysisInput,
  LearningCheckReasonCode,
  LearningRecommendation,
  ProblemResult,
} from "./learning-check.types";

const LOW_LEVEL_THRESHOLD = 2;
const LOW_PROBLEM_ACCURACY_THRESHOLD = 0.6;

export function analyzeLearningCheck({
  submission,
  todaySession,
}: LearningCheckAnalysisInput): LearningCheckAnalysis {
  const problemAccuracy = calculateProblemAccuracy(submission.problemResult);
  const carryOverItemIds = findIncompleteRequiredItemIds({
    items: todaySession.items,
    completedItemIds: submission.completedItemIds,
  });
  const reasonCodes: LearningCheckReasonCode[] = [];

  if (submission.understandingLevel <= LOW_LEVEL_THRESHOLD) {
    reasonCodes.push("low_understanding");
  }

  if (submission.focusLevel <= LOW_LEVEL_THRESHOLD) {
    reasonCodes.push("low_focus");
  }

  if (submission.confusedConcepts.length > 0) {
    reasonCodes.push("confused_concepts");
  }

  if (problemAccuracy !== null && problemAccuracy < LOW_PROBLEM_ACCURACY_THRESHOLD) {
    reasonCodes.push("low_problem_accuracy");
  }

  if (carryOverItemIds.length > 0) {
    reasonCodes.push("incomplete_required_items");
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push("stable_progress");
  }

  const reviewConcepts = getReviewConcepts({
    reasonCodes,
    confusedConcepts: submission.confusedConcepts,
    items: todaySession.items,
  });
  const reviewRequired = reviewConcepts.length > 0;
  const progressDelayRequired = carryOverItemIds.length > 0;
  const reduceNextSessionLoad = reasonCodes.includes("low_focus");

  return {
    reviewRequired,
    progressDelayRequired,
    reduceNextSessionLoad,
    reviewConcepts,
    carryOverItemIds,
    problemAccuracy,
    reasonCodes,
    recommendedActions: getRecommendedActions({
      reviewRequired,
      progressDelayRequired,
      reduceNextSessionLoad,
    }),
  };
}

export function calculateProblemAccuracy({
  correctCount,
  totalCount,
}: ProblemResult): number | null {
  if (totalCount <= 0) {
    return null;
  }

  return correctCount / totalCount;
}

function findIncompleteRequiredItemIds({
  items,
  completedItemIds,
}: {
  items: LessonItem[];
  completedItemIds: string[];
}): string[] {
  const completedItems = new Set(completedItemIds);

  return items
    .filter((item) => item.required && !completedItems.has(item.id))
    .map((item) => item.id);
}

function getReviewConcepts({
  reasonCodes,
  confusedConcepts,
  items,
}: {
  reasonCodes: LearningCheckReasonCode[];
  confusedConcepts: string[];
  items: LessonItem[];
}): string[] {
  const reviewConcepts = new Set(confusedConcepts);

  if (
    reasonCodes.includes("low_understanding") ||
    reasonCodes.includes("low_problem_accuracy")
  ) {
    items
      .filter((item) => item.required || item.kind === "practice" || item.kind === "check")
      .flatMap((item) => item.conceptTags)
      .forEach((concept) => reviewConcepts.add(concept));
  }

  return [...reviewConcepts];
}

function getRecommendedActions({
  reviewRequired,
  progressDelayRequired,
  reduceNextSessionLoad,
}: {
  reviewRequired: boolean;
  progressDelayRequired: boolean;
  reduceNextSessionLoad: boolean;
}): LearningRecommendation[] {
  const actions: LearningRecommendation[] = [];

  if (reviewRequired) {
    actions.push("insert_review");
  }

  if (progressDelayRequired) {
    actions.push("delay_progress");
  }

  if (reduceNextSessionLoad) {
    actions.push("reduce_next_session_load");
  }

  if (actions.length === 0) {
    actions.push("keep_pace");
  }

  return actions;
}
