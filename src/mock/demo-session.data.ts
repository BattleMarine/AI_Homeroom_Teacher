import type { CurriculumStep, DemoStudentState, TodaySession } from "../types/shared.types";

export const demoStudentState: DemoStudentState = {
  selectedCurriculumTitle: "안정형 커리큘럼",
  currentStepTitle: "로그함수 그래프",
  weakConcepts: ["점근선", "평행이동"],
  completedStepCount: 2,
  totalStepCount: 7,
};

export const demoTodaySession: TodaySession = {
  goal: "로그함수 그래프의 점근선과 평행이동을 안정적으로 정리하기",
  estimatedMinutes: 42,
  adjustmentReason:
    "이전 학습 체크에서 평행이동 실수가 반복되어 새 진도 전에 짧은 보강을 먼저 배치했습니다.",
  teacherComment:
    "오늘은 그래프 해석을 먼저 안정시키고, 이어서 로그방정식 개념으로 넘어가겠습니다. 진도를 무리하게 밀기보다 헷갈린 지점을 먼저 잡는 편이 안전합니다.",
  items: [
    {
      id: "review-asymptote",
      kind: "review",
      title: "점근선 보강 카드",
      description: "로그함수 그래프에서 점근선이 생기는 이유를 짧게 복습합니다.",
      conceptTags: ["점근선", "그래프"],
      estimatedMinutes: 8,
      required: true,
      reason: "취약 개념 보강",
    },
    {
      id: "practice-shift",
      kind: "practice",
      title: "평행이동 예제 2개",
      description: "그래프가 좌우와 상하로 이동할 때 식이 어떻게 바뀌는지 확인합니다.",
      conceptTags: ["평행이동", "그래프"],
      estimatedMinutes: 7,
      required: true,
      reason: "반복 실수 확인",
    },
    {
      id: "check-graph",
      kind: "check",
      title: "그래프 확인 문제 3개",
      description: "점근선과 평행이동을 실제 문제에서 구분할 수 있는지 확인합니다.",
      conceptTags: ["점근선", "평행이동"],
      estimatedMinutes: 7,
      required: true,
      reason: "이해도 확인",
    },
    {
      id: "lecture-equation",
      kind: "lecture",
      title: "로그방정식 개념 강의",
      description: "그래프 해석을 바탕으로 로그방정식의 기본 풀이 흐름을 익힙니다.",
      conceptTags: ["로그방정식"],
      estimatedMinutes: 20,
      required: false,
      reason: "다음 단계 진도",
    },
  ],
};

export const demoCurriculumSteps: CurriculumStep[] = [
  {
    id: "log-meaning",
    title: "로그의 뜻",
    conceptTags: ["로그", "지수"],
    estimatedMinutes: 35,
    status: "완료",
  },
  {
    id: "log-calculation",
    title: "로그 계산",
    conceptTags: ["로그", "계산"],
    estimatedMinutes: 40,
    status: "완료",
  },
  {
    id: "log-graph",
    title: "로그함수 그래프",
    conceptTags: ["점근선", "평행이동"],
    estimatedMinutes: 42,
    status: "진행 중",
  },
  {
    id: "graph-review",
    title: "그래프 보강",
    conceptTags: ["그래프", "오답"],
    estimatedMinutes: 25,
    status: "보강 필요",
  },
  {
    id: "log-equation",
    title: "로그방정식",
    conceptTags: ["로그방정식"],
    estimatedMinutes: 35,
    status: "예정",
  },
  {
    id: "log-inequality",
    title: "로그부등식",
    conceptTags: ["로그부등식"],
    estimatedMinutes: 35,
    status: "예정",
  },
  {
    id: "final-review",
    title: "종합 복습",
    conceptTags: ["종합", "복습"],
    estimatedMinutes: 45,
    status: "예정",
  },
];
