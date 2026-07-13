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

export function createMockTodaySessionExplanationItems({
  currentStep,
  relatedWeakConcepts,
  delayedItems,
  maxMinutes,
  reasonCodes,
}: TodaySessionResponseContext): string[] {
  const explanationItems = [
    `${currentStep.title} 단계가 현재 커리큘럼의 진행 기준입니다.`,
  ];

  if (reasonCodes.includes("weak_concept_review")) {
    explanationItems.push(
      `${relatedWeakConcepts.join(", ")} 개념이 현재 단계와 연결되어 있어 새 진도 앞에 보강을 배치했습니다.`,
    );
  }

  if (reasonCodes.includes("session_time_limit")) {
    explanationItems.push(
      `오늘 수업은 ${maxMinutes}분 안에 마치도록 선택 항목 ${delayedItems.length}개를 다음 후보로 넘겼습니다.`,
    );
  }

  if (reasonCodes.includes("ready_for_next_step")) {
    explanationItems.push(
      "현재 단계의 기본 흐름이 안정적이라 새 진도와 확인 문제를 균형 있게 배치했습니다.",
    );
  }

  explanationItems.push(
    "수업 후 체크 결과에 따라 다음 수업 앞에 보강이나 복구 시간을 다시 붙이겠습니다.",
  );

  return explanationItems;
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
    )}를 먼저 안정시키겠습니다.${delayedMessage} 지금 늦어진 부분이 있어도 복구 가능한 범위에서 조정하겠습니다.`;
  }

  return `오늘은 ${currentStep.title}의 기본 흐름대로 진행하겠습니다. 끝난 뒤 체크 결과를 보고 다음 수업 앞에 필요한 보강을 다시 조율하겠습니다.`;
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

export function createMockNextSessionExplanationItems({
  targetStep,
  reviewConcepts,
  carryOverItems,
  delayedItems,
  maxMinutes,
  reasonCodes,
}: NextSessionResponseContext): string[] {
  const explanationItems = [];

  if (reasonCodes.includes("progress_delayed")) {
    explanationItems.push(
      `오늘 마치지 못한 필수 항목 ${carryOverItems.length}개를 다음 수업 앞에 먼저 배치했습니다.`,
    );
  }

  if (reasonCodes.includes("review_inserted")) {
    explanationItems.push(
      `${reviewConcepts.join(", ")} 개념은 다음 진도 전에 짧게 보강합니다.`,
    );
  }

  if (reasonCodes.includes("next_session_load_reduced")) {
    explanationItems.push(
      "집중도 흐름을 고려해 다음 수업의 전체 부담을 조금 낮췄습니다.",
    );
  }

  if (reasonCodes.includes("session_time_limit")) {
    explanationItems.push(
      `${maxMinutes}분 안에 끝낼 수 있도록 선택 항목 ${delayedItems.length}개는 뒤로 넘겼습니다.`,
    );
  }

  if (reasonCodes.includes("next_step_selected")) {
    explanationItems.push(`${targetStep.title} 단계로 이어가도 되는 상태입니다.`);
  }

  if (reasonCodes.includes("curriculum_completed")) {
    explanationItems.push("현재 커리큘럼의 마지막 단계라 마무리 점검 흐름을 유지합니다.");
  }

  if (explanationItems.length === 0) {
    explanationItems.push(
      `${targetStep.title} 단계의 핵심 흐름을 유지하면서 다음 수업을 편성했습니다.`,
    );
  }

  explanationItems.push("다음 수업 후에도 체크 결과를 보고 보강 여부를 다시 판단합니다.");

  return explanationItems;
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
