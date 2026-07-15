export const mockTodaySession = {
  goal: "로그함수 그래프의 점근선과 평행이동 정리",
  estimatedMinutes: 44,
  items: [
    {
      id: "review-asymptote",
      kind: "review",
      title: "점근선 보강 카드",
      estimatedMinutes: 6,
      required: true,
    },
    {
      id: "check-graph",
      kind: "check",
      title: "그래프 확인 문제 3개",
      estimatedMinutes: 5,
      required: true,
    },
    {
      id: "lecture-asymptote",
      kind: "lecture",
      title: "로그함수 그래프: 점근선과 정의역",
      estimatedMinutes: 9,
      required: true,
    },
    {
      id: "lecture-shift",
      kind: "lecture",
      title: "로그함수 그래프: 평행이동",
      estimatedMinutes: 9,
      required: true,
    },
  ],
} as const;

export const mockCurriculumMap = {
  curriculumId: "stable-log",
  curriculumTitle: "안정형 커리큘럼",
  currentStepId: "log-graph",
  steps: [
    { id: "log-intro", title: "로그의 뜻", status: "completed" },
    { id: "log-calculation", title: "로그 계산", status: "completed" },
    { id: "log-graph", title: "로그함수 그래프", status: "current" },
    { id: "log-equation", title: "로그방정식", status: "planned" },
  ],
} as const;

export function createMockTeacherMessage(message: string) {
  const normalizedMessage = message.trim();
  const isShortTimeRequest = normalizedMessage.includes("시간") || normalizedMessage.includes("부족");

  return {
    responseType: "mock" as const,
    assistantMessage: isShortTimeRequest
      ? "시간이 부족한 상황을 반영해 오늘 수업량을 다시 계산하겠습니다. 우선 취약 개념 복습과 필수 강의를 중심으로 편성안을 제안할게요."
      : "말씀해 주신 내용을 AI 담임이 이해했습니다. 현재 커리큘럼과 학습 기록을 바탕으로 다음 수업을 조율하겠습니다.",
    requestedTools: isShortTimeRequest ? ["adjust_curriculum"] : ["get_student_context"],
  };
}

export function createMockLearningFeedbackResult(
  lessonId: string,
  understandingLevel: number,
  focusLevel: number,
) {
  return {
    responseType: "mock" as const,
    lessonId,
    recorded: true,
    teacherNote:
      understandingLevel <= 2
        ? "이해도가 낮게 기록되어, 다음 수업 전에 핵심 개념을 짧게 다시 확인하도록 반영했습니다."
        : focusLevel <= 2
          ? "집중도가 낮게 기록되어, 다음 수업의 분량을 가볍게 조율하도록 반영했습니다."
          : "강의별 응답을 기록했고, 다음 수업 조율에 반영하겠습니다.",
  };
}
