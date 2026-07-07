import {
  getRequiredCurrentStep,
  getRequiredCurriculumById,
  type CurriculumStep,
} from "../curriculum";
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

  return {
    date,
    goal: currentStep.goal,
    estimatedMinutes: sumLessonMinutes(selectedItems),
    items: selectedItems,
    delayedItems,
    reasonCodes,
    adjustmentReason: createAdjustmentReason({
      currentStep,
      relatedWeakConcepts,
      delayedItems,
      maxMinutes,
    }),
    teacherComment: createTeacherComment({
      currentStep,
      relatedWeakConcepts,
      delayedItems,
    }),
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

function createAdjustmentReason({
  currentStep,
  relatedWeakConcepts,
  delayedItems,
  maxMinutes,
}: {
  currentStep: CurriculumStep;
  relatedWeakConcepts: string[];
  delayedItems: LessonItem[];
  maxMinutes: number;
}): string {
  if (relatedWeakConcepts.length > 0 && delayedItems.length > 0) {
    return `${currentStep.title} 단계에서 ${relatedWeakConcepts.join(
      ", ",
    )} 개념 보강이 필요해 보강을 먼저 배치하고, ${maxMinutes}분 안에 들어오도록 선택 항목은 다음 수업 후보로 이동했습니다.`;
  }

  if (relatedWeakConcepts.length > 0) {
    return `${currentStep.title} 단계와 연결된 ${relatedWeakConcepts.join(
      ", ",
    )} 개념이 취약해 새 진도 전에 보강과 확인을 먼저 배치했습니다.`;
  }

  if (delayedItems.length > 0) {
    return `오늘 수업이 ${maxMinutes}분을 넘지 않도록 선택 항목 ${delayedItems.length}개를 다음 수업 후보로 이동했습니다.`;
  }

  return `${currentStep.title} 단계의 기본 학습 흐름을 기준으로 오늘 수업을 편성했습니다.`;
}

function createTeacherComment({
  currentStep,
  relatedWeakConcepts,
  delayedItems,
}: {
  currentStep: CurriculumStep;
  relatedWeakConcepts: string[];
  delayedItems: LessonItem[];
}): string {
  if (relatedWeakConcepts.length > 0) {
    const delayedMessage =
      delayedItems.length > 0
        ? " 시간이 넘치는 선택 항목은 다음 수업 후보로 넘기겠습니다."
        : "";

    return `오늘은 ${currentStep.title}을 진행하되, ${relatedWeakConcepts.join(
      ", ",
    )}를 먼저 안정시키겠습니다.${delayedMessage} 모르는 부분은 벌이 아니라 보강으로 처리하면 됩니다.`;
  }

  return `오늘은 ${currentStep.title}의 기본 흐름대로 진행하겠습니다. 끝난 뒤 체크 결과를 보고 다음 수업 앞에 보강이 필요한지 다시 조율하겠습니다.`;
}

function getTodayDateText(): string {
  return new Date().toISOString().slice(0, 10);
}
