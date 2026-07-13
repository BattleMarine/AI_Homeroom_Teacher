import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getCurriculumMap,
  getCurriculums,
  type Curriculum,
  type CurriculumId,
  type CurriculumProgressStatus,
} from "../features/curriculum";
import {
  analyzeLearningCheck,
  type LearningCheckLevel,
  type LearningCheckSubmission,
  type LearningRecommendation,
} from "../features/learning-check";
import {
  applyStudentRequestToProgress,
  generateNextSession,
  generateTodaySession,
  type StudentRequestKind,
} from "../features/progress-orchestrator";
import {
  createDemoLearningCheckSubmission,
  createDemoSessionData,
} from "../mock/demo-session.data";
import type { LessonItem, LessonItemKind } from "../types/shared.types";
import type { DemoStep } from "./demo-flow.types";
import { readDemoStorageState, saveDemoStorageState } from "./demo-storage";

const kindLabels: Record<LessonItemKind, string> = {
  lecture: "강의",
  review: "보강",
  practice: "연습",
  check: "확인",
};

const recommendationLabels: Record<LearningRecommendation, string> = {
  insert_review: "보강 삽입",
  delay_progress: "진도 연기",
  reduce_next_session_load: "수업량 축소",
  keep_pace: "진도 유지",
};

const curriculumStatusClassNames: Record<CurriculumProgressStatus, string> = {
  완료: "completed",
  "진행 중": "current",
  예정: "planned",
  "보강 필요": "review",
  연기됨: "delayed",
};

const curriculumOptions = getCurriculums();

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
    label: "오늘 수업",
    description: "AI 담임이 편성한 수업 세션",
  },
  {
    step: "request",
    label: "요구사항 반영",
    description: "시간 부족, 복습 우선 등 조정",
  },
  {
    step: "reason",
    label: "배정 이유",
    description: "AI 담임의 조율 근거 설명",
  },
  {
    step: "learning-check",
    label: "학습 후 체크",
    description: "오늘 결과 입력",
  },
  {
    step: "next-session",
    label: "다음 수업 조율",
    description: "학습 결과 기반 다음 수업",
  },
  {
    step: "curriculum-map",
    label: "커리큘럼 맵",
    description: "전체 진도와 취약 개념 확인",
  },
];

const stepOrder = demoStepOptions.map((option) => option.step);

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

export function App() {
  const [initialDemoStorageState] = useState(() => readDemoStorageState());
  const [selectedCurriculumId, setSelectedCurriculumId] =
    useState<CurriculumId | null>(
      () => initialDemoStorageState?.selectedCurriculumId ?? null,
    );
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
  const [homeUserMessage, setHomeUserMessage] = useState("");

  const selectedCurriculumIdForData = selectedCurriculumId ?? "stable-log";
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
  const demoCurriculumSteps = useMemo(
    () =>
      getCurriculumMap(demoCurriculum, {
        currentStepId: adjustedStudentState.currentStepId,
        completedStepIds: adjustedStudentState.completedStepIds,
        delayedStepIds: adjustedStudentState.delayedStepIds,
        weakConcepts: adjustedStudentState.weakConcepts,
      }),
    [adjustedStudentState, demoCurriculum],
  );
  const defaultLearningCheckSubmission = useMemo(
    () =>
      createDemoLearningCheckSubmission(
        demoTodaySession,
        adjustedStudentState.weakConcepts.slice(0, 1),
      ),
    [adjustedStudentState.weakConcepts, demoTodaySession],
  );

  useEffect(() => {
    if (learningCheckSubmission === null) {
      setLearningCheckSubmission(defaultLearningCheckSubmission);
    }
  }, [defaultLearningCheckSubmission, learningCheckSubmission]);

  const activeLearningCheckSubmission =
    learningCheckSubmission ?? defaultLearningCheckSubmission;

  useEffect(() => {
    saveDemoStorageState({
      selectedCurriculumId,
      studentRequestKind,
      learningCheckSubmission: activeLearningCheckSubmission,
      currentDemoStep,
    });
  }, [
    activeLearningCheckSubmission,
    currentDemoStep,
    selectedCurriculumId,
    studentRequestKind,
  ]);

  const demoLearningCheckAnalysis = useMemo(
    () =>
      analyzeLearningCheck({
        submission: activeLearningCheckSubmission,
        todaySession: demoTodaySession,
      }),
    [activeLearningCheckSubmission, demoTodaySession],
  );
  const demoNextSession = useMemo(
    () =>
      generateNextSession({
        studentState: adjustedStudentState,
        todaySession: demoTodaySession,
        learningAnalysis: demoLearningCheckAnalysis,
      }),
    [adjustedStudentState, demoLearningCheckAnalysis, demoTodaySession],
  );
  const conceptOptions = useMemo(
    () =>
      [
        ...new Set([
          ...adjustedStudentState.weakConcepts,
          ...demoTodaySession.items.flatMap((item) => item.conceptTags),
        ]),
      ],
    [adjustedStudentState.weakConcepts, demoTodaySession.items],
  );
  const progressPercent = Math.round(
    (adjustedStudentState.completedStepCount / adjustedStudentState.totalStepCount) *
      100,
  );
  const problemAccuracyPercent =
    demoLearningCheckAnalysis.problemAccuracy === null
      ? null
      : Math.round(demoLearningCheckAnalysis.problemAccuracy * 100);

  function goToStep(step: DemoStep) {
    setCurrentDemoStep(step);
  }

  function goToPreviousStep() {
    const currentIndex = stepOrder.indexOf(currentDemoStep);
    const previousIndex = currentIndex <= 0 ? stepOrder.length - 1 : currentIndex - 1;
    setCurrentDemoStep(stepOrder[previousIndex]);
  }

  function goToNextStep() {
    const currentIndex = stepOrder.indexOf(currentDemoStep);
    const nextIndex = currentIndex >= stepOrder.length - 1 ? 0 : currentIndex + 1;
    setCurrentDemoStep(stepOrder[nextIndex]);
  }

  function resetDemoFlow() {
    setSelectedCurriculumId(null);
    setStudentRequestKind("default");
    setLearningCheckSubmission(null);
    setHomeUserMessage("");
    setHomeDraftMessage("");
    setCurrentDemoStep("intro");
  }

  function handleSelectCurriculum(curriculumId: CurriculumId) {
    const selectedCurriculum = curriculumOptions.find(
      (curriculum) => curriculum.id === curriculumId,
    );

    if (selectedCurriculum) {
      setHomeUserMessage(`${selectedCurriculum.title}으로 시작할게요.`);
    }

    setSelectedCurriculumId(curriculumId);
    setStudentRequestKind("default");
    setLearningCheckSubmission(null);
    setCurrentDemoStep("today");
  }

  function applyStudentRequest(requestKind: StudentRequestKind) {
    const selectedRequest = studentRequestOptions.find(
      (requestOption) => requestOption.kind === requestKind,
    );

    if (selectedRequest) {
      setHomeUserMessage(selectedRequest.label);
    }

    setStudentRequestKind(requestKind);
    setLearningCheckSubmission(null);
  }

  function handleShortTimeRequest() {
    applyStudentRequest("short_time");
    setCurrentDemoStep("request");
  }

  function handleHomeQuickReply(message: string, action: () => void) {
    setHomeUserMessage(message);
    setHomeDraftMessage("");
    window.setTimeout(action, 220);
  }

  function handleHomeMessageSubmit(message: string) {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    setHomeUserMessage(trimmedMessage);
    setHomeDraftMessage("");

    if (!hasSelectedCurriculum) {
      window.setTimeout(() => goToStep("curriculum"), 220);
      return;
    }

    if (trimmedMessage.includes("시간") || trimmedMessage.includes("부족")) {
      window.setTimeout(handleShortTimeRequest, 220);
      return;
    }

    if (trimmedMessage.includes("왜") || trimmedMessage.includes("이유")) {
      window.setTimeout(() => goToStep("reason"), 220);
      return;
    }

    if (trimmedMessage.includes("커리큘럼") || trimmedMessage.includes("전체")) {
      window.setTimeout(() => goToStep("curriculum-map"), 220);
      return;
    }

    window.setTimeout(() => goToStep("today"), 220);
  }

  function updateLearningLevel(
    field: "understandingLevel" | "focusLevel",
    value: LearningCheckLevel,
  ) {
    setLearningCheckSubmission((currentSubmission) => ({
      ...(currentSubmission ?? activeLearningCheckSubmission),
      [field]: value,
    }));
  }

  function updateProblemCorrectCount(value: string) {
    const parsedValue = Number(value);
    const safeValue = Number.isFinite(parsedValue) ? parsedValue : 0;
    const nextCorrectCount = Math.min(
      Math.max(safeValue, 0),
      activeLearningCheckSubmission.problemResult.totalCount,
    );

    setLearningCheckSubmission((currentSubmission) => ({
      ...(currentSubmission ?? activeLearningCheckSubmission),
      problemResult: {
        ...(currentSubmission ?? activeLearningCheckSubmission).problemResult,
        correctCount: nextCorrectCount,
      },
    }));
  }

  function updateProblemTotalCount(value: string) {
    const parsedValue = Number(value);
    const safeValue = Number.isFinite(parsedValue) ? parsedValue : 0;
    const nextTotalCount = Math.max(safeValue, 0);

    setLearningCheckSubmission((currentSubmission) => ({
      ...(currentSubmission ?? activeLearningCheckSubmission),
      problemResult: {
        correctCount: Math.min(
          (currentSubmission ?? activeLearningCheckSubmission).problemResult
            .correctCount,
          nextTotalCount,
        ),
        totalCount: nextTotalCount,
      },
    }));
  }

  function toggleConfusedConcept(concept: string) {
    setLearningCheckSubmission((currentSubmission) => {
      const baseSubmission = currentSubmission ?? activeLearningCheckSubmission;
      const hasConcept = baseSubmission.confusedConcepts.includes(concept);
      const confusedConcepts = hasConcept
        ? baseSubmission.confusedConcepts.filter((item) => item !== concept)
        : [...baseSubmission.confusedConcepts, concept];

      return {
        ...baseSubmission,
        confusedConcepts,
      };
    });
  }

  function toggleCompletedItem(itemId: string) {
    setLearningCheckSubmission((currentSubmission) => {
      const baseSubmission = currentSubmission ?? activeLearningCheckSubmission;
      const completedItemIds = baseSubmission.completedItemIds.includes(itemId)
        ? baseSubmission.completedItemIds.filter((id) => id !== itemId)
        : [...baseSubmission.completedItemIds, itemId];
      const skippedItemIds = demoTodaySession.items
        .filter((item) => !completedItemIds.includes(item.id))
        .map((item) => item.id);

      return {
        ...baseSubmission,
        completedItemIds,
        skippedItemIds,
      };
    });
  }

  function getSimulatedUserMessage() {
    if (homeUserMessage) {
      return homeUserMessage;
    }

    switch (currentDemoStep) {
      case "curriculum":
        return "커리큘럼을 추천해 주세요.";
      case "today":
        return hasSelectedCurriculum
          ? "오늘 수업을 보여 주세요."
          : "오늘 수업 예시를 먼저 보고 싶어요.";
      case "request":
        return "오늘 상황에 맞춰 수업을 조정해 주세요.";
      case "reason":
        return "왜 이렇게 배정됐나요?";
      case "learning-check":
        return "수업을 마쳤어요. 결과를 체크할게요.";
      case "next-session":
        return "다음 수업은 어떻게 바뀌나요?";
      case "curriculum-map":
        return "전체 커리큘럼을 보여 주세요.";
      case "intro":
      default:
        return "";
    }
  }

  function getAssistantMessage() {
    switch (currentDemoStep) {
      case "curriculum":
        return "좋습니다. 먼저 학습 흐름을 정해 보겠습니다. 지금 데모에서는 자동 생성 대신 사전 정의된 커리큘럼 중에서 선택합니다.";
      case "today":
        return hasSelectedCurriculum
          ? "선택한 커리큘럼을 기준으로 오늘 수업을 편성했습니다. 아래 카드에서 목표, 시간, 수업 순서를 확인해 주세요."
          : "아직 커리큘럼을 확정하지 않았기 때문에 안정형 흐름을 기준으로 오늘 수업 예시를 보여드리겠습니다.";
      case "request":
        return "오늘 컨디션이나 남은 시간에 맞춰 수업량을 조정할 수 있습니다. 원하는 상황을 선택하면 오늘 수업 카드가 다시 계산됩니다.";
      case "reason":
        return "아래에 오늘 수업을 이렇게 배정한 근거를 정리했습니다. AI 담임은 규칙 기반 진도 운영 결과를 학생에게 설명하는 역할을 합니다.";
      case "learning-check":
        return "수업 후 체크를 입력해 주세요. 이해도, 집중도, 헷갈린 개념, 확인 문제 결과가 다음 수업 조율의 근거가 됩니다.";
      case "next-session":
        return "입력한 학습 결과를 기준으로 다음 수업을 다시 조율했습니다. 보강이 필요한 부분은 앞쪽에 배치했습니다.";
      case "curriculum-map":
        return "현재 커리큘럼에서 어디까지 왔는지, 어떤 개념에 보강이 필요한지 한 번에 볼 수 있습니다.";
      case "intro":
      default:
        return hasSelectedCurriculum
          ? "오늘 수업은 이렇게 진행하겠습니다. 아래 카드에 오늘 수업의 핵심 흐름을 담아 두었습니다."
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
            action: () => handleSelectCurriculum("stable-log"),
          },
          {
            label: "압축형으로 시작",
            message: "압축형 커리큘럼으로 시작할게요.",
            action: () => handleSelectCurriculum("compressed-log"),
          },
          {
            label: "문제적용형으로 시작",
            message: "문제적용형 커리큘럼으로 시작할게요.",
            action: () => handleSelectCurriculum("practice-log"),
          },
        ];
      case "today":
        return [
          {
            label: "수업 완료하고 체크",
            message: "수업을 완료하고 체크할게요.",
            action: () => goToStep("learning-check"),
          },
          {
            label: "오늘 시간이 부족해요",
            message: "오늘 시간이 부족해요.",
            action: handleShortTimeRequest,
          },
          {
            label: "배정 이유 보기",
            message: "왜 이렇게 배정됐나요?",
            action: () => goToStep("reason"),
          },
        ];
      case "request":
        return [
          {
            label: "조정된 수업 보기",
            message: "조정된 수업을 보여 주세요.",
            action: () => goToStep("today"),
          },
          {
            label: "조정 이유 보기",
            message: "조정 이유를 알려 주세요.",
            action: () => goToStep("reason"),
          },
        ];
      case "reason":
        return [
          {
            label: "오늘 수업으로 이동",
            message: "오늘 수업으로 이동할게요.",
            action: () => goToStep("today"),
          },
          {
            label: "커리큘럼 맵 보기",
            message: "전체 커리큘럼을 보여 주세요.",
            action: () => goToStep("curriculum-map"),
          },
        ];
      case "learning-check":
        return [
          {
            label: "다음 수업 조율 보기",
            message: "다음 수업 조율 결과를 보여 주세요.",
            action: () => goToStep("next-session"),
          },
          {
            label: "오늘 수업 다시 보기",
            message: "오늘 수업을 다시 보여 주세요.",
            action: () => goToStep("today"),
          },
        ];
      case "next-session":
        return [
          {
            label: "커리큘럼 맵 보기",
            message: "커리큘럼 맵을 보여 주세요.",
            action: () => goToStep("curriculum-map"),
          },
          {
            label: "오늘 수업 다시 보기",
            message: "오늘 수업을 다시 보여 주세요.",
            action: () => goToStep("today"),
          },
        ];
      case "curriculum-map":
        return [
          {
            label: "오늘 수업으로 돌아가기",
            message: "오늘 수업으로 돌아갈게요.",
            action: () => goToStep("today"),
          },
          {
            label: "커리큘럼 다시 고르기",
            message: "커리큘럼을 다시 고르고 싶어요.",
            action: () => goToStep("curriculum"),
          },
        ];
      case "intro":
      default:
        return hasSelectedCurriculum
          ? [
              {
                label: "오늘 수업 시작",
                message: "오늘 수업 시작할게요.",
                action: () => goToStep("today"),
              },
              {
                label: "오늘 시간이 부족해요",
                message: "오늘 시간이 부족해요.",
                action: handleShortTimeRequest,
              },
              {
                label: "왜 이렇게 배정됐나요?",
                message: "왜 이렇게 배정됐나요?",
                action: () => goToStep("reason"),
              },
              {
                label: "전체 커리큘럼 보기",
                message: "전체 커리큘럼을 보여 주세요.",
                action: () => goToStep("curriculum-map"),
              },
            ]
          : [
              {
                label: "커리큘럼 추천받기",
                message: "커리큘럼을 추천해 주세요.",
                action: () => goToStep("curriculum"),
              },
              {
                label: "기초부터 안정적으로",
                message: "기초부터 안정적으로 가고 싶어요.",
                action: () => goToStep("curriculum"),
              },
            ];
    }
  }

  function renderStepCard() {
    switch (currentDemoStep) {
      case "curriculum":
        return (
          <article className="flow-card flow-card-wide">
            <CardHeader
              eyebrow="커리큘럼 추천"
              title="먼저 학습 흐름을 정하겠습니다"
              description="초기 데모에서는 커리큘럼을 자동 생성하지 않고, 사전 정의된 흐름 중에서 AI 담임이 추천하는 방식으로 시작합니다."
            />

            <div className="curriculum-card-list">
              {curriculumOptions.map((curriculum) => (
                <CurriculumCard
                  curriculum={curriculum}
                  isSelected={curriculum.id === selectedCurriculumId}
                  key={curriculum.id}
                  onSelect={handleSelectCurriculum}
                />
              ))}
            </div>

            <p className="flow-card-note">
              추천: 기초가 약하거나 그래프가 불안하다면 안정형부터 시작하는 편이 가장
              안전합니다. 커리큘럼을 선택하면 바로 오늘 수업을 편성합니다.
            </p>
          </article>
        );

      case "today":
        return (
          <article className="flow-card flow-card-wide">
            <CardHeader
              eyebrow={hasSelectedCurriculum ? "오늘 수업" : "오늘 수업 미리보기"}
              title={demoTodaySession.goal}
              description={demoTodaySession.teacherComment}
              aside={`${demoTodaySession.estimatedMinutes}분`}
            />

            {!hasSelectedCurriculum ? (
              <p className="flow-card-note">
                아직 커리큘럼을 확정하지 않았기 때문에 안정형 흐름으로 보여주는 예시
                수업입니다.
              </p>
            ) : null}

            <div className="lesson-list">
              {demoTodaySession.items.map((item, index) => (
                <LessonRow item={item} index={index} key={item.id} />
              ))}
            </div>

            <div className="card-actions">
              <button type="button" onClick={() => goToStep("learning-check")}>
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
                onClick={() => goToStep("reason")}
              >
                왜 이렇게 배정됐나요?
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => goToStep("curriculum-map")}
              >
                전체 커리큘럼 보기
              </button>
            </div>
          </article>
        );

      case "request":
        return (
          <article className="flow-card flow-card-wide">
            <CardHeader
              eyebrow="학생 요구사항 반영"
              title="오늘 상황에 맞춰 수업을 조정하겠습니다"
              description="학생의 요청은 자연어 입력을 붙이기 전까지 빠른 선택으로 시연합니다. 수업 조정 자체는 규칙 기반 엔진이 처리합니다."
            />

            <div className="request-card-list">
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
                  onClick={() => applyStudentRequest(requestOption.kind)}
                >
                  <strong>{requestOption.label}</strong>
                  <span>{requestOption.description}</span>
                </button>
              ))}
            </div>

            <p className="request-note">
              <strong>{studentRequestAdjustment.summary}</strong>
              {studentRequestAdjustment.teacherNote}
            </p>

            <div className="card-actions">
              <button type="button" onClick={() => goToStep("today")}>
                조정된 수업 보기
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => goToStep("reason")}
              >
                조정 이유 보기
              </button>
            </div>
          </article>
        );

      case "reason":
        return (
          <article className="flow-card">
            <CardHeader
              eyebrow="AI 담임 판단"
              title="왜 이렇게 배정됐나요?"
              description={demoTodaySession.adjustmentReason}
            />

            <ExplanationList items={demoTodaySession.explanationItems} />

            <section className="inline-panel" aria-labelledby="weak-title">
              <span className="eyebrow">보강 필요 개념</span>
              <h3 id="weak-title">오늘 먼저 잡을 부분</h3>
              <div className="tag-row strong-tags">
                {adjustedStudentState.weakConcepts.map((concept) => (
                  <span key={concept}>{concept}</span>
                ))}
              </div>
            </section>

            <div className="card-actions">
              <button type="button" onClick={() => goToStep("today")}>
                오늘 수업으로 이동
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => goToStep("curriculum-map")}
              >
                커리큘럼 맵 보기
              </button>
            </div>
          </article>
        );

      case "learning-check":
        return (
          <article className="flow-card flow-card-wide">
            <CardHeader
              eyebrow="학습 후 체크"
              title="오늘 결과를 알려 주세요"
              description="이 입력값은 다음 수업 조율의 근거로 사용됩니다. 실제 서비스 단계에서는 서버 저장소로 옮겨야 하지만, 데모에서는 localStorage에만 임시 저장합니다."
            />

            <div className="check-layout">
              <div className="check-form" aria-label="학습 후 체크 입력">
                <LearningLevelCheckboxGroup
                  label="이해도"
                  options={understandingLevelOptions}
                  selectedLevel={activeLearningCheckSubmission.understandingLevel}
                  onSelect={(level) => updateLearningLevel("understandingLevel", level)}
                />

                <LearningLevelCheckboxGroup
                  label="집중도"
                  options={focusLevelOptions}
                  selectedLevel={activeLearningCheckSubmission.focusLevel}
                  onSelect={(level) => updateLearningLevel("focusLevel", level)}
                />

                <div className="field-group">
                  <span>확인 문제</span>
                  <div className="problem-input-row">
                    <label>
                      <input
                        type="number"
                        min="0"
                        max={activeLearningCheckSubmission.problemResult.totalCount}
                        value={activeLearningCheckSubmission.problemResult.correctCount}
                        onChange={(event) =>
                          updateProblemCorrectCount(event.target.value)
                        }
                      />
                      <span>정답 수</span>
                    </label>
                    <label>
                      <input
                        type="number"
                        min="0"
                        value={activeLearningCheckSubmission.problemResult.totalCount}
                        onChange={(event) => updateProblemTotalCount(event.target.value)}
                      />
                      <span>전체 문항</span>
                    </label>
                  </div>
                </div>

                <div className="field-group">
                  <span>헷갈린 개념</span>
                  <div className="checkbox-grid">
                    {conceptOptions.map((concept) => (
                      <label className="check-chip" key={concept}>
                        <input
                          type="checkbox"
                          checked={activeLearningCheckSubmission.confusedConcepts.includes(
                            concept,
                          )}
                          onChange={() => toggleConfusedConcept(concept)}
                        />
                        <span>{concept}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="field-group">
                  <span>완료한 항목</span>
                  <div className="item-check-list">
                    {demoTodaySession.items.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={activeLearningCheckSubmission.completedItemIds.includes(
                            item.id,
                          )}
                          onChange={() => toggleCompletedItem(item.id)}
                        />
                        <span>{item.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <LearningSummary
                activeLearningCheckSubmission={activeLearningCheckSubmission}
                problemAccuracyPercent={problemAccuracyPercent}
                recommendedActions={demoLearningCheckAnalysis.recommendedActions}
                reviewConcepts={demoLearningCheckAnalysis.reviewConcepts}
              />
            </div>

            <div className="card-actions">
              <button type="button" onClick={() => goToStep("next-session")}>
                다음 수업 조율 보기
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => goToStep("today")}
              >
                오늘 수업 다시 보기
              </button>
            </div>
          </article>
        );

      case "next-session":
        return (
          <article className="flow-card flow-card-wide">
            <CardHeader
              eyebrow="조율된 다음 수업"
              title={demoNextSession.goal}
              description={demoNextSession.teacherComment}
              aside={`${demoNextSession.estimatedMinutes}분`}
            />

            <p className="teacher-comment">{demoNextSession.adjustmentReason}</p>
            <ExplanationList items={demoNextSession.explanationItems} />

            <div className="compact-flow-list">
              {demoNextSession.items.map((item, index) => (
                <LessonRow item={item} index={index} key={item.id} />
              ))}
            </div>

            <div className="card-actions">
              <button type="button" onClick={() => goToStep("curriculum-map")}>
                커리큘럼 맵 보기
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => goToStep("today")}
              >
                오늘 수업 다시 보기
              </button>
            </div>
          </article>
        );

      case "curriculum-map":
        return (
          <article className="flow-card flow-card-wide">
            <CardHeader
              eyebrow="커리큘럼 맵"
              title="진도와 취약 개념 상태를 한 번에 확인합니다"
              description="이 화면은 전체 학습 관리 화면이 아니라, AI 담임이 어떤 기준으로 진도를 조율하고 있는지 보조적으로 보여주는 카드입니다."
            />

            <ol className="step-list">
              {demoCurriculumSteps.map((step) => (
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

            <div className="card-actions">
              <button type="button" onClick={() => goToStep("today")}>
                오늘 수업으로 돌아가기
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => goToStep("curriculum")}
              >
                커리큘럼 다시 고르기
              </button>
            </div>
          </article>
        );

      case "intro":
      default:
        return (
          <article className="flow-card chat-attachment-overview">
            <CardHeader eyebrow="AI 담임 홈" title="오늘 수업은 이렇게 진행하겠습니다" />

            {hasSelectedCurriculum ? (
              <section className="session-overview" aria-label="오늘 수업 요약">
                <div className="status-panel">
                  <div className="status-label">현재 커리큘럼</div>
                  <strong>{adjustedStudentState.selectedCurriculumTitle}</strong>
                  <span>{adjustedStudentState.currentStepTitle} 진행 중</span>
                  <div
                    className="progress-track"
                    aria-label={`진도율 ${progressPercent}%`}
                  >
                    <div style={{ width: `${progressPercent}%` }} />
                  </div>
                  <span>
                    {adjustedStudentState.completedStepCount}/
                    {adjustedStudentState.totalStepCount}단계 완료
                  </span>
                </div>

                <div className="preview-panel">
                  <span className="eyebrow">오늘 목표</span>
                  <h3>{demoTodaySession.goal}</h3>
                  <p>{demoTodaySession.teacherComment}</p>
                  <p>{demoTodaySession.adjustmentReason}</p>
                </div>
              </section>
            ) : (
              <section className="preview-panel">
                <span className="eyebrow">AI 추천 예고</span>
                <h3>먼저 커리큘럼을 추천하겠습니다</h3>
                <p>
                  초기 데모에서는 안정형, 압축형, 문제적용형 중 하나를 선택합니다.
                  선택된 커리큘럼을 기준으로 오늘 수업 카드가 생성됩니다.
                </p>
              </section>
            )}
          </article>
        );
    }
  }

  return (
    <main className="app-shell chat-app-shell">
      <DevStepControl
        currentStep={currentDemoStep}
        onNext={goToNextStep}
        onPrevious={goToPreviousStep}
        onReset={resetDemoFlow}
        onStepChange={goToStep}
      />

      <section className="chat-app" aria-label="AI 담임 채팅형 데모">
        <header className="chat-app-header">
          <div>
            <span className="eyebrow">AI 담임 서비스 데모</span>
            <h1>AI 담임과 오늘 수업 조율</h1>
            <p>
              AI 담임이 대화 안에서 필요한 카드들을 꺼내 보여주고, 학생의 답변에 따라
              오늘 수업과 다음 수업을 조율합니다.
            </p>
          </div>
        </header>

        <div className="chat-thread" aria-live="polite">
          <ChatMessage role="assistant">
            <p>
              안녕하세요. 저는 오늘 수업을 편성하고, 학생의 요구사항과 학습 결과에
              맞춰 진도를 조율하는 AI 담임입니다.
            </p>
          </ChatMessage>

          {getSimulatedUserMessage() ? (
            <ChatMessage role="user">
              <p>{getSimulatedUserMessage()}</p>
            </ChatMessage>
          ) : null}

          <ChatMessage role="assistant">
            <p>{getAssistantMessage()}</p>
            <div className="chat-card-slot">{renderStepCard()}</div>
          </ChatMessage>
        </div>

        <form
          className="chat-app-composer"
          onSubmit={(event) => {
            event.preventDefault();
            handleHomeMessageSubmit(homeDraftMessage);
          }}
        >
          <div className="chat-example-actions" aria-label="예시 답변">
            {getChatSuggestions().map((suggestion) => (
              <button
                type="button"
                className="chat-suggestion"
                key={suggestion.label}
                onClick={() =>
                  handleHomeQuickReply(suggestion.message, suggestion.action)
                }
              >
                {suggestion.label}
              </button>
            ))}
          </div>

          <div className="chat-input-row">
            <input
              type="text"
              value={homeDraftMessage}
              onChange={(event) => setHomeDraftMessage(event.target.value)}
              placeholder="AI 담임에게 답장하거나 요청을 입력하세요"
            />
            <button type="submit">전송</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function CardHeader({
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
    <header className="flow-card-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
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
      className={`chat-thread-row ${
        isAssistant ? "chat-thread-row-assistant" : "chat-thread-row-user"
      }`}
    >
      {isAssistant ? (
        <div className="chat-avatar" aria-hidden="true">
          AI
        </div>
      ) : null}
      <div
        className={`chat-thread-bubble ${
          isAssistant ? "chat-thread-bubble-assistant" : "chat-thread-bubble-user"
        }`}
      >
        {children}
      </div>
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

function LearningSummary({
  activeLearningCheckSubmission,
  problemAccuracyPercent,
  recommendedActions,
  reviewConcepts,
}: {
  activeLearningCheckSubmission: LearningCheckSubmission;
  problemAccuracyPercent: number | null;
  recommendedActions: LearningRecommendation[];
  reviewConcepts: string[];
}) {
  return (
    <aside className="learning-result-panel" aria-label="학습 후 체크 요약">
      <span className="eyebrow">즉시 분석</span>
      <dl className="summary-list">
        <div>
          <dt>이해도</dt>
          <dd>
            {getLearningLevelLabel(
              understandingLevelOptions,
              activeLearningCheckSubmission.understandingLevel,
            )}
          </dd>
        </div>
        <div>
          <dt>집중도</dt>
          <dd>
            {getLearningLevelLabel(
              focusLevelOptions,
              activeLearningCheckSubmission.focusLevel,
            )}
          </dd>
        </div>
        <div>
          <dt>확인 문제</dt>
          <dd>
            {activeLearningCheckSubmission.problemResult.correctCount}/
            {activeLearningCheckSubmission.problemResult.totalCount}개 정답
            {problemAccuracyPercent !== null ? ` · ${problemAccuracyPercent}%` : ""}
          </dd>
        </div>
        <div>
          <dt>조율 판단</dt>
          <dd>
            {recommendedActions.map((action) => recommendationLabels[action]).join(" · ")}
          </dd>
        </div>
      </dl>

      <div className="tag-row strong-tags">
        {reviewConcepts.map((concept) => (
          <span key={concept}>{concept}</span>
        ))}
      </div>
    </aside>
  );
}

function LearningLevelCheckboxGroup({
  label,
  options,
  selectedLevel,
  onSelect,
}: {
  label: string;
  options: Array<{
    level: LearningCheckLevel;
    label: string;
    description: string;
  }>;
  selectedLevel: LearningCheckLevel;
  onSelect: (level: LearningCheckLevel) => void;
}) {
  return (
    <div className="field-group">
      <span>{label}</span>
      <div className="learning-choice-grid">
        {options.map((option) => (
          <label className="learning-choice" key={option.level}>
            <input
              type="checkbox"
              checked={selectedLevel === option.level}
              onChange={() => onSelect(option.level)}
            />
            <span>
              <strong>{option.label}</strong>
              <em>{option.description}</em>
            </span>
          </label>
        ))}
      </div>
    </div>
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
  curriculum: Curriculum;
  isSelected: boolean;
  onSelect: (curriculumId: CurriculumId) => void;
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
