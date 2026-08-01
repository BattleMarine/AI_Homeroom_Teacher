export const demoStudentId = "000";

export type LessonItemKind = "lecture" | "review" | "practice" | "check";

export type ApiLessonItem = {
  id: string;
  kind: LessonItemKind;
  title: string;
  description: string;
  conceptTags: string[];
  estimatedMinutes: number;
  required: boolean;
  reason: string;
  playbackTargetId?: string;
};

export type ApiTodaySession = {
  id: string;
  date: string;
  goal: string;
  estimatedMinutes: number;
  items: ApiLessonItem[];
  delayedItems: ApiLessonItem[];
  reasonCodes: string[];
  explanationItems: string[];
  adjustmentReason: string;
  teacherComment: string;
};

export type ApiStudentContext = {
  studentId: string;
  selectedCurriculumId: string;
  currentStepId: string;
  completedStepIds: string[];
  delayedStepIds: string[];
  weakConcepts: string[];
  completedLessonItemIds: string[];
  lowFocusRecorded: boolean;
  maxSessionMinutes: number;
};

export type ApiCurriculumSummary = {
  id: string;
  title: string;
  pace: string;
  description: string;
  recommendedFor: string[];
  stepCount: number;
  selected: boolean;
  currentStepId: string | null;
};

export type ApiCurriculumMap = {
  curriculumId: string;
  curriculumTitle: string;
  currentStepId: string;
  completedStepIds: string[];
  delayedStepIds: string[];
  weakConcepts: string[];
  steps: Array<{
    id: string;
    title: string;
    conceptTags: string[];
    estimatedMinutes: number;
    status: "완료" | "진행 중" | "예정" | "보강 필요" | "연기됨";
  }>;
};

export type ApiTodaySessionProgress = {
  sessionId: string;
  completedItemIds: string[];
  completedItemCount: number;
  totalItemCount: number;
  progressPercent: number;
  completedItems: ApiLessonItem[];
  carryOverItems: ApiLessonItem[];
  isCompleted: boolean;
  nextRecommendedLesson: Pick<ApiLessonItem, "id" | "kind"> | null;
  teacherReport: string;
};

export type ApiLessonItemDetail = ApiLessonItem & {
  currentSessionId: string;
  sessionReason: string;
  completed: boolean;
  playback: {
    kind: "mock-video";
    targetId: string;
    mediaType: "image";
    contentType: string;
    mediaUrl: string;
    durationSeconds: number;
  } | null;
};

export type ApiSessionAdjustment = {
  adjustmentId: string;
  interpretedRequest: {
    kind: string;
    conditionKinds: string[];
    summary: string;
    focusConcept: string | null;
    maxSessionMinutes: number | null;
  };
  before: {
    estimatedMinutes: number;
    itemIds: string[];
    delayedItemIds: string[];
  };
  proposedSession: ApiTodaySession;
  teacherNote: string;
  requiresConfirmation: boolean;
  availableActions: string[];
};

export type ApiHealthResponse = {
  status: "ok";
  service: "ai-homeroom-api";
  dataSource: "mock";
};

export type CurriculumsApiResponse = {
  dataSource: "mock";
  curriculums: ApiCurriculumSummary[];
};

export type StudentContextApiResponse = {
  dataSource: "mock";
  studentContext: ApiStudentContext;
};

export type CurriculumSelectionApiResponse = {
  dataSource: "mock";
  studentContext: ApiStudentContext;
  session: ApiTodaySession;
  curriculumMap: ApiCurriculumMap;
};

export type TodaySessionApiResponse = {
  dataSource: "mock";
  session: ApiTodaySession;
};

export type TodaySessionProgressApiResponse = {
  dataSource: "mock";
  progress: ApiTodaySessionProgress;
};

export type CurriculumMapApiResponse = {
  dataSource: "mock";
  curriculumMap: ApiCurriculumMap;
};

export type LessonItemApiResponse = {
  dataSource: "mock";
  lessonItem: ApiLessonItemDetail;
};

export type TeacherMessageApiResponse = {
  dataSource: "mock";
  conversationId: string;
  responseType: "mock" | "llm";
  assistantMessage: string;
  requestedTools: string[];
  attachment: {
    type: "session-adjustment";
    data: ApiSessionAdjustment;
  } | null;
};

export type LessonFeedbackApiResponse = {
  dataSource: "mock";
  responseType: "mock";
  lessonId: string;
  recorded: boolean;
  completedLesson: ApiLessonItem;
  appliedFeedback: {
    understandingLevel: number;
    focusLevel: number;
  };
  weakConcepts: string[];
  reasonCodes: string[];
  teacherNote: string;
  progress: ApiTodaySessionProgress;
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

function withStudentId(path: string, studentId: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}studentId=${encodeURIComponent(studentId)}`;
}

async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) {
    if (import.meta.env.DEV) {
      console.warn("AI 담임 API 요청 실패", { path, status: response.status });
    }

    throw new TeacherApiRequestError({ path, status: response.status, kind: "http" });
  }

  try {
    return (await response.json()) as T;
  } catch {
    if (import.meta.env.DEV) {
      console.warn("AI 담임 API 응답 형식 오류", { path, status: response.status });
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

export function getCurriculums(studentId = demoStudentId) {
  return requestApi<CurriculumsApiResponse>(withStudentId("/api/curriculums", studentId));
}

export function selectCurriculum(studentId: string, curriculumId: string) {
  return requestApi<CurriculumSelectionApiResponse>("/api/student-context/curriculum", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, curriculumId }),
  });
}

export function getStudentContext(studentId = demoStudentId) {
  return requestApi<StudentContextApiResponse>(
    withStudentId("/api/student-context", studentId),
  );
}

export function getTodaySession(studentId = demoStudentId) {
  return requestApi<TodaySessionApiResponse>(withStudentId("/api/today-session", studentId));
}

export function getTodaySessionProgress(studentId = demoStudentId) {
  return requestApi<TodaySessionProgressApiResponse>(
    withStudentId("/api/today-session/progress", studentId),
  );
}

export function getCurriculumMap(studentId = demoStudentId) {
  return requestApi<CurriculumMapApiResponse>(
    withStudentId("/api/curriculum-map", studentId),
  );
}

export function getLessonItem(studentId: string, lessonItemId: string) {
  return requestApi<LessonItemApiResponse>(
    withStudentId(`/api/lesson-items/${encodeURIComponent(lessonItemId)}`, studentId),
  );
}

export function sendTeacherMessage(studentId: string, conversationId: string, message: string) {
  return requestApi<TeacherMessageApiResponse>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, message }),
    },
  );
}

export function confirmSessionAdjustment(studentId: string, adjustmentId: string) {
  return requestApi<CurriculumSelectionApiResponse>(
    `/api/session-adjustments/${encodeURIComponent(adjustmentId)}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    },
  );
}

export function recordLessonFeedback({
  studentId,
  lessonId,
  understandingLevel,
  focusLevel,
}: {
  studentId: string;
  lessonId: string;
  understandingLevel: number;
  focusLevel: number;
}) {
  return requestApi<LessonFeedbackApiResponse>("/api/lesson-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId, lessonId, understandingLevel, focusLevel }),
  });
}
