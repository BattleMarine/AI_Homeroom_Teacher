import type {
  NextSessionResponseContext,
  TodaySessionResponseContext,
} from "./teacher-response.types";

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

export function createMockNextSessionAdjustmentReason({
  targetStep,
  reviewConcepts,
  carryOverItems,
  delayedItems,
  maxMinutes,
  reasonCodes,
}: NextSessionResponseContext): string {
  if (reasonCodes.includes("progress_delayed")) {
    return `학습 후 체크에서 미완료 필수 항목 ${carryOverItems.length}개가 확인되어, 다음 수업은 ${targetStep.title} 단계의 남은 항목을 먼저 마무리하도록 조율했습니다.`;
  }

  if (reviewConcepts.length > 0 && delayedItems.length > 0) {
    return `${reviewConcepts.join(
      ", ",
    )} 보강을 다음 수업 앞에 넣고, ${maxMinutes}분 안에 들어오도록 선택 항목 ${delayedItems.length}개는 다시 다음 후보로 이동했습니다.`;
  }

  if (reviewConcepts.length > 0) {
    return `학습 후 체크에서 ${reviewConcepts.join(
      ", ",
    )} 개념 보강이 필요해 보여, ${targetStep.title} 진도 앞에 짧은 복구 시간을 배치했습니다.`;
  }

  if (reasonCodes.includes("curriculum_completed")) {
    return "현재 커리큘럼의 마지막 단계까지 도달해, 다음 수업은 단원 마무리 점검 흐름으로 유지했습니다.";
  }

  return `학습 후 체크 결과가 안정적이어서 다음 단계인 ${targetStep.title} 수업으로 이동하도록 조율했습니다.`;
}

export function createMockNextSessionTeacherComment({
  targetStep,
  reviewConcepts,
  carryOverItems,
  delayedItems,
  reasonCodes,
}: NextSessionResponseContext): string {
  if (carryOverItems.length > 0) {
    return "다음 수업은 남은 필수 항목을 먼저 마무리하겠습니다. 오늘 계획보다 일부 진도가 늦어졌지만, 아직 복구 가능한 범위입니다.";
  }

  if (reviewConcepts.length > 0) {
    const delayedMessage =
      delayedItems.length > 0
        ? " 시간이 넘치는 선택 항목은 뒤로 미뤄 수업량을 조절하겠습니다."
        : "";

    return `다음 수업은 ${reviewConcepts.join(
      ", ",
    )}를 짧게 보강한 뒤 ${targetStep.title}로 넘어가겠습니다.${delayedMessage}`;
  }

  if (reasonCodes.includes("next_session_load_reduced")) {
    return `집중도 흐름을 고려해 다음 수업은 ${targetStep.title} 중심으로 조금 가볍게 편성하겠습니다.`;
  }

  return `다음 수업은 ${targetStep.title}로 자연스럽게 이어가겠습니다. 끝난 뒤에도 체크 결과를 보고 필요한 보강을 다시 붙이겠습니다.`;
}
