import type { CurriculumDefinition, LessonItem } from "./progress.types.js";

function lesson(item: Omit<LessonItem, "playbackTargetId">): LessonItem {
  return {
    ...item,
    playbackTargetId: item.kind === "lecture" ? `mock-video:${item.id}` : undefined,
  };
}

function basicLesson(
  id: string,
  title: string,
  conceptTags: string[],
  estimatedMinutes: number,
): LessonItem {
  return lesson({
    id,
    kind: "lecture",
    title,
    description: `${title}의 핵심 개념을 정리합니다.`,
    conceptTags,
    estimatedMinutes,
    required: true,
    reason: "현재 단계 핵심 학습",
  });
}

export const mockCurriculums: CurriculumDefinition[] = [
  {
    id: "stable-log",
    title: "안정형 커리큘럼",
    pace: "안정형",
    description: "기초 보강과 개념 흐름을 충분히 포함해 로그함수 단원을 안정적으로 완성합니다.",
    recommendedFor: ["기초가 약한 학생", "로그함수 그래프가 불안한 학생"],
    teacherComment: "보강을 중간에 넣어 개념 흐름을 안정시키겠습니다.",
    initialProgress: {
      currentStepId: "log-graph",
      completedStepIds: ["log-meaning", "log-calculation"],
      weakConcepts: ["점근선", "평행이동"],
    },
    steps: [
      { id: "log-meaning", title: "로그의 뜻", goal: "로그와 지수의 관계 이해", conceptTags: ["로그", "지수"], estimatedMinutes: 35, items: [basicLesson("stable-log-meaning-lecture", "로그의 뜻 개념 강의", ["로그", "지수"], 22)] },
      { id: "log-calculation", title: "로그 계산", goal: "로그의 기본 성질로 계산", conceptTags: ["로그", "계산"], estimatedMinutes: 40, items: [basicLesson("stable-log-calculation-lecture", "로그 계산 성질 정리", ["로그", "계산"], 24)] },
      {
        id: "log-graph",
        title: "로그함수 그래프",
        goal: "로그함수 그래프의 점근선과 평행이동 정리",
        conceptTags: ["점근선", "평행이동", "그래프"],
        estimatedMinutes: 44,
        items: [
          lesson({ id: "stable-log-graph-review-asymptote", kind: "review", title: "점근선 보강 카드", description: "로그함수 그래프에서 점근선이 생기는 이유를 짧게 복습합니다.", conceptTags: ["점근선", "그래프"], estimatedMinutes: 6, required: true, reason: "취약 개념 보강" }),
          lesson({ id: "stable-log-graph-practice-shift", kind: "practice", title: "평행이동 예제 2개", description: "그래프가 이동할 때 식이 어떻게 바뀌는지 확인합니다.", conceptTags: ["평행이동", "그래프"], estimatedMinutes: 5, required: true, reason: "반복 실수 확인" }),
          lesson({ id: "stable-log-graph-check", kind: "check", title: "그래프 확인 문제 3개", description: "점근선과 평행이동을 문제에서 구분하는지 확인합니다.", conceptTags: ["점근선", "평행이동"], estimatedMinutes: 5, required: true, reason: "이해도 확인" }),
          lesson({ id: "stable-log-graph-asymptote-lecture", kind: "lecture", title: "로그함수 그래프: 점근선과 정의역", description: "그래프가 가까워지는 선과 정의역의 관계를 정리합니다.", conceptTags: ["점근선", "정의역", "그래프"], estimatedMinutes: 9, required: true, reason: "그래프 핵심 개념" }),
          lesson({ id: "stable-log-graph-shift-lecture", kind: "lecture", title: "로그함수 그래프: 평행이동", description: "식의 변화에 따른 그래프 이동을 예제로 확인합니다.", conceptTags: ["평행이동", "그래프"], estimatedMinutes: 9, required: true, reason: "그래프 변화 이해" }),
          lesson({ id: "stable-log-equation-preview", kind: "lecture", title: "로그방정식 개념 미리 보기", description: "그래프 해석을 로그방정식으로 연결합니다.", conceptTags: ["로그방정식"], estimatedMinutes: 10, required: false, reason: "다음 단계 맛보기" }),
        ],
      },
      { id: "graph-review", title: "그래프 보강", goal: "그래프 오답 개념 복구", conceptTags: ["그래프", "점근선", "평행이동"], estimatedMinutes: 25, items: [basicLesson("stable-graph-review-card", "그래프 오답 보강", ["그래프", "점근선"], 15)] },
      { id: "log-equation", title: "로그방정식", goal: "로그방정식의 풀이 조건 익히기", conceptTags: ["로그방정식"], estimatedMinutes: 35, items: [basicLesson("stable-log-equation-lecture", "로그방정식 개념 강의", ["로그방정식"], 25)] },
      { id: "log-inequality", title: "로그부등식", goal: "로그부등식의 조건 확인", conceptTags: ["로그부등식"], estimatedMinutes: 35, items: [basicLesson("stable-log-inequality-lecture", "로그부등식 개념 강의", ["로그부등식"], 25)] },
      { id: "final-review", title: "종합 복습", goal: "로그함수 단원 전체 흐름 정리", conceptTags: ["종합", "복습"], estimatedMinutes: 45, items: [basicLesson("stable-final-review", "로그함수 종합 복습", ["종합", "복습"], 25)] },
    ],
  },
  {
    id: "compressed-log",
    title: "압축형 커리큘럼",
    pace: "압축형",
    description: "이미 배운 내용을 빠르게 훑고 핵심 확인 문제로 흐름을 점검합니다.",
    recommendedFor: ["이미 한 번 배운 학생", "시간이 부족한 학생"],
    teacherComment: "긴 설명보다 핵심 확인과 짧은 문제로 빈틈을 찾겠습니다.",
    initialProgress: { currentStepId: "log-graph-core", completedStepIds: ["log-core-summary", "log-calculation-check"], weakConcepts: ["점근선", "그래프"] },
    steps: [
      { id: "log-core-summary", title: "로그 핵심 개념 요약", goal: "로그와 지수 관계 복습", conceptTags: ["로그", "지수"], estimatedMinutes: 20, items: [basicLesson("compressed-core-summary", "로그 핵심 개념 요약", ["로그", "지수"], 12)] },
      { id: "log-calculation-check", title: "로그 계산 확인", goal: "로그 계산 실수 점검", conceptTags: ["로그", "계산"], estimatedMinutes: 22, items: [basicLesson("compressed-calculation-check", "로그 계산 확인 문제", ["로그", "계산"], 14)] },
      { id: "log-graph-core", title: "로그함수 그래프 핵심", goal: "그래프의 점근선과 이동 압축 정리", conceptTags: ["점근선", "평행이동", "그래프"], estimatedMinutes: 28, items: [lesson({ id: "compressed-graph-review", kind: "review", title: "그래프 핵심 요약", description: "점근선, 정의역, 평행이동만 빠르게 정리합니다.", conceptTags: ["점근선", "평행이동"], estimatedMinutes: 12, required: true, reason: "압축 복습" }), lesson({ id: "compressed-graph-practice", kind: "practice", title: "그래프 적용 문제 3개", description: "그래프 정보를 식과 연결하는 문제를 풉니다.", conceptTags: ["그래프"], estimatedMinutes: 16, required: true, reason: "적용 확인" })] },
      { id: "log-equation", title: "로그방정식", goal: "로그방정식 풀이 흐름 복습", conceptTags: ["로그방정식"], estimatedMinutes: 28, items: [basicLesson("compressed-equation-lecture", "로그방정식 압축 강의", ["로그방정식"], 16)] },
      { id: "log-inequality", title: "로그부등식", goal: "로그부등식 조건 확인", conceptTags: ["로그부등식"], estimatedMinutes: 28, items: [basicLesson("compressed-inequality-lecture", "로그부등식 압축 강의", ["로그부등식"], 16)] },
      { id: "check-focused-review", title: "확인 문제 중심 복습", goal: "단원 전체 약점 점검", conceptTags: ["확인 문제", "복습"], estimatedMinutes: 35, items: [basicLesson("compressed-final-check", "단원 확인 문제", ["확인 문제", "복습"], 25)] },
    ],
  },
  {
    id: "practice-log",
    title: "문제적용형 커리큘럼",
    pace: "문제적용형",
    description: "개념 설명보다 문제 적용과 오답 보강을 중심으로 로그함수 단원을 점검합니다.",
    recommendedFor: ["개념은 알지만 문제 적용이 약한 학생", "오답 중심으로 공부하고 싶은 학생"],
    teacherComment: "문제에서 막히는 지점을 찾고 짧은 보강으로 바로 연결하겠습니다.",
    initialProgress: { currentStepId: "graph-application", completedStepIds: ["log-calculation-check"], weakConcepts: ["그래프", "평행이동"] },
    steps: [
      { id: "log-calculation-check", title: "로그 계산 확인", goal: "문제 풀이 전 계산 실수 줄이기", conceptTags: ["로그", "계산"], estimatedMinutes: 24, items: [basicLesson("practice-calculation-check", "로그 계산 확인 문제", ["로그", "계산"], 16)] },
      { id: "graph-application", title: "그래프 문제 적용", goal: "그래프 정보를 문제 조건과 연결", conceptTags: ["그래프", "점근선", "평행이동"], estimatedMinutes: 32, items: [lesson({ id: "practice-graph-problems", kind: "practice", title: "그래프 적용 문제 4개", description: "그래프의 점근선과 이동 정보를 식으로 해석합니다.", conceptTags: ["그래프", "점근선", "평행이동"], estimatedMinutes: 24, required: true, reason: "문제 적용" }), lesson({ id: "practice-graph-review", kind: "review", title: "그래프 오답 보강", description: "막힌 문제의 개념만 짧게 복구합니다.", conceptTags: ["그래프", "오답"], estimatedMinutes: 8, required: false, reason: "오답 보강" })] },
      { id: "equation-application", title: "방정식 문제 적용", goal: "로그방정식 조건과 풀이 순서 적용", conceptTags: ["로그방정식", "문제 적용"], estimatedMinutes: 32, items: [basicLesson("practice-equation-problems", "로그방정식 적용 문제 4개", ["로그방정식"], 24)] },
      { id: "inequality-application", title: "부등식 문제 적용", goal: "로그부등식 조건 적용", conceptTags: ["로그부등식", "문제 적용"], estimatedMinutes: 32, items: [basicLesson("practice-inequality-problems", "로그부등식 적용 문제 4개", ["로그부등식"], 24)] },
      { id: "wrong-answer-review", title: "오답 보강", goal: "반복 오답 개념 복구", conceptTags: ["오답", "보강"], estimatedMinutes: 28, items: [basicLesson("practice-wrong-answer-review", "오답 개념 보강", ["오답", "보강"], 18)] },
      { id: "final-problems", title: "종합 문제", goal: "로그함수 단원 적용력 점검", conceptTags: ["종합", "문제 적용"], estimatedMinutes: 40, items: [basicLesson("practice-final-problems", "로그함수 종합 문제", ["종합", "문제 적용"], 30)] },
    ],
  },
];
