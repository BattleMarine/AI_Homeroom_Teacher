import type { TeacherLlmTool } from "../teacher-llm/teacher-llm.types.js";

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

export function createMockTeacherMessage(message: string): {
  responseType: "mock";
  assistantMessage: string;
  requestedTools: TeacherLlmTool[];
} {
  const normalizedMessage = message.trim();
  const isCurriculumAdjustmentRequest =
    normalizedMessage.includes("시간") ||
    normalizedMessage.includes("부족") ||
    normalizedMessage.includes("복습") ||
    normalizedMessage.includes("새 강의") ||
    normalizedMessage.includes("진도") ||
    normalizedMessage.includes("헷갈");

  const requestedCurriculumTool = getRequestedCurriculumTool(normalizedMessage);

  return {
    responseType: "mock" as const,
    assistantMessage: requestedCurriculumTool
      ? "커리큘럼 도구에 요청을 전달해 기준 계획과 기한 정보를 계산했습니다. 현재는 모든 추천 유형이 같은 기준 계획을 사용합니다."
      : isCurriculumAdjustmentRequest
        ? "말씀해 주신 조건을 반영해 오늘 수업 분량과 보강 우선순위를 다시 계산했습니다. 제안안을 확인해 주시면 적용하겠습니다."
        : "말씀해 주신 내용을 AI 담임이 이해했습니다. 현재 커리큘럼과 학습 기록을 바탕으로 다음 수업을 조율하겠습니다.",
    requestedTools: requestedCurriculumTool
      ? [requestedCurriculumTool]
      : isCurriculumAdjustmentRequest
        ? ["adjust_today_session"]
        : ["get_student_context"],
  };
}

function getRequestedCurriculumTool(message: string): TeacherLlmTool | undefined {
  if (!message.includes("커리큘럼") && !message.includes("기한") && !message.includes("마감")) return undefined;
  if (message.includes("압축")) return "compress_curriculum_plan";
  if (message.includes("늘리") || message.includes("연장")) return "extend_curriculum_plan";
  if (message.includes("기한") || message.includes("마감")) return "assess_curriculum_deadline";
  if (message.includes("적용") || message.includes("확정")) return "apply_curriculum_plan";
  return "create_curriculum_plan";
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
