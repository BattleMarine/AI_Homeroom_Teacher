import type { TodaySessionResponseContext } from "./teacher-response.types";

export function createMockAdjustmentReason({
  currentStep,
  relatedWeakConcepts,
  delayedItems,
  maxMinutes,
}: TodaySessionResponseContext): string {
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

export function createMockTeacherComment({
  currentStep,
  relatedWeakConcepts,
  delayedItems,
}: TodaySessionResponseContext): string {
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
