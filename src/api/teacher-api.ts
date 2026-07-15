export type ApiHealthResponse = {
  status: "ok";
  service: "ai-homeroom-api";
  dataSource: "mock";
};

export type TodaySessionApiResponse = {
  dataSource: "mock";
  session: {
    goal: string;
    estimatedMinutes: number;
    items: Array<{
      id: string;
      kind: "lecture" | "review" | "practice" | "check";
      title: string;
      estimatedMinutes: number;
      required: boolean;
    }>;
  };
};

export type CurriculumMapApiResponse = {
  dataSource: "mock";
  curriculumMap: {
    curriculumId: string;
    curriculumTitle: string;
    currentStepId: string;
    steps: Array<{
      id: string;
      title: string;
      status: "completed" | "current" | "planned";
    }>;
  };
};

export type TeacherMessageApiResponse = {
  dataSource: "mock";
  conversationId: string;
  responseType: "mock";
  assistantMessage: string;
  requestedTools: string[];
};

export type LessonFeedbackApiResponse = {
  dataSource: "mock";
  responseType: "mock";
  lessonId: string;
  recorded: boolean;
  teacherNote: string;
};

export type LessonFeedbackApiInput = {
  lessonId: string;
  understandingLevel: number;
  focusLevel: number;
};

export type TeacherApiRequestFailureKind = "http" | "invalid-response";

export class TeacherApiRequestError extends Error {
  readonly path: string;
  readonly status: number;
  readonly kind: TeacherApiRequestFailureKind;

  constructor({
    path,
    status,
    kind,
  }: {
    path: string;
    status: number;
    kind: TeacherApiRequestFailureKind;
  }) {
    super("AI 담임 API 요청에 실패했습니다.");
    this.name = "TeacherApiRequestError";
    this.path = path;
    this.status = status;
    this.kind = kind;
  }
}

async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) {
    if (import.meta.env.DEV) {
      console.warn("AI 담임 API 요청 실패", {
        path,
        status: response.status,
      });
    }

    throw new TeacherApiRequestError({
      path,
      status: response.status,
      kind: "http",
    });
  }

  try {
    return (await response.json()) as T;
  } catch {
    if (import.meta.env.DEV) {
      console.warn("AI 담임 API 응답 형식 오류", {
        path,
        status: response.status,
      });
    }

    throw new TeacherApiRequestError({
      path,
      status: response.status,
      kind: "invalid-response",
    });
  }
}

export function getApiHealth() {
  return requestApi<ApiHealthResponse>("/api/health");
}

export function getTodaySession() {
  return requestApi<TodaySessionApiResponse>("/api/today-session");
}

export function getCurriculumMap() {
  return requestApi<CurriculumMapApiResponse>("/api/curriculum-map");
}

export function sendTeacherMessage(conversationId: string, message: string) {
  return requestApi<TeacherMessageApiResponse>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
}

export function recordLessonFeedback(input: LessonFeedbackApiInput) {
  return requestApi<LessonFeedbackApiResponse>("/api/lesson-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
