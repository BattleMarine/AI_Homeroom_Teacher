import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  confirmSessionAdjustment,
  demoStudentId,
  getApiHealth,
  getCurriculums as getApiCurriculums,
  getCurriculumMap as getApiCurriculumMap,
  getLessonItem,
  getStudentContext,
  getTodaySession,
  getTodaySessionProgress,
  recordLessonFeedback,
  selectCurriculum,
  sendTeacherMessage,
  type ApiCurriculumSummary,
  type ApiLessonItem,
  type ApiSessionAdjustment,
  type ApiStudentContext,
  type ApiTodaySessionProgress,
  type CurriculumMapApiResponse,
  TeacherApiRequestError,
  type TodaySessionApiResponse,
} from "../api/teacher-api";
import { type CurriculumId, type CurriculumProgressStatus } from "../features/curriculum";
import {
  type LessonFeedback,
  type LearningCheckLevel,
  type LearningCheckSubmission,
} from "../features/learning-check";
import {
  applyStudentRequestToProgress,
  generateTodaySession,
  type StudentRequestKind,
} from "../features/progress-orchestrator";
import { createDemoSessionData } from "../mock/demo-session.data";
import type { LessonItem, LessonItemKind } from "../types/shared.types";
import type { DemoStep } from "./demo-flow.types";
import { readDemoStorageState, saveDemoStorageState } from "./demo-storage";

const kindLabels: Record<LessonItemKind, string> = {
  lecture: "강의",
  review: "보강",
  practice: "연습",
  check: "확인",
};

const curriculumStatusClassNames: Record<CurriculumProgressStatus, string> = {
  완료: "completed",
  "진행 중": "current",
  예정: "planned",
  "보강 필요": "review",
  연기됨: "delayed",
};

const demoStepOptions: Array<{
  step: DemoStep;
  label: string;
  description: string;
}> = [
  {
    step: "intro",
    label: "AI 담임 홈",
    description: "현재 상황에 맞는 첫 안내",
  },
  {
    step: "curriculum",
    label: "커리큘럼 추천",
    description: "초기 상태에서 학습 흐름 선택",
  },
  {
    step: "today",
    label: "수업 편성 도구",
    description: "AI 담임이 내부에서 오늘 수업을 계산",
  },
  {
    step: "request",
    label: "내부 요청 조율",
    description: "채팅 요청을 반영해 편성을 다시 계산",
  },
  {
    step: "reason",
    label: "배정 이유",
    description: "AI 담임의 조율 근거 설명",
  },
  {
    step: "learning-check",
    label: "강의별 학습 기록 도구",
    description: "강의 종료 직후 응답을 내부 기록",
  },
  {
    step: "next-session",
    label: "다음 수업 조율 도구",
    description: "누적 응답 기반 다음 수업을 내부 계산",
  },
  {
    step: "curriculum-map",
    label: "커리큘럼 맵",
    description: "전체 진도와 취약 개념 확인",
  },
];

const stepOrder = demoStepOptions.map((option) => option.step);
const aiResponseDelayMs = 500;
type ChatAttachment = DemoStep | "today-summary" | "progress-report" | "session-adjustment";

type TodaySessionSummary = {
  goal: string;
  estimatedMinutes: number;
  items: LessonItem[];
};

type ApiConnectionState = "loading" | "connected" | "error";

type LearningProgressReport = {
  completedLessonTitle: string;
  completedLectureCount: number;
  totalLectureCount: number;
  recommendedNextLessonId?: string;
  recommendedNextLessonTitle?: string;
  understandingLevel: LearningCheckLevel;
  focusLevel: LearningCheckLevel;
  teacherNote: string;
};

type NextLessonCountdown = {
  messageId: string;
  lesson: LessonItem;
  remainingSeconds: number;
};

type ChatTranscriptMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  attachmentStep?: ChatAttachment;
  todaySessionSummary?: TodaySessionSummary;
  learningProgressReport?: LearningProgressReport;
  sessionAdjustment?: ApiSessionAdjustment;
  isNextLessonCountdownNotice?: boolean;
};

function createApiTodaySessionSummary(
  apiSession: TodaySessionApiResponse["session"],
): TodaySessionSummary {
  return {
    goal: apiSession.goal,
    estimatedMinutes: apiSession.estimatedMinutes,
    items: apiSession.items.map(toLessonItem),
  };
}

function toLessonItem(item: ApiLessonItem): LessonItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    description: item.description,
    conceptTags: [...item.conceptTags],
    estimatedMinutes: item.estimatedMinutes,
    required: item.required,
    reason: item.reason,
  };
}

function getApiErrorMessage(
  error: unknown,
  context: "initial-load" | "lesson-feedback",
) {
  const fallbackMessage =
    context === "lesson-feedback"
      ? "AI 담임 API에 연결하지 못했습니다. 강의별 체크를 다시 전달해 주세요."
      : "AI 담임 API에 연결하지 못했습니다. 현재 화면은 기존 데모 데이터로 표시합니다.";

  if (!(error instanceof TeacherApiRequestError)) {
    return fallbackMessage;
  }

  if (error.status === 404) {
    return "AI 담임 API 경로를 찾지 못했습니다. 프론트 개발 서버를 API 프록시 설정으로 다시 시작해 주세요.";
  }

  if (error.status === 400) {
    return "학습 기록 형식을 확인해 주세요. 문제가 계속되면 백엔드 API 계약을 확인해 주세요.";
  }

  if (error.kind === "invalid-response") {
    return "AI 담임 API 응답을 읽지 못했습니다. 프록시와 API 서버 상태를 확인해 주세요.";
  }

  return fallbackMessage;
}

const studentRequestOptions: Array<{
  kind: StudentRequestKind;
  label: string;
  description: string;
}> = [
  {
    kind: "default",
    label: "기본 편성",
    description: "현재 진도와 취약 개념을 기준으로 균형 있게 진행합니다.",
  },
  {
    kind: "short_time",
    label: "오늘 시간이 부족해요",
    description: "핵심 보강과 필수 확인만 남기고 수업량을 줄입니다.",
  },
  {
    kind: "review_first",
    label: "복습 위주로 하고 싶어요",
    description: "새 진도보다 헷갈린 개념을 먼저 안정시킵니다.",
  },
  {
    kind: "confused_concept",
    label: "특정 개념이 헷갈려요",
    description: "현재 단계의 주요 개념을 보강 흐름에 반영합니다.",
  },
  {
    kind: "reduce_new_lecture",
    label: "새 강의는 줄이고 싶어요",
    description: "강의 비중을 줄이고 확인과 보강을 중심으로 조정합니다.",
  },
];

const understandingLevelOptions: Array<{
  level: LearningCheckLevel;
  label: string;
  description: string;
}> = [
  {
    level: 1,
    label: "하나도 모르겠습니다",
    description: "오늘 내용이 거의 잡히지 않았습니다.",
  },
  {
    level: 2,
    label: "잘 이해가 가지 않습니다",
    description: "설명은 들었지만 문제로 이어지지 않습니다.",
  },
  {
    level: 3,
    label: "조금 이해했습니다",
    description: "핵심 흐름은 알지만 아직 흔들립니다.",
  },
  {
    level: 4,
    label: "이해가 되었습니다",
    description: "비슷한 문제는 다시 풀 수 있을 것 같습니다.",
  },
  {
    level: 5,
    label: "설명할 수 있습니다",
    description: "개념과 풀이 이유를 말로 설명할 수 있습니다.",
  },
];

const focusLevelOptions: Array<{
  level: LearningCheckLevel;
  label: string;
  description: string;
}> = [
  {
    level: 1,
    label: "집중이 되지 않았습니다",
    description: "수업 대부분을 따라가기 어려웠습니다.",
  },
  {
    level: 2,
    label: "자주 흐트러졌습니다",
    description: "중간중간 놓친 부분이 많았습니다.",
  },
  {
    level: 3,
    label: "보통이었습니다",
    description: "큰 흐름은 따라갔지만 완전히 몰입하지는 못했습니다.",
  },
  {
    level: 4,
    label: "집중이 잘 되었습니다",
    description: "대부분의 수업을 안정적으로 따라갔습니다.",
  },
  {
    level: 5,
    label: "끝까지 몰입했습니다",
    description: "처음부터 끝까지 흔들림 없이 집중했습니다.",
  },
];

const immediateUnderstandingOptions: Array<{
  level: LearningCheckLevel;
  label: string;
}> = [
  { level: 1, label: "이해가 어려웠어요" },
  { level: 3, label: "대체로 이해했어요" },
  { level: 5, label: "잘 이해했어요" },
];

const immediateFocusOptions: Array<{
  level: LearningCheckLevel;
  label: string;
}> = [
  { level: 1, label: "집중이 어려웠어요" },
  { level: 3, label: "보통이었어요" },
  { level: 5, label: "집중했어요" },
];

function createFeedbackBasedLearningCheckSubmission(
  todaySession: { date: string; items: LessonItem[] },
  lessonFeedbacks: LessonFeedback[],
): LearningCheckSubmission {
  const relevantFeedbacks = lessonFeedbacks.filter((feedback) =>
    todaySession.items.some((item) => item.id === feedback.lessonItemId),
  );
  const averageLevel = (
    field: "understandingLevel" | "focusLevel",
  ): LearningCheckLevel => {
    if (relevantFeedbacks.length === 0) {
      return 3;
    }

    const total = relevantFeedbacks.reduce((sum, feedback) => sum + feedback[field], 0);
    return Math.min(5, Math.max(1, Math.round(total / relevantFeedbacks.length))) as LearningCheckLevel;
  };
  const algorithmDetectedConcepts = relevantFeedbacks
    .filter((feedback) => feedback.understandingLevel <= 2)
    .flatMap((feedback) => feedback.conceptTags);
  const completedLectureIds = new Set(
    relevantFeedbacks.map((feedback) => feedback.lessonItemId),
  );
  const completedItemIds = todaySession.items
    .filter(
      (item) => item.kind !== "lecture" || completedLectureIds.has(item.id),
    )
    .map((item) => item.id);

  return {
    sessionDate: todaySession.date,
    completedItemIds,
    skippedItemIds: todaySession.items
      .filter((item) => !completedItemIds.includes(item.id))
      .map((item) => item.id),
    understandingLevel: averageLevel("understandingLevel"),
    focusLevel: averageLevel("focusLevel"),
    confusedConcepts: [...new Set(algorithmDetectedConcepts)],
    problemResult: {
      correctCount: 0,
      totalCount: 0,
    },
  };
}

export function App() {
  const [initialDemoStorageState] = useState(() => readDemoStorageState());
  const [selectedCurriculumId, setSelectedCurriculumId] =
    useState<string | null>(null);
  const [learningCheckSubmission, setLearningCheckSubmission] =
    useState<LearningCheckSubmission | null>(
      () => initialDemoStorageState?.learningCheckSubmission ?? null,
    );
  const [studentRequestKind, setStudentRequestKind] =
    useState<StudentRequestKind>(
      () => initialDemoStorageState?.studentRequestKind ?? "default",
    );
  const [currentDemoStep, setCurrentDemoStep] = useState<DemoStep>(
    () => initialDemoStorageState?.currentDemoStep ?? "intro",
  );
  const [homeDraftMessage, setHomeDraftMessage] = useState("");
  const [isAssistantPreparing, setIsAssistantPreparing] = useState(false);
  const [apiConnectionState, setApiConnectionState] = useState<ApiConnectionState>("loading");
  const [apiConnectionError, setApiConnectionError] = useState<string | null>(null);
  const [apiCurriculums, setApiCurriculums] = useState<ApiCurriculumSummary[]>([]);
  const [apiStudentContext, setApiStudentContext] = useState<ApiStudentContext | null>(null);
  const [apiTodaySession, setApiTodaySession] = useState<TodaySessionApiResponse | null>(
    null,
  );
  const [apiCurriculumMap, setApiCurriculumMap] = useState<CurriculumMapApiResponse | null>(
    null,
  );
  const [apiSessionProgress, setApiSessionProgress] = useState<ApiTodaySessionProgress | null>(
    null,
  );
  const [pendingSessionAdjustment, setPendingSessionAdjustment] =
    useState<ApiSessionAdjustment | null>(null);
  const [isSessionAdjustmentConfirming, setIsSessionAdjustmentConfirming] = useState(false);
  const [activeLesson, setActiveLesson] = useState<LessonItem | null>(null);
  const [isMockLessonPlaying, setIsMockLessonPlaying] = useState(false);
  const [isLessonFeedbackSubmitting, setIsLessonFeedbackSubmitting] = useState(false);
  const [lessonFeedbackError, setLessonFeedbackError] = useState<string | null>(null);
  const [lessonFeedbacks, setLessonFeedbacks] = useState<LessonFeedback[]>(
    () => initialDemoStorageState?.lessonFeedbacks ?? [],
  );
  const chatMessageIdRef = useRef(0);
  const conversationThreadRef = useRef<HTMLDivElement | null>(null);
  const nextLessonCountdownIntervalRef = useRef<number | null>(null);
  const nextLessonCountdownTimeoutRef = useRef<number | null>(null);
  const [nextLessonCountdown, setNextLessonCountdown] = useState<NextLessonCountdown | null>(
    null,
  );
  const [chatMessages, setChatMessages] = useState<ChatTranscriptMessage[]>(() => [
    {
      id: "assistant-welcome",
      role: "assistant",
      text: "안녕하세요. 저는 오늘 수업을 편성하고, 학생의 요구사항과 학습 결과에 맞춰 진도를 조율하는 AI 담임입니다.",
    },
    {
      id: "assistant-initial",
      role: "assistant",
      text:
        initialDemoStorageState?.selectedCurriculumId === null ||
        initialDemoStorageState?.selectedCurriculumId === undefined
          ? "아직 선택된 커리큘럼이 없습니다. 먼저 학습 흐름을 정하면, 그 기준으로 오늘 수업을 바로 편성하겠습니다."
          : "선택한 커리큘럼을 기준으로 오늘 수업을 편성할 준비가 되었습니다. 현재 상황이나 원하는 학습 방식을 말해 주세요.",
      attachmentStep: getVisibleAttachmentStep(
        initialDemoStorageState?.currentDemoStep ?? "intro",
      ),
    },
  ]);

  const selectedCurriculumIdForData = (selectedCurriculumId ?? "stable-log") as CurriculumId;
  const hasSelectedCurriculum = selectedCurriculumId !== null;
  const { demoCurriculum, demoStudentState } = useMemo(
    () => createDemoSessionData(selectedCurriculumIdForData),
    [selectedCurriculumIdForData],
  );
  const currentStepConcepts = useMemo(
    () =>
      demoCurriculum.steps.find((step) => step.id === demoStudentState.currentStepId)
        ?.conceptTags ?? [],
    [demoCurriculum.steps, demoStudentState.currentStepId],
  );
  const studentRequestAdjustment = useMemo(
    () =>
      applyStudentRequestToProgress({
        studentState: demoStudentState,
        requestKind: studentRequestKind,
        focusConcept: demoStudentState.weakConcepts[0],
        currentStepConcepts,
      }),
    [currentStepConcepts, demoStudentState, studentRequestKind],
  );
  const adjustedStudentState = studentRequestAdjustment.adjustedStudentState;
  const demoTodaySession = useMemo(
    () =>
      generateTodaySession({
        studentState: adjustedStudentState,
        maxMinutes: studentRequestAdjustment.maxMinutes,
      }),
    [adjustedStudentState, studentRequestAdjustment.maxMinutes],
  );
  const apiTodaySessionSummary = useMemo(
    () =>
      apiTodaySession
        ? createApiTodaySessionSummary(apiTodaySession.session)
        : null,
    [apiTodaySession],
  );
  const displayedCurriculumSteps = useMemo(() => {
    if (!apiCurriculumMap) {
      return [];
    }

    return apiCurriculumMap.curriculumMap.steps;
  }, [apiCurriculumMap]);
  const defaultLearningCheckSubmission = useMemo(
    () =>
      createFeedbackBasedLearningCheckSubmission(
        demoTodaySession,
        lessonFeedbacks,
      ),
    [demoTodaySession, lessonFeedbacks],
  );

  useEffect(() => {
    if (learningCheckSubmission === null) {
      setLearningCheckSubmission(defaultLearningCheckSubmission);
    }
  }, [defaultLearningCheckSubmission, learningCheckSubmission]);

  const activeLearningCheckSubmission =
    learningCheckSubmission ?? defaultLearningCheckSubmission;

  useEffect(() => {
    let isCancelled = false;

    async function loadApiData() {
      setApiConnectionState("loading");
      setApiConnectionError(null);

      try {
        const [, curriculums, studentContext, todaySession, curriculumMap] = await Promise.all([
          getApiHealth(),
          getApiCurriculums(demoStudentId),
          getStudentContext(demoStudentId),
          getTodaySession(demoStudentId),
          getApiCurriculumMap(demoStudentId),
        ]);

        if (isCancelled) {
          return;
        }

        setApiCurriculums(curriculums.curriculums);
        setApiStudentContext(studentContext.studentContext);
        setApiTodaySession(todaySession);
        setApiCurriculumMap(curriculumMap);
        setSelectedCurriculumId(studentContext.studentContext.selectedCurriculumId);
        setApiConnectionState("connected");

        void getTodaySessionProgress(demoStudentId)
          .then((response) => {
            if (!isCancelled) {
              setApiSessionProgress(response.progress);
            }
          })
          .catch(() => {
            if (!isCancelled) {
              setApiSessionProgress(null);
            }
          });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setApiConnectionState("error");
        setApiConnectionError(getApiErrorMessage(error, "initial-load"));
      }
    }

    void loadApiData();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    saveDemoStorageState({
      selectedCurriculumId,
      studentRequestKind,
      learningCheckSubmission: activeLearningCheckSubmission,
      lessonFeedbacks,
      currentDemoStep,
    });
  }, [
    activeLearningCheckSubmission,
    currentDemoStep,
    lessonFeedbacks,
    selectedCurriculumId,
    studentRequestKind,
  ]);

  useEffect(() => {
    const threadElement = conversationThreadRef.current;

    if (!threadElement) {
      return;
    }

    threadElement.scrollTo({
      top: threadElement.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages, isAssistantPreparing]);

  useEffect(
    () => () => {
      clearNextLessonCountdownTimers();
    },
    [],
  );

  const displayedCurriculumTitle = apiCurriculumMap?.curriculumMap.curriculumTitle;
  const displayedCurrentStep = apiCurriculumMap?.curriculumMap.steps.find(
    (step) => step.id === apiCurriculumMap.curriculumMap.currentStepId,
  );
  const displayedCompletedStepCount = apiCurriculumMap?.curriculumMap.completedStepIds.length ?? 0;
  const displayedStepCount = apiCurriculumMap?.curriculumMap.steps.length ?? 0;
  const displayedProgressPercent =
    displayedStepCount > 0
      ? Math.round((displayedCompletedStepCount / displayedStepCount) * 100)
      : 0;
  function createChatMessageId(prefix: string) {
    chatMessageIdRef.current += 1;
    return `${prefix}-${Date.now()}-${chatMessageIdRef.current}`;
  }

  function getVisibleAttachmentStep(step: ChatAttachment): ChatAttachment {
    if (step === "today" || step === "request") {
      return "today-summary";
    }

    if (step === "learning-check" || step === "next-session") {
      return "progress-report";
    }

    return step;
  }

  function createTodaySessionSummary(
    session: Pick<TodaySessionSummary, "goal" | "estimatedMinutes" | "items">,
  ): TodaySessionSummary {
    return {
      goal: session.goal,
      estimatedMinutes: session.estimatedMinutes,
      items: session.items.map((item) => ({
        ...item,
        conceptTags: [...item.conceptTags],
      })),
    };
  }

  function getDisplayedTodaySessionSummary() {
    return (
      apiTodaySessionSummary ?? {
        goal: "수업 정보를 불러오는 중입니다.",
        estimatedMinutes: 0,
        items: [],
      }
    );
  }

  async function refreshServerState() {
    const [studentContext, todaySession, curriculumMap, curriculums] = await Promise.all([
      getStudentContext(demoStudentId),
      getTodaySession(demoStudentId),
      getApiCurriculumMap(demoStudentId),
      getApiCurriculums(demoStudentId),
    ]);

    setApiStudentContext(studentContext.studentContext);
    setApiTodaySession(todaySession);
    setApiCurriculumMap(curriculumMap);
    setApiCurriculums(curriculums.curriculums);
    setSelectedCurriculumId(studentContext.studentContext.selectedCurriculumId);

    try {
      const progress = await getTodaySessionProgress(demoStudentId);
      setApiSessionProgress(progress.progress);
    } catch {
      setApiSessionProgress(null);
    }
  }

  function applyCurriculumSnapshot(snapshot: {
    studentContext: ApiStudentContext;
    session: TodaySessionApiResponse["session"];
    curriculumMap: CurriculumMapApiResponse["curriculumMap"];
  }) {
    setApiStudentContext(snapshot.studentContext);
    setApiTodaySession({ dataSource: "mock", session: snapshot.session });
    setApiCurriculumMap({ dataSource: "mock", curriculumMap: snapshot.curriculumMap });
    setSelectedCurriculumId(snapshot.studentContext.selectedCurriculumId);
  }

  function createLearningProgressReportFromApi({
    completedLesson,
    appliedFeedback,
    teacherNote,
    progress,
    recommendedLesson,
  }: {
    completedLesson: ApiLessonItem;
    appliedFeedback: { understandingLevel: number; focusLevel: number };
    teacherNote: string;
    progress: ApiTodaySessionProgress;
    recommendedLesson: LessonItem | null;
  }): LearningProgressReport {
    return {
      completedLessonTitle: completedLesson.title,
      completedLectureCount: progress.completedItemCount,
      totalLectureCount: progress.totalItemCount,
      recommendedNextLessonId: recommendedLesson?.id,
      recommendedNextLessonTitle: recommendedLesson?.title,
      understandingLevel: appliedFeedback.understandingLevel as LearningCheckLevel,
      focusLevel: appliedFeedback.focusLevel as LearningCheckLevel,
      teacherNote: teacherNote || progress.teacherReport,
    };
  }

  function createLearningProgressReport(
    feedbacks: LessonFeedback[] = lessonFeedbacks,
    apiTeacherNote?: string,
  ): LearningProgressReport {
    const latestFeedback = feedbacks[feedbacks.length - 1];
    const lectureItemIds = new Set(
      demoTodaySession.items
        .filter((item) => item.kind === "lecture")
        .map((item) => item.id),
    );
    const completedLectureCount = feedbacks.filter((feedback) =>
      lectureItemIds.has(feedback.lessonItemId),
    ).length;
    const understandingLevel = latestFeedback?.understandingLevel ?? 3;
    const focusLevel = latestFeedback?.focusLevel ?? 3;
    const recommendedNextLesson = getRecommendedNextLesson(feedbacks);
    const teacherNote =
      apiTeacherNote ??
      (understandingLevel <= 2
        ? "이 강의의 핵심 개념을 다음 수업 전에 짧게 다시 확인하도록 내부 반영했습니다."
        : focusLevel <= 2
          ? "다음 수업의 분량을 가볍게 조율하도록 내부 반영했습니다."
          : "현재 응답을 바탕으로 다음 수업의 흐름을 내부적으로 조율합니다.");

    return {
      completedLessonTitle: latestFeedback?.lessonTitle ?? "아직 완료한 강의가 없습니다.",
      completedLectureCount,
      totalLectureCount: lectureItemIds.size,
      recommendedNextLessonId: recommendedNextLesson?.id,
      recommendedNextLessonTitle: recommendedNextLesson?.title,
      understandingLevel,
      focusLevel,
      teacherNote,
    };
  }

  function getRecommendedNextLesson(
    feedbacks: LessonFeedback[] = lessonFeedbacks,
  ): LessonItem | null {
    const completedLessonIds = new Set(
      feedbacks.map((feedback) => feedback.lessonItemId),
    );

    return (
      demoTodaySession.items.find(
        (item) => item.kind === "lecture" && !completedLessonIds.has(item.id),
      ) ?? null
    );
  }

  function appendAssistantMessage(
    step: DemoStep,
    text?: string,
    todaySessionSummary?: TodaySessionSummary,
    learningProgressReport?: LearningProgressReport,
  ) {
    const attachmentStep = getVisibleAttachmentStep(step);

    setChatMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createChatMessageId("assistant"),
        role: "assistant",
        text: text ?? getAssistantMessage(step),
        attachmentStep,
        todaySessionSummary:
          attachmentStep === "today-summary"
            ? (todaySessionSummary ?? getDisplayedTodaySessionSummary())
            : undefined,
        learningProgressReport:
          attachmentStep === "progress-report"
            ? (learningProgressReport ?? createLearningProgressReport())
            : undefined,
      },
    ]);
  }

  function moveToStepWithAssistantResponse(
    step: DemoStep,
    text?: string,
    action?: () => void,
  ) {
    action?.();
    setCurrentDemoStep(step);
    appendAssistantMessage(step, text);
  }

  function sendUserMessageAndPrepareResponse({
    message,
    nextStep,
    assistantText,
    action,
    todaySessionSummary,
    learningProgressReport,
    requestTeacherMessage = false,
  }: {
    message: string;
    nextStep: DemoStep;
    assistantText?: string;
    action?: () => void;
    todaySessionSummary?: TodaySessionSummary;
    learningProgressReport?: LearningProgressReport;
    requestTeacherMessage?: boolean;
  }) {
    const trimmedMessage = message.trim();

    if (!trimmedMessage || isAssistantPreparing) {
      return;
    }

    setChatMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createChatMessageId("user"),
        role: "user",
        text: trimmedMessage,
      },
    ]);
    setHomeDraftMessage("");
    setIsAssistantPreparing(true);

    window.setTimeout(() => {
      const appendResponse = (
        responseText: string,
        sessionAdjustment?: ApiSessionAdjustment,
        showAttachment = true,
      ) => {
        setCurrentDemoStep(nextStep);
        const attachmentStep = sessionAdjustment
          ? "session-adjustment"
          : showAttachment
            ? getVisibleAttachmentStep(nextStep)
            : undefined;
        setChatMessages((currentMessages) => [
          ...currentMessages,
          {
            id: createChatMessageId("assistant"),
            role: "assistant",
            text: responseText,
            attachmentStep,
            todaySessionSummary:
              attachmentStep === "today-summary"
                ? (todaySessionSummary ?? getDisplayedTodaySessionSummary())
                : undefined,
            learningProgressReport:
              attachmentStep === "progress-report"
                ? (learningProgressReport ?? createLearningProgressReport())
                : undefined,
            sessionAdjustment,
          },
        ]);
        setPendingSessionAdjustment(sessionAdjustment ?? null);
        setIsAssistantPreparing(false);
        action?.();
      };

      const fallbackText = assistantText ?? getAssistantMessage(nextStep);

      if (!requestTeacherMessage) {
        appendResponse(fallbackText);
        return;
      }

      void sendTeacherMessage(demoStudentId, "frontend-conversation", trimmedMessage)
        .then((response) => {
          setApiConnectionState("connected");
          setApiConnectionError(null);
          appendResponse(response.assistantMessage, response.attachment?.data);
        })
        .catch((error) => {
          setApiConnectionState("error");
          const errorMessage = getApiErrorMessage(error, "initial-load");
          setApiConnectionError(errorMessage);
          appendResponse(errorMessage, undefined, false);
        });
    }, aiResponseDelayMs);
  }

  function clearNextLessonCountdownTimers() {
    if (nextLessonCountdownIntervalRef.current !== null) {
      window.clearInterval(nextLessonCountdownIntervalRef.current);
      nextLessonCountdownIntervalRef.current = null;
    }

    if (nextLessonCountdownTimeoutRef.current !== null) {
      window.clearTimeout(nextLessonCountdownTimeoutRef.current);
      nextLessonCountdownTimeoutRef.current = null;
    }
  }

  function updateNextLessonCountdownMessage(messageId: string, text: string) {
    setChatMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? { ...message, text, isNextLessonCountdownNotice: false }
          : message,
      ),
    );
  }

  function cancelNextLessonCountdown() {
    if (nextLessonCountdown === null) {
      return;
    }

    clearNextLessonCountdownTimers();
    updateNextLessonCountdownMessage(
      nextLessonCountdown.messageId,
      `'${nextLessonCountdown.lesson.title}' 자동 재생을 취소했습니다. 준비되면 오늘의 학습 안내에서 직접 열 수 있어요.`,
    );
    setNextLessonCountdown(null);
  }

  function playNextLessonNow() {
    if (nextLessonCountdown === null) {
      return;
    }

    clearNextLessonCountdownTimers();
    updateNextLessonCountdownMessage(
      nextLessonCountdown.messageId,
      `'${nextLessonCountdown.lesson.title}' 강의를 바로 재생합니다.`,
    );
    const lesson = nextLessonCountdown.lesson;
    setNextLessonCountdown(null);
    openMockLesson(lesson);
  }

  function playLessonFromProgressReport(lesson: LessonItem) {
    if (nextLessonCountdown !== null) {
      clearNextLessonCountdownTimers();
      updateNextLessonCountdownMessage(
        nextLessonCountdown.messageId,
        `'${nextLessonCountdown.lesson.title}' 자동 재생을 멈추고 선택한 강의를 재생합니다.`,
      );
      setNextLessonCountdown(null);
    }

    openMockLesson(lesson);
  }

  function beginNextLessonCountdown(nextLesson: LessonItem) {
    clearNextLessonCountdownTimers();
    const messageId = createChatMessageId("assistant-countdown");

    setNextLessonCountdown({
      messageId,
      lesson: nextLesson,
      remainingSeconds: 5,
    });
    setChatMessages((currentMessages) => [
      ...currentMessages,
      {
        id: messageId,
        role: "assistant",
        text: `'${nextLesson.title}' 강의를 5초 뒤에 재생합니다.`,
        isNextLessonCountdownNotice: true,
      },
    ]);
    nextLessonCountdownIntervalRef.current = window.setInterval(() => {
      setNextLessonCountdown((currentCountdown) =>
        currentCountdown?.messageId === messageId
          ? {
              ...currentCountdown,
              remainingSeconds: Math.max(0, currentCountdown.remainingSeconds - 1),
            }
          : currentCountdown,
      );
    }, 1000);
    nextLessonCountdownTimeoutRef.current = window.setTimeout(() => {
      clearNextLessonCountdownTimers();
      updateNextLessonCountdownMessage(
        messageId,
        `'${nextLesson.title}' 강의를 이어서 시작합니다.`,
      );
      setNextLessonCountdown(null);
      openMockLesson(nextLesson);
    }, 5000);
  }

  function goToPreviousStep() {
    const currentIndex = stepOrder.indexOf(currentDemoStep);
    const previousIndex = currentIndex <= 0 ? stepOrder.length - 1 : currentIndex - 1;
    const previousStep = stepOrder[previousIndex];
    moveToStepWithAssistantResponse(
      previousStep,
      `시연 단계를 '${demoStepOptions[previousIndex].label}' 단계로 이동했습니다.`,
    );
  }

  function goToNextStep() {
    const currentIndex = stepOrder.indexOf(currentDemoStep);
    const nextIndex = currentIndex >= stepOrder.length - 1 ? 0 : currentIndex + 1;
    const nextStep = stepOrder[nextIndex];
    moveToStepWithAssistantResponse(
      nextStep,
      `시연 단계를 '${demoStepOptions[nextIndex].label}' 단계로 이동했습니다.`,
    );
  }

  function resetDemoFlow() {
    clearNextLessonCountdownTimers();
    setSelectedCurriculumId(null);
    setStudentRequestKind("default");
    setLearningCheckSubmission(null);
    setLessonFeedbacks([]);
    setHomeDraftMessage("");
    setIsAssistantPreparing(false);
    setNextLessonCountdown(null);
    setChatMessages([
      {
        id: createChatMessageId("assistant"),
        role: "assistant",
        text: "안녕하세요. 저는 오늘 수업을 편성하고, 학생의 요구사항과 학습 결과에 맞춰 진도를 조율하는 AI 담임입니다.",
      },
      {
        id: createChatMessageId("assistant"),
        role: "assistant",
        text: "아직 선택된 커리큘럼이 없습니다. 먼저 학습 흐름을 정하면, 그 기준으로 오늘 수업을 바로 편성하겠습니다.",
        attachmentStep: "intro",
      },
    ]);
    setCurrentDemoStep("intro");
  }

  function handleSelectCurriculum(curriculumId: CurriculumId) {
    setSelectedCurriculumId(curriculumId);
    setStudentRequestKind("default");
    setLearningCheckSubmission(null);
    setLessonFeedbacks([]);
    setCurrentDemoStep("today");
  }

  function applyStudentRequest(requestKind: StudentRequestKind) {
    setStudentRequestKind(requestKind);
    setLearningCheckSubmission(null);
  }

  function handleSelectCurriculumFromChat(curriculumId: CurriculumId) {
    const selectedCurriculum = apiCurriculums.find(
      (curriculum) => curriculum.id === curriculumId,
    );
    const { demoStudentState: studentState } = createDemoSessionData(curriculumId);
    const todaySession = generateTodaySession({ studentState });

    sendUserMessageAndPrepareResponse({
      message: `${selectedCurriculum?.title ?? "선택한 커리큘럼"}으로 시작할게요.`,
      nextStep: "today",
      assistantText: createTodaySessionProposalMessage(
        todaySession,
        "좋습니다. 선택한 커리큘럼을 기준으로 오늘 수업을 편성했습니다.",
      ),
      todaySessionSummary: createTodaySessionSummary(todaySession),
      action: () => handleSelectCurriculum(curriculumId),
      requestTeacherMessage: true,
    });
  }

  function handleStudentRequestFromChat(requestKind: StudentRequestKind) {
    const selectedRequest = studentRequestOptions.find(
      (requestOption) => requestOption.kind === requestKind,
    );

    sendStudentRequestProposal(
      selectedRequest?.label ?? "오늘 상황에 맞춰 조정해 주세요.",
      requestKind,
      true,
    );
  }

  function sendStudentRequestProposal(
    message: string,
    requestKind: StudentRequestKind,
    requestTeacherMessage = false,
  ) {
    const requestAdjustment = applyStudentRequestToProgress({
      studentState: demoStudentState,
      requestKind,
      focusConcept: demoStudentState.weakConcepts[0],
      currentStepConcepts,
    });
    const adjustedTodaySession = generateTodaySession({
      studentState: requestAdjustment.adjustedStudentState,
      maxMinutes: requestAdjustment.maxMinutes,
    });

    sendUserMessageAndPrepareResponse({
      message,
      nextStep: "request",
      assistantText: createTodaySessionProposalMessage(
        adjustedTodaySession,
        `${requestAdjustment.summary} 요청을 반영했습니다. ${requestAdjustment.teacherNote}`,
      ),
      todaySessionSummary: createTodaySessionSummary(adjustedTodaySession),
      action: () => applyStudentRequest(requestKind),
      requestTeacherMessage,
    });
  }

  function handleShortTimeRequest() {
    handleStudentRequestFromChat("short_time");
  }

  async function openMockLesson(item: LessonItem) {
    setLessonFeedbackError(null);
    try {
      const response = await getLessonItem(demoStudentId, item.id);
      const lesson = toLessonItem(response.lessonItem);

      setActiveLesson(lesson);
      setIsMockLessonPlaying(false);
      setApiConnectionState("connected");
      setApiConnectionError(null);

      if (typeof window !== "undefined") {
        window.history.pushState(null, "", `#lesson-${lesson.id}`);
      }
    } catch (error) {
      const errorMessage = getApiErrorMessage(error, "initial-load");
      setApiConnectionState("error");
      setApiConnectionError(errorMessage);
      setLessonFeedbackError(errorMessage);
    }
  }

  function closeMockLesson() {
    setActiveLesson(null);
    setIsMockLessonPlaying(false);

    if (typeof window !== "undefined" && window.location.hash.startsWith("#lesson-")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  async function completeMockLesson(feedback: LessonFeedback) {
    if (isLessonFeedbackSubmitting) {
      return;
    }

    setIsLessonFeedbackSubmitting(true);
    setLessonFeedbackError(null);

    try {
      const apiResult = await recordLessonFeedback({
        studentId: demoStudentId,
        lessonId: feedback.lessonItemId,
        understandingLevel: feedback.understandingLevel,
        focusLevel: feedback.focusLevel,
      });

      if (!apiResult.recorded) {
        throw new Error("학습 기록 저장에 실패했습니다.");
      }

      setApiConnectionState("connected");
      setApiConnectionError(null);
      setApiSessionProgress(apiResult.progress);

      const recommendedNextLesson = apiResult.progress.nextRecommendedLesson
        ? toLessonItem(
            (
              await getLessonItem(
                demoStudentId,
                apiResult.progress.nextRecommendedLesson.id,
              )
            ).lessonItem,
          )
        : null;

      await refreshServerState();

      const nextFeedbacks = [
        ...lessonFeedbacks.filter((item) => item.lessonItemId !== feedback.lessonItemId),
        feedback,
      ];

      setLessonFeedbacks(nextFeedbacks);
      setLearningCheckSubmission(
        createFeedbackBasedLearningCheckSubmission(demoTodaySession, nextFeedbacks),
      );
      const nextLesson = recommendedNextLesson;
      closeMockLesson();
      sendUserMessageAndPrepareResponse({
        message: `${feedback.lessonTitle} 학습을 마쳤어요. 이해도와 집중도를 전달할게요.`,
        nextStep: "next-session",
        assistantText:
          nextLesson === null
            ? "오늘 편성된 강의를 모두 마쳤어요. 강의별 응답을 반영했고, 다음 수업 조율은 AI 담임이 내부에서 계속 관리하겠습니다."
            : `강의별 응답을 반영했습니다. 다음으로 '${nextLesson.title}'을 추천할게요. 재생 전 잠깐만 준비할 시간을 드리겠습니다.`,
        action: nextLesson === null ? undefined : () => beginNextLessonCountdown(nextLesson),
        learningProgressReport: createLearningProgressReportFromApi({
          completedLesson: apiResult.completedLesson,
          appliedFeedback: apiResult.appliedFeedback,
          teacherNote: apiResult.teacherNote,
          progress: apiResult.progress,
          recommendedLesson: nextLesson,
        }),
      });
    } catch (error) {
      const errorMessage = getApiErrorMessage(error, "lesson-feedback");

      setApiConnectionState("error");
      setApiConnectionError(errorMessage);
      setLessonFeedbackError(errorMessage);
    } finally {
      setIsLessonFeedbackSubmitting(false);
    }
  }

  function selectCurriculumFromApi(curriculumId: string) {
    const selectedCurriculum = apiCurriculums.find((curriculum) => curriculum.id === curriculumId);

    if (isAssistantPreparing) {
      return;
    }

    setChatMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createChatMessageId("user"),
        role: "user",
        text: `${selectedCurriculum?.title ?? "선택한 커리큘럼"}으로 시작할게요.`,
      },
    ]);
    setIsAssistantPreparing(true);

    void selectCurriculum(demoStudentId, curriculumId)
      .then(async (snapshot) => {
        applyCurriculumSnapshot(snapshot);
        setApiConnectionState("connected");
        setApiConnectionError(null);
        setCurrentDemoStep("today");
        setChatMessages((currentMessages) => [
          ...currentMessages,
          {
            id: createChatMessageId("assistant"),
            role: "assistant",
            text: snapshot.session.teacherComment,
            attachmentStep: "today-summary",
            todaySessionSummary: createApiTodaySessionSummary(snapshot.session),
          },
        ]);

        void getTodaySessionProgress(demoStudentId)
          .then((response) => setApiSessionProgress(response.progress))
          .catch(() => setApiSessionProgress(null));
      })
      .catch((error) => {
        const errorMessage = getApiErrorMessage(error, "initial-load");
        setApiConnectionState("error");
        setApiConnectionError(errorMessage);
        setChatMessages((currentMessages) => [
          ...currentMessages,
          { id: createChatMessageId("assistant"), role: "assistant", text: errorMessage },
        ]);
      })
      .finally(() => {
        setIsAssistantPreparing(false);
      });
  }

  async function confirmPendingSessionAdjustment(adjustment: ApiSessionAdjustment) {
    if (isSessionAdjustmentConfirming) {
      return;
    }

    setIsSessionAdjustmentConfirming(true);

    try {
      const snapshot = await confirmSessionAdjustment(demoStudentId, adjustment.adjustmentId);
      applyCurriculumSnapshot(snapshot);
      setPendingSessionAdjustment(null);
      setApiConnectionState("connected");
      setApiConnectionError(null);
      setCurrentDemoStep("today");
      setChatMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createChatMessageId("assistant"),
          role: "assistant",
          text: snapshot.session.teacherComment,
          attachmentStep: "today-summary",
          todaySessionSummary: createApiTodaySessionSummary(snapshot.session),
        },
      ]);

      void getTodaySessionProgress(demoStudentId)
        .then((response) => setApiSessionProgress(response.progress))
        .catch(() => setApiSessionProgress(null));
    } catch (error) {
      const errorMessage = getApiErrorMessage(error, "initial-load");
      setApiConnectionState("error");
      setApiConnectionError(errorMessage);
      setChatMessages((currentMessages) => [
        ...currentMessages,
        { id: createChatMessageId("assistant"), role: "assistant", text: errorMessage },
      ]);
    } finally {
      setIsSessionAdjustmentConfirming(false);
    }
  }

  function startRecommendedLesson(nextLesson: LessonItem) {
    sendUserMessageAndPrepareResponse({
      message: `${nextLesson.title}을 이어서 볼게요.`,
      nextStep: "today",
      assistantText:
        "좋아요. 지금까지의 학습 흐름을 이어서 다음 강의를 열겠습니다. 강의가 끝난 뒤에도 짧게만 체크해 주세요.",
      action: () => openMockLesson(nextLesson),
    });
  }

  function handleHomeQuickReply(
    message: string,
    nextStep: DemoStep,
    action?: () => void,
    assistantText?: string,
  ) {
    sendUserMessageAndPrepareResponse({
      message,
      nextStep,
      assistantText,
      action,
      requestTeacherMessage: true,
    });
  }

  function handleHomeMessageSubmit(message: string) {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    if (!hasSelectedCurriculum) {
      sendUserMessageAndPrepareResponse({
        message: trimmedMessage,
        nextStep: "curriculum",
        assistantText: "좋습니다. 먼저 학습 흐름을 정해 보겠습니다. 아래에서 지금 상태에 맞는 커리큘럼을 골라 주세요.",
        requestTeacherMessage: true,
      });
      return;
    }

    if (trimmedMessage.includes("왜") || trimmedMessage.includes("이유")) {
      sendUserMessageAndPrepareResponse({
        message: trimmedMessage,
        nextStep: "reason",
        requestTeacherMessage: true,
      });
      return;
    }

    if (trimmedMessage.includes("커리큘럼") || trimmedMessage.includes("전체")) {
      sendUserMessageAndPrepareResponse({
        message: trimmedMessage,
        nextStep: "curriculum-map",
        requestTeacherMessage: true,
      });
      return;
    }

    sendUserMessageAndPrepareResponse({
      message: trimmedMessage,
      nextStep: "today",
      requestTeacherMessage: true,
    });
  }

  function createTodaySessionProposalMessage(
    session: Pick<typeof demoTodaySession, "goal" | "estimatedMinutes" | "items">,
    introduction: string,
  ) {
    const lessonSummary = session.items
      .map((item) => `${item.title} ${item.estimatedMinutes}분`)
      .join(" · ");

    return `${introduction}\n오늘은 '${session.goal}'을 목표로 ${session.estimatedMinutes}분 동안 진행하겠습니다.\n${lessonSummary}\n이 편성으로 진행할까요?`;
  }

  function getMockStudentRequestKind(message: string): StudentRequestKind | null {
    if (message.includes("시간") || message.includes("부족")) {
      return "short_time";
    }

    if (message.includes("복습")) {
      return "review_first";
    }

    if (message.includes("헷갈") || message.includes("어려")) {
      return "confused_concept";
    }

    if (message.includes("새 강의") || message.includes("새 진도") || message.includes("진도 빼")) {
      return "reduce_new_lecture";
    }

    return null;
  }

  function getAssistantMessage(step: DemoStep) {
    switch (step) {
      case "curriculum":
        return "좋습니다. 먼저 학습 흐름을 정해 보겠습니다. 지금 데모에서는 자동 생성 대신 사전 정의된 커리큘럼 중에서 선택합니다.";
      case "today":
        return hasSelectedCurriculum
          ? createTodaySessionProposalMessage(
              demoTodaySession,
              "선택한 커리큘럼과 현재 학습 상태를 기준으로 오늘 수업을 편성했습니다.",
            )
          : "아직 커리큘럼을 확정하지 않았습니다. 먼저 학습 흐름을 정하면 오늘 수업을 편성해 제안하겠습니다.";
      case "request":
        return createTodaySessionProposalMessage(
          demoTodaySession,
          `${studentRequestAdjustment.summary} 요청을 반영해 오늘 수업을 다시 편성했습니다.`,
        );
      case "reason":
        return "아래에 오늘 수업을 이렇게 배정한 근거를 정리했습니다. AI 담임은 규칙 기반 진도 운영 결과를 학생에게 설명하는 역할을 합니다.";
      case "learning-check":
        return "강의가 끝날 때마다 이해도와 집중도만 짧게 기록합니다. 세부 설문 대신 강의별 응답과 개념 태그를 AI 담임이 내부적으로 다음 수업 조율에 반영합니다.";
      case "next-session":
        return "강의별 응답을 기준으로 다음 수업 조율을 내부 반영했습니다. 사용자에게는 오늘의 학습 진행 상황만 간단히 보고합니다.";
      case "curriculum-map":
        return "현재 커리큘럼에서 어디까지 왔는지, 어떤 개념에 보강이 필요한지 한 번에 볼 수 있습니다.";
      case "intro":
      default:
        return hasSelectedCurriculum
          ? "선택한 커리큘럼을 기준으로 오늘 수업을 편성할 수 있습니다. 현재 상황이나 원하는 학습 방식을 말씀해 주세요."
          : "안녕하세요. 아직 선택된 커리큘럼이 없습니다. 먼저 학습 흐름을 정하면, 그 기준으로 오늘 수업을 바로 편성하겠습니다.";
    }
  }

  function getChatSuggestions() {
    switch (currentDemoStep) {
      case "curriculum":
        return [
          {
            label: "안정형으로 시작",
            message: "안정형 커리큘럼으로 시작할게요.",
            action: () => selectCurriculumFromApi("stable-log"),
          },
          {
            label: "압축형으로 시작",
            message: "압축형 커리큘럼으로 시작할게요.",
            action: () => selectCurriculumFromApi("compressed-log"),
          },
          {
            label: "문제적용형으로 시작",
            message: "문제적용형 커리큘럼으로 시작할게요.",
            action: () => selectCurriculumFromApi("practice-log"),
          },
        ];
      case "today":
        return [
          {
            label: "이 편성으로 진행",
            message: "이 편성으로 진행할게요.",
            action: () =>
              handleHomeQuickReply(
                "이 편성으로 진행할게요.",
                "today",
                undefined,
                "좋습니다. 오늘의 학습 안내에서 강의 항목을 열어 시작할 수 있어요.",
              ),
          },
          {
            label: "오늘 시간이 부족해요",
            message: "오늘 시간이 부족해요.",
            action: handleShortTimeRequest,
          },
          {
            label: "배정 이유 보기",
            message: "왜 이렇게 배정됐나요?",
            action: () => handleHomeQuickReply("왜 이렇게 배정됐나요?", "reason"),
          },
        ];
      case "request":
        return [
          {
            label: "이 편성으로 진행",
            message: "이 편성으로 진행할게요.",
            action: () =>
              handleHomeQuickReply(
                "이 편성으로 진행할게요.",
                "today",
                undefined,
                "좋습니다. 오늘의 학습 안내에서 강의 항목을 열어 시작할 수 있어요.",
              ),
          },
          {
            label: "복습을 더 늘려주세요",
            message: "복습을 더 늘려주세요.",
            action: () => handleStudentRequestFromChat("review_first"),
          },
          {
            label: "배정 이유 보기",
            message: "조정 이유를 알려 주세요.",
            action: () => handleHomeQuickReply("조정 이유를 알려 주세요.", "reason"),
          },
        ];
      case "reason":
        return [
          {
            label: "이 편성으로 진행",
            message: "이 편성으로 진행할게요.",
            action: () =>
              handleHomeQuickReply(
                "이 편성으로 진행할게요.",
                "today",
                undefined,
                "좋습니다. 오늘의 학습 안내에서 강의 항목을 열어 시작할 수 있어요.",
              ),
          },
          {
            label: "커리큘럼 맵 보기",
            message: "전체 커리큘럼을 보여 주세요.",
            action: () => handleHomeQuickReply("전체 커리큘럼을 보여 주세요.", "curriculum-map"),
          },
        ];
      case "learning-check":
        return [
          {
            label: "오늘 학습 안내 보기",
            message: "오늘 학습 안내를 다시 보여 주세요.",
            action: () => handleHomeQuickReply("오늘 학습 안내를 다시 보여 주세요.", "today"),
          },
          {
            label: "커리큘럼 맵 보기",
            message: "커리큘럼 맵을 보여 주세요.",
            action: () => handleHomeQuickReply("커리큘럼 맵을 보여 주세요.", "curriculum-map"),
          },
        ];
      case "next-session": {
        const nextLesson = getRecommendedNextLesson();

        return [
          ...(nextLesson === null
            ? []
            : [
                {
                  label: `다음 강의: ${nextLesson.title}`,
                  message: `${nextLesson.title}을 이어서 볼게요.`,
                  action: () => startRecommendedLesson(nextLesson),
                },
              ]),
          {
            label: "이해가 잘 안 된 부분이 있어요",
            message: "방금 강의에서 이해가 잘 안 된 부분이 있어요.",
            action: () =>
              sendStudentRequestProposal(
                "방금 강의에서 이해가 잘 안 된 부분이 있어요.",
                "confused_concept",
              ),
          },
          {
            label: "오늘 학습 안내 보기",
            message: "오늘 학습 안내를 다시 보여 주세요.",
            action: () => handleHomeQuickReply("오늘 학습 안내를 다시 보여 주세요.", "today"),
          },
        ];
      }
      case "curriculum-map":
        return [
          {
            label: "수업 편성 듣기",
            message: "현재 수업 편성을 설명해 주세요.",
            action: () => handleHomeQuickReply("현재 수업 편성을 설명해 주세요.", "today"),
          },
          {
            label: "커리큘럼 다시 고르기",
            message: "커리큘럼을 다시 고르고 싶어요.",
            action: () => handleHomeQuickReply("커리큘럼을 다시 고르고 싶어요.", "curriculum"),
          },
        ];
      case "intro":
      default:
        return hasSelectedCurriculum
          ? [
              {
                label: "오늘 수업 시작",
                message: "오늘 수업 시작할게요.",
                action: () => handleHomeQuickReply("오늘 수업 시작할게요.", "today"),
              },
              {
                label: "오늘 시간이 부족해요",
                message: "오늘 시간이 부족해요.",
                action: handleShortTimeRequest,
              },
              {
                label: "왜 이렇게 배정됐나요?",
                message: "왜 이렇게 배정됐나요?",
                action: () => handleHomeQuickReply("왜 이렇게 배정됐나요?", "reason"),
              },
              {
                label: "전체 커리큘럼 보기",
                message: "전체 커리큘럼을 보여 주세요.",
                action: () => handleHomeQuickReply("전체 커리큘럼을 보여 주세요.", "curriculum-map"),
              },
            ]
          : [
              {
                label: "커리큘럼 추천받기",
                message: "커리큘럼을 추천해 주세요.",
                action: () =>
                  handleHomeQuickReply(
                    "커리큘럼을 추천해 주세요.",
                    "curriculum",
                    undefined,
                    "좋습니다. 먼저 학습 흐름을 정해 보겠습니다. 아래에서 지금 상태에 맞는 커리큘럼을 골라 주세요.",
                  ),
              },
              {
                label: "기초부터 안정적으로",
                message: "기초부터 안정적으로 가고 싶어요.",
                action: () =>
                  handleHomeQuickReply(
                    "기초부터 안정적으로 가고 싶어요.",
                    "curriculum",
                    undefined,
                    "좋습니다. 기초를 안정적으로 쌓는 방향으로 커리큘럼을 추천해 보겠습니다.",
                  ),
              },
            ];
    }
  }

  function renderChatAttachment(
    step: ChatAttachment,
    todaySessionSummary?: TodaySessionSummary,
    learningProgressReport?: LearningProgressReport,
    sessionAdjustment?: ApiSessionAdjustment,
  ) {
    const visibleAttachmentStep = getVisibleAttachmentStep(step);

    switch (visibleAttachmentStep) {
      case "session-adjustment": {
        const adjustment = sessionAdjustment ?? pendingSessionAdjustment;

        if (!adjustment) {
          return null;
        }

        return (
          <article className="chat-attachment attachment-wide">
            <AttachmentHeader
              eyebrow="AI 담임 제안"
              title="오늘 수업을 이렇게 조정해도 될까요?"
              description={adjustment.teacherNote}
              aside={`${adjustment.proposedSession.estimatedMinutes}분`}
            />
            <div className="session-timeline">
              {adjustment.proposedSession.items.map((item, index) => (
                <LessonRow item={toLessonItem(item)} index={index} key={item.id} />
              ))}
            </div>
            <div className="attachment-actions">
              <button
                type="button"
                disabled={isSessionAdjustmentConfirming}
                onClick={() => void confirmPendingSessionAdjustment(adjustment)}
              >
                {isSessionAdjustmentConfirming ? "적용 중..." : "이 편성으로 진행할게요"}
              </button>
            </div>
          </article>
        );
      }

      case "progress-report": {
        const report = learningProgressReport ?? createLearningProgressReport();
        const recommendedNextLesson = report.recommendedNextLessonId
          ? demoTodaySession.items.find((item) => item.id === report.recommendedNextLessonId)
          : null;

        return (
          <article
            className="chat-attachment readonly-progress-report"
            aria-label="오늘의 학습 진행 보고"
          >
            <AttachmentHeader
              eyebrow="오늘의 학습 진행"
              title="강의별 응답을 반영했습니다"
              description="다음 수업 조율은 AI 담임이 내부에서 계속 관리합니다."
              aside={`${report.completedLectureCount}/${report.totalLectureCount} 강의`}
            />

            <dl className="progress-report-list">
              <div>
                <dt>완료한 강의</dt>
                <dd>{report.completedLessonTitle}</dd>
              </div>
              {report.recommendedNextLessonTitle ? (
                <div>
                  <dt>다음 추천 강의</dt>
                  <dd className="progress-report-recommendation">
                    <span>{report.recommendedNextLessonTitle}</span>
                    {recommendedNextLesson ? (
                      <button
                        type="button"
                        className="progress-report-play-button"
                        onClick={() => playLessonFromProgressReport(recommendedNextLesson)}
                      >
                        강의 재생
                      </button>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>이해도</dt>
                <dd>{getLearningLevelLabel(understandingLevelOptions, report.understandingLevel)}</dd>
              </div>
              <div>
                <dt>집중도</dt>
                <dd>{getLearningLevelLabel(focusLevelOptions, report.focusLevel)}</dd>
              </div>
            </dl>

            <p className="attachment-note">{report.teacherNote}</p>
            <p className="readonly-progress-report-hint">
              특히 부족했던 부분이 있다면 아래 채팅으로 편하게 알려 주세요.
            </p>
          </article>
        );
      }

      case "today-summary": {
        const session =
          todaySessionSummary ?? getDisplayedTodaySessionSummary();

        return (
          <article
            className="chat-attachment attachment-wide readonly-learning-plan"
            aria-label="오늘의 학습 안내"
          >
            <AttachmentHeader
              eyebrow="오늘의 학습 안내"
              title={session.goal}
              description="AI 담임이 내부 편성 결과를 읽기 쉽게 정리했습니다."
              aside={`${session.estimatedMinutes}분`}
            />

            <ol className="readonly-learning-plan-list">
              {session.items.map((item, index) => {
                const isCompletedLecture =
                  item.kind === "lecture" &&
                  (apiSessionProgress?.completedItemIds.includes(item.id) ??
                    lessonFeedbacks.some((feedback) => feedback.lessonItemId === item.id));

                return (
                  <li key={item.id}>
                    <span className="readonly-learning-plan-index">{index + 1}</span>
                    <div>
                      <div className="readonly-learning-plan-meta">
                        <span>{kindLabels[item.kind]}</span>
                        <span>
                          {isCompletedLecture ? "완료" : item.required ? "필수" : "선택"}
                        </span>
                      </div>
                      {item.kind === "lecture" ? (
                        <a
                          className="readonly-learning-plan-link"
                          href={`#lesson-${item.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            openMockLesson(item);
                          }}
                        >
                          <strong>{item.title}</strong>
                          <span>{isCompletedLecture ? "강의 다시 보기" : "강의 열기"}</span>
                        </a>
                      ) : (
                        <strong>{item.title}</strong>
                      )}
                      <p>{item.description}</p>
                    </div>
                    <em>{item.estimatedMinutes}분</em>
                  </li>
                );
              })}
            </ol>

            <p className="attachment-note">
              이 편성에 대한 의견은 아래 채팅으로 알려 주세요.
            </p>
          </article>
        );
      }

      case "curriculum":
        return (
          <article className="chat-attachment attachment-wide">
            <AttachmentHeader
              eyebrow="커리큘럼 추천"
              title="먼저 학습 흐름을 정하겠습니다"
              description="초기 데모에서는 커리큘럼을 자동 생성하지 않고, 사전 정의된 흐름 중에서 AI 담임이 추천하는 방식으로 시작합니다."
            />

            <div className="choice-card-grid">
              {apiCurriculums.length > 0 ? (
                apiCurriculums.map((curriculum) => (
                  <CurriculumCard
                    curriculum={curriculum}
                    isSelected={curriculum.id === selectedCurriculumId}
                    key={curriculum.id}
                    onSelect={selectCurriculumFromApi}
                  />
                ))
              ) : (
                <p className="attachment-note">
                  {apiConnectionState === "loading"
                    ? "커리큘럼 목록을 불러오는 중입니다."
                    : apiConnectionError ?? "커리큘럼 목록을 불러오지 못했습니다."}
                </p>
              )}
            </div>

            <p className="attachment-note">
              추천: 기초가 약하거나 그래프가 불안하다면 안정형부터 시작하는 편이 가장
              안전합니다. 커리큘럼을 선택하면 바로 오늘 수업을 편성합니다.
            </p>
          </article>
        );

      case "today":
        return (
          <article className="chat-attachment attachment-wide">
            <AttachmentHeader
              eyebrow={hasSelectedCurriculum ? "오늘 수업" : "오늘 수업 미리보기"}
              title={apiTodaySession?.session.goal ?? "수업 정보를 불러오는 중입니다."}
              description={apiTodaySession?.session.teacherComment ?? apiConnectionError ?? undefined}
              aside={apiTodaySession ? `${apiTodaySession.session.estimatedMinutes}분` : undefined}
            />

            {!hasSelectedCurriculum ? (
              <p className="attachment-note">
                아직 커리큘럼을 확정하지 않았기 때문에 안정형 흐름으로 보여주는 예시
                수업입니다.
              </p>
            ) : null}

            <div className="session-timeline">
              {apiTodaySession ? (
                apiTodaySession.session.items.map((item, index) => (
                  <LessonRow item={toLessonItem(item)} index={index} key={item.id} />
                ))
              ) : (
                <p className="attachment-note">
                  {apiConnectionError ?? "오늘 수업 정보를 불러오고 있습니다."}
                </p>
              )}
            </div>

            <div className="attachment-actions">
              <button
                type="button"
                onClick={() =>
                  handleHomeQuickReply("수업을 완료하고 체크할게요.", "learning-check")
                }
              >
                수업 완료하고 체크하기
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleShortTimeRequest}
              >
                오늘 시간이 부족해요
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => handleHomeQuickReply("왜 이렇게 배정됐나요?", "reason")}
              >
                왜 이렇게 배정됐나요?
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  handleHomeQuickReply("전체 커리큘럼을 보여 주세요.", "curriculum-map")
                }
              >
                전체 커리큘럼 보기
              </button>
            </div>
          </article>
        );

      case "request":
        return (
          <article className="chat-attachment attachment-wide">
            <AttachmentHeader
              eyebrow="학생 요구사항 반영"
              title="오늘 상황에 맞춰 수업을 조정하겠습니다"
              description="학생의 요청은 자연어 입력을 붙이기 전까지 빠른 선택으로 시연합니다. 수업 조정 자체는 규칙 기반 엔진이 처리합니다."
            />

            <div className="request-card-grid">
              {studentRequestOptions.map((requestOption) => (
                <button
                  type="button"
                  aria-pressed={studentRequestKind === requestOption.kind}
                  className={`request-card ${
                    studentRequestKind === requestOption.kind
                      ? "request-card-selected"
                      : ""
                  }`}
                  key={requestOption.kind}
                  onClick={() => handleStudentRequestFromChat(requestOption.kind)}
                >
                  <strong>{requestOption.label}</strong>
                  <span>{requestOption.description}</span>
                </button>
              ))}
            </div>

            <p className="attachment-note strong-note">
              <strong>{studentRequestAdjustment.summary}</strong>
              {studentRequestAdjustment.teacherNote}
            </p>

            <div className="attachment-actions">
              <button
                type="button"
                onClick={() =>
                  handleHomeQuickReply("조정된 수업을 보여 주세요.", "today")
                }
              >
                조정된 수업 보기
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleHomeQuickReply("조정 이유를 알려 주세요.", "reason")}
              >
                조정 이유 보기
              </button>
            </div>
          </article>
        );

      case "reason":
        return (
          <article className="chat-attachment">
            <AttachmentHeader
              eyebrow="AI 담임 판단"
              title="왜 이렇게 배정됐나요?"
              description={apiTodaySession?.session.adjustmentReason ?? apiConnectionError ?? undefined}
            />

            <ExplanationList items={apiTodaySession?.session.explanationItems ?? []} />

            <section className="mini-panel" aria-labelledby="weak-title">
              <span className="eyebrow">보강 필요 개념</span>
              <h3 id="weak-title">오늘 먼저 잡을 부분</h3>
              <div className="tag-row emphasis-tags">
                {(apiStudentContext?.weakConcepts ?? []).map((concept) => (
                  <span key={concept}>{concept}</span>
                ))}
              </div>
            </section>

            <div className="attachment-actions">
              <button
                type="button"
                onClick={() =>
                  handleHomeQuickReply("오늘 수업으로 이동할게요.", "today")
                }
              >
                오늘 수업으로 이동
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  handleHomeQuickReply("전체 커리큘럼을 보여 주세요.", "curriculum-map")
                }
              >
                커리큘럼 맵 보기
              </button>
            </div>
          </article>
        );

      case "curriculum-map":
        return (
          <article className="chat-attachment attachment-wide">
            <AttachmentHeader
              eyebrow="커리큘럼 맵"
              title="진도와 취약 개념 상태를 한 번에 확인합니다"
              description="이 화면은 전체 학습 관리 화면이 아니라, AI 담임이 어떤 기준으로 진도를 조율하고 있는지 보조적으로 보여주는 카드입니다."
            />

            <ol className="step-list">
              {displayedCurriculumSteps.map((step) => (
                <li
                  className={`step-item step-${curriculumStatusClassNames[step.status]}`}
                  key={step.id}
                >
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.conceptTags.join(" · ")}</span>
                  </div>
                  <em>{step.status}</em>
                </li>
              ))}
            </ol>

            <div className="attachment-actions">
              <button
                type="button"
                onClick={() =>
                  handleHomeQuickReply("오늘 수업으로 돌아갈게요.", "today")
                }
              >
                오늘 수업으로 돌아가기
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  handleHomeQuickReply("커리큘럼을 다시 고르고 싶어요.", "curriculum")
                }
              >
                커리큘럼 다시 고르기
              </button>
            </div>
          </article>
        );

      case "intro":
      default:
        return (
          <article className="chat-attachment">
            <AttachmentHeader eyebrow="AI 담임 홈" title="오늘 수업은 이렇게 진행하겠습니다" />

            {hasSelectedCurriculum ? (
              <section className="home-brief" aria-label="오늘 수업 요약">
                <div className="progress-card">
                  <span className="eyebrow">현재 커리큘럼</span>
                  <strong>{displayedCurriculumTitle ?? "커리큘럼 정보를 불러오는 중입니다."}</strong>
                  <p>{displayedCurrentStep?.title ?? "현재 단계를 확인하는 중입니다."} 진행 중</p>
                  <div
                    className="progress-track"
                    aria-label={`진도율 ${displayedProgressPercent}%`}
                  >
                    <div style={{ width: `${displayedProgressPercent}%` }} />
                  </div>
                  <span>
                    {displayedCompletedStepCount}/{displayedStepCount}단계 완료
                  </span>
                </div>

                <div className="mini-panel">
                  <span className="eyebrow">AI 담임 안내</span>
                  <h3>오늘 상황을 알려 주세요</h3>
                  <p>
                    남은 시간, 복습 희망, 새 진도 조정처럼 지금 필요한 조건을 말하면
                    AI 담임이 내부적으로 수업을 편성해 제안합니다.
                  </p>
                </div>
              </section>
            ) : (
              <section className="mini-panel">
                <span className="eyebrow">AI 추천 예고</span>
                <h3>먼저 커리큘럼을 추천하겠습니다</h3>
                <p>
                  초기 데모에서는 안정형, 압축형, 문제적용형 중 하나를 선택합니다.
                  선택된 커리큘럼을 기준으로 AI 담임이 내부에서 오늘 수업을 편성합니다.
                </p>
              </section>
            )}
          </article>
        );
    }
  }

  if (activeLesson) {
    return (
      <MockLessonPage
        lesson={activeLesson}
        isPlaying={isMockLessonPlaying}
        isSubmittingFeedback={isLessonFeedbackSubmitting}
        feedbackError={lessonFeedbackError}
        onClose={closeMockLesson}
        onComplete={completeMockLesson}
        onTogglePlay={() => setIsMockLessonPlaying((isPlaying) => !isPlaying)}
      />
    );
  }

  return (
    <main className="chat-page">
      <DevStepControl
        currentStep={currentDemoStep}
        onNext={goToNextStep}
        onPrevious={goToPreviousStep}
        onReset={resetDemoFlow}
        onStepChange={(step) =>
          moveToStepWithAssistantResponse(
            step,
            `시연 단계를 '${demoStepOptions.find((option) => option.step === step)?.label ?? "선택한"}' 카드로 이동했습니다.`,
          )
        }
      />

      <section className="messenger-shell" aria-label="AI 담임 채팅형 데모">
        <header className="messenger-header">
          <div className="teacher-identity">
            <div className="teacher-avatar" aria-hidden="true">
              AI
            </div>
            <div>
              <span className="eyebrow">AI 담임 서비스 데모</span>
              <h1>오늘 수업은 이렇게 진행하겠습니다</h1>
              <p>
                진도 운영 엔진이 만든 수업과 조율 결과를 AI 담임이 대화 안에서
                설명합니다.
              </p>
            </div>
          </div>
          <div className="conversation-status" aria-label="현재 데모 상태">
            <span>{hasSelectedCurriculum ? "커리큘럼 선택됨" : "커리큘럼 미선택"}</span>
            <span title={apiConnectionError ?? undefined} aria-live="polite">
              {apiConnectionState === "loading"
                ? "API 연결 확인 중"
                : apiConnectionState === "connected"
                  ? "Mock API 연결됨"
                  : "API 연결 필요"}
            </span>
            <strong>{demoStepOptions.find((option) => option.step === currentDemoStep)?.label}</strong>
          </div>
        </header>

        <div className="conversation-thread" aria-live="polite" ref={conversationThreadRef}>
          {chatMessages.map((message) => (
            <ChatMessage role={message.role} key={message.id}>
              <p>{message.text}</p>
              {message.isNextLessonCountdownNotice &&
              nextLessonCountdown?.messageId === message.id ? (
                <div className="next-lesson-countdown" aria-live="polite">
                  <strong>{nextLessonCountdown.remainingSeconds}초 뒤 자동 재생</strong>
                  <div className="next-lesson-countdown-actions">
                    <button type="button" onClick={playNextLessonNow}>
                      지금 재생
                    </button>
                    <button type="button" onClick={cancelNextLessonCountdown}>
                      취소
                    </button>
                  </div>
                </div>
              ) : null}
              {message.attachmentStep ? (
                <div className="attachment-slot">
                  {renderChatAttachment(
                    message.attachmentStep,
                    message.todaySessionSummary,
                    message.learningProgressReport,
                    message.sessionAdjustment,
                  )}
                </div>
              ) : null}
            </ChatMessage>
          ))}

          {isAssistantPreparing ? (
            <ChatMessage role="assistant">
              <TypingIndicator />
            </ChatMessage>
          ) : null}
        </div>

        <form
          className="message-composer"
          onSubmit={(event) => {
            event.preventDefault();
            handleHomeMessageSubmit(homeDraftMessage);
          }}
        >
          <div className="quick-reply-row" aria-label="예시 답변">
            {getChatSuggestions().map((suggestion) => (
              <button
                type="button"
                className="quick-reply"
                key={suggestion.label}
                onClick={suggestion.action}
                disabled={isAssistantPreparing || nextLessonCountdown !== null}
              >
                {suggestion.label}
              </button>
            ))}
          </div>

          <div className="composer-input-row">
            <input
              type="text"
              value={homeDraftMessage}
              onChange={(event) => setHomeDraftMessage(event.target.value)}
              placeholder="AI 담임에게 답장하거나 요청을 입력하세요"
              disabled={isAssistantPreparing || nextLessonCountdown !== null}
            />
            <button
              type="submit"
              disabled={isAssistantPreparing || nextLessonCountdown !== null}
            >
              전송
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function MockLessonPage({
  lesson,
  isPlaying,
  isSubmittingFeedback,
  feedbackError,
  onClose,
  onComplete,
  onTogglePlay,
}: {
  lesson: LessonItem;
  isPlaying: boolean;
  isSubmittingFeedback: boolean;
  feedbackError: string | null;
  onClose: () => void;
  onComplete: (feedback: LessonFeedback) => Promise<void>;
  onTogglePlay: () => void;
}) {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [understandingLevel, setUnderstandingLevel] = useState<LearningCheckLevel>(3);
  const [focusLevel, setFocusLevel] = useState<LearningCheckLevel>(3);

  return (
    <main className="lesson-page">
      <section className="lesson-shell" aria-label="더미 강의 세션">
        <header className="lesson-header">
          <div>
            <span className="eyebrow">AI 담임 서비스 데모 · 강의 세션</span>
            <h1>{lesson.title}</h1>
            <p>AI 담임과의 대화 흐름은 유지한 채, 오늘 편성된 강의를 학습합니다.</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            AI 담임에게 돌아가기
          </button>
        </header>

        <div className="lesson-content">
          <section className="mock-video-panel" aria-label="더미 강의 영상">
            <div className="mock-video-frame">
              <img
                src="/images/mock-logarithm-lecture.png"
                alt="로그함수 그래프와 점근선을 설명하는 강의 장면"
              />
              <div className="mock-video-lesson-label">
                <span>현재 강의</span>
                <strong>{lesson.title}</strong>
              </div>
              <button
                type="button"
                className={`mock-video-toggle ${isPlaying ? "mock-video-toggle-playing" : ""}`}
                onClick={onTogglePlay}
                aria-pressed={isPlaying}
              >
                {isPlaying ? "일시정지" : "강의 재생"}
              </button>
              {isPlaying ? (
                <div className="mock-video-status" aria-live="polite">
                  <span>강의 시연 중</span>
                  <strong>{lesson.conceptTags.join(" · ")}를 설명하고 있습니다.</strong>
                </div>
              ) : null}
            </div>
            <div className="mock-video-controls" aria-label="더미 영상 진행 상태">
              <span>04:10</span>
              <div aria-hidden="true">
                <i />
              </div>
              <span>{lesson.estimatedMinutes}:00</span>
            </div>
          </section>

          <aside className="lesson-sidebar">
            <section className="lesson-info-panel">
              <span className="eyebrow">오늘의 학습</span>
              <h2>{lesson.title}</h2>
              <p>{lesson.description}</p>
              <dl className="lesson-meta-list">
                <div>
                  <dt>예상 시간</dt>
                  <dd>{lesson.estimatedMinutes}분</dd>
                </div>
                <div>
                  <dt>학습 개념</dt>
                  <dd>{lesson.conceptTags.join(" · ")}</dd>
                </div>
              </dl>
            </section>

            <section className="lesson-info-panel lesson-next-panel">
              <span className="eyebrow">AI 담임 안내</span>
              <h2>강의가 끝나면 두 가지만 짧게 남겨요</h2>
              <p>
                이해도와 집중도만 알려 주시면, AI 담임이 강의의 개념 태그와 함께 다음 수업 조율에
                내부 반영합니다.
              </p>
            </section>

            {isFeedbackOpen ? null : (
              <button type="button" onClick={() => setIsFeedbackOpen(true)}>
                강의 종료하고 간단히 기록하기
              </button>
            )}
          </aside>
        </div>
      </section>

      {isFeedbackOpen ? (
        <div
          className="feedback-modal-backdrop"
          role="presentation"
          onMouseDown={() => setIsFeedbackOpen(false)}
        >
          <section
            className="immediate-feedback-panel feedback-modal"
            aria-label="강의 직후 간단 체크"
            aria-modal="true"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="feedback-modal-header">
              <div>
                <span className="eyebrow">강의 직후 간단 체크</span>
                <h2>지금 강의는 어땠나요?</h2>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsFeedbackOpen(false)}
                disabled={isSubmittingFeedback}
              >
                계속 학습하기
              </button>
            </header>
            <p>두 가지만 알려 주시면 AI 담임이 다음 수업에 반영합니다.</p>
            <ImmediateFeedbackGroup
              label="이해도"
              options={immediateUnderstandingOptions}
              selectedLevel={understandingLevel}
              onSelect={setUnderstandingLevel}
            />
            <ImmediateFeedbackGroup
              label="집중도"
              options={immediateFocusOptions}
              selectedLevel={focusLevel}
              onSelect={setFocusLevel}
            />
            <button
              type="button"
              disabled={isSubmittingFeedback}
              onClick={() => {
                void onComplete({
                  lessonItemId: lesson.id,
                  lessonTitle: lesson.title,
                  conceptTags: [...lesson.conceptTags],
                  understandingLevel,
                  focusLevel,
                  completedAt: new Date().toISOString(),
                });
              }}
            >
              {isSubmittingFeedback ? "AI 담임에게 전달 중..." : "AI 담임에게 전달하기"}
            </button>
            {feedbackError ? <p className="feedback-error" role="alert">{feedbackError}</p> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ImmediateFeedbackGroup({
  label,
  options,
  selectedLevel,
  onSelect,
}: {
  label: string;
  options: Array<{ level: LearningCheckLevel; label: string }>;
  selectedLevel: LearningCheckLevel;
  onSelect: (level: LearningCheckLevel) => void;
}) {
  return (
    <div className="immediate-feedback-group">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <label
            className={`immediate-feedback-option ${
              selectedLevel === option.level ? "feedback-option-selected" : ""
            }`}
            key={option.level}
          >
            <input
              type="checkbox"
              checked={selectedLevel === option.level}
              onChange={() => onSelect(option.level)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AttachmentHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  aside?: string;
}) {
  return (
    <header className="attachment-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {aside ? <strong>{aside}</strong> : null}
    </header>
  );
}

function ChatMessage({
  role,
  children,
}: {
  role: "assistant" | "user";
  children: ReactNode;
}) {
  const isAssistant = role === "assistant";

  return (
    <div
      className={`message-row ${
        isAssistant ? "message-row-assistant" : "message-row-user"
      }`}
    >
      {isAssistant ? (
        <div className="message-avatar" aria-hidden="true">
          AI
        </div>
      ) : null}
      <div
        className={`message-bubble ${
          isAssistant ? "message-bubble-assistant" : "message-bubble-user"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="typing-indicator" aria-label="AI 담임이 답변을 준비 중입니다">
      <span />
      <span />
      <span />
    </div>
  );
}

function DevStepControl({
  currentStep,
  onNext,
  onPrevious,
  onReset,
  onStepChange,
}: {
  currentStep: DemoStep;
  onNext: () => void;
  onPrevious: () => void;
  onReset: () => void;
  onStepChange: (step: DemoStep) => void;
}) {
  return (
    <aside className="dev-step-control" aria-label="개발용 단계 이동">
      <label>
        <span>개발용 단계 이동</span>
        <select
          value={currentStep}
          onChange={(event) => onStepChange(event.target.value as DemoStep)}
        >
          {demoStepOptions.map((option) => (
            <option value={option.step} key={option.step}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="button" className="ghost-button" onClick={onPrevious}>
          이전
        </button>
        <button type="button" className="ghost-button" onClick={onNext}>
          다음
        </button>
        <button type="button" className="secondary-button" onClick={onReset}>
          초기화
        </button>
      </div>
    </aside>
  );
}

function getLearningLevelLabel(
  options: Array<{ level: LearningCheckLevel; label: string }>,
  selectedLevel: LearningCheckLevel,
) {
  return options.find((option) => option.level === selectedLevel)?.label ?? `${selectedLevel}/5`;
}

function ExplanationList({ items }: { items: string[] }) {
  return (
    <ul className="explanation-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function CurriculumCard({
  curriculum,
  isSelected,
  onSelect,
}: {
  curriculum: ApiCurriculumSummary;
  isSelected: boolean;
  onSelect: (curriculumId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className={`curriculum-card ${isSelected ? "curriculum-card-selected" : ""}`}
      onClick={() => onSelect(curriculum.id)}
    >
      <span>{curriculum.pace}</span>
      <strong>{curriculum.title}</strong>
      <p>{curriculum.description}</p>
      <em>{curriculum.recommendedFor.join(" · ")}</em>
    </button>
  );
}

function LessonRow({ item, index }: { item: LessonItem; index: number }) {
  return (
    <article className="lesson-item">
      <div className="lesson-index">{index + 1}</div>
      <div>
        <div className="lesson-meta">
          <span>{kindLabels[item.kind]}</span>
          <span>{item.estimatedMinutes}분</span>
          <span>{item.required ? "필수" : "선택"}</span>
        </div>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <div className="tag-row">
          {item.conceptTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <strong>{item.reason}</strong>
    </article>
  );
}
