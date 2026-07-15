# 데이터 개념 설계

## 설계 원칙

초기 데모에서는 복잡한 서버 상태를 만들지 않습니다.
데이터는 먼저 mock data로 정의하고, 사용자의 선택과 학습 결과만 localStorage에 저장하는 방향으로 시작합니다.

핵심 데이터는 다음 질문에 답해야 합니다.

```text
어떤 커리큘럼을 선택했는가?
현재 어느 단계에 있는가?
오늘 어떤 수업을 해야 하는가?
학생이 무엇을 요청했는가?
학습 결과가 어땠는가?
그 결과 다음 수업이 어떻게 바뀌었는가?
AI 담임은 왜 그렇게 조율했다고 설명하는가?
```

## 주요 타입 초안

아래 타입은 구현 시 참고할 설계 초안입니다.
실제 파일 생성은 구현 단계에서 진행합니다.

```ts
type Curriculum = {
  id: string;
  title: string;
  description: string;
  recommendedFor: string[];
  steps: CurriculumStep[];
};

type CurriculumStep = {
  id: string;
  title: string;
  conceptTags: string[];
  estimatedMinutes: number;
  defaultItems: LessonItem[];
};

type StudentState = {
  selectedCurriculumId: string;
  currentStepId: string;
  weakConcepts: string[];
  completedStepIds: string[];
  delayedStepIds: string[];
  lastLearningCheck?: LearningCheckResult;
};

type TodaySession = {
  id: string;
  date: string;
  goal: string;
  estimatedMinutes: number;
  items: LessonItem[];
  adjustmentReason: string;
  teacherComment: string;
};

type LessonItem = {
  id: string;
  kind: "lecture" | "review" | "practice" | "check";
  title: string;
  conceptTags: string[];
  estimatedMinutes: number;
  required: boolean;
};

type StudentRequest = {
  rawText: string;
  intent: StudentRequestIntent;
  targetMinutes?: number;
  preferredMode?: "new_concept" | "review" | "practice";
  mentionedConcepts: string[];
};

type LearningCheckResult = {
  completion: "completed" | "partial" | "not_completed";
  understanding: "easy" | "normal" | "hard";
  focus: "high" | "normal" | "low";
  confusedConcepts: string[];
  correctCount: number;
  totalCount: number;
};

type NextSessionAdjustment = {
  previousPlanSummary: string;
  adjustedPlan: LessonItem[];
  insertedReviewItems: LessonItem[];
  delayedItems: LessonItem[];
  reason: string;
  teacherComment: string;
};
```

## 커리큘럼

사전 정의된 학습 경로입니다.
초기 데모에서는 사용자가 아래 3가지 중 하나를 선택합니다.

```text
안정형
압축형
문제적용형
```

커리큘럼은 자동 생성하지 않습니다.
커리큘럼 선택 이후에는 해당 커리큘럼의 단계와 학생 상태를 기준으로 오늘 수업을 편성합니다.

## 커리큘럼 단계

커리큘럼을 구성하는 개별 학습 단위입니다.

예시:

```text
로그 개념
로그 계산
로그함수 그래프
그래프 보강
로그방정식
로그부등식
종합 복습
```

각 단계는 예상 시간, 개념 태그, 기본 수업 항목을 가집니다.

## 학생 상태

학생 상태는 진도 조율의 기준입니다.

초기 데모에서 필요한 상태:

```text
선택한 커리큘럼
현재 단계
완료한 단계
연기된 단계
취약 개념
마지막 학습 후 체크 결과
```

학생 상태는 mock data로 시작하고, 데모 동작 중 바뀌는 값은 localStorage에 저장할 수 있습니다.

## 오늘 수업

AI 담임 홈에서 가장 먼저 보여주는 핵심 객체입니다.
오늘 수업은 강의 목록이 아니라 하나의 수업 세션처럼 보여야 합니다.

구성 요소:

```text
오늘 목표
예상 소요 시간
수업 항목 목록
조율 이유
AI 담임 코멘트
```

## 학생 요구사항

학생이 오늘 상황이나 희망을 말한 입력입니다.

예시:

```text
오늘 시간이 20분밖에 없어요.
새 강의보다 복습 위주로 하고 싶어요.
그래프가 아직 헷갈려요.
```

요구사항 해석은 mock AI 또는 LLM 연결 지점으로 분리합니다.
다만 해석 결과를 실제 수업에 반영하는 판단은 규칙 기반 엔진이 수행합니다.

## 강의별 학습 기록

강의가 끝날 때마다 받는 최소 단위의 학습 기록입니다.

```ts
type LessonFeedback = {
  lessonItemId: string;
  lessonTitle: string;
  conceptTags: string[];
  understandingLevel: 1 | 2 | 3 | 4 | 5;
  focusLevel: 1 | 2 | 3 | 4 | 5;
  completedAt: string;
};
```

초기 데모에서 학생이 직접 입력하는 값은 이해도와 집중도뿐입니다.
이해도가 낮으면 해당 강의의 `conceptTags`를 보강 후보로 반영하고, 집중도가 낮으면 다음 수업량을 줄이는 신호로 사용합니다.
헷갈린 개념이나 확인 문제 결과는 의무 설문으로 수집하지 않으며, 학생이 채팅으로 직접 말할 때만 별도 요구사항으로 해석합니다.

## 내부 다음 수업 조율과 진행 보고

다음 수업 조율 결과는 규칙 기반 엔진이 관리하는 내부 데이터입니다.
학생 화면에는 상세 편성 대신 아래 정보만 담은 읽기 전용 진행 보고를 제공합니다.

```text
완료한 강의
해당 강의의 이해도와 집중도
AI 담임의 짧은 반영 안내
```

## 규칙 기반 엔진과 AI 담임 문장의 분리

초기 데모에서 판단과 설명은 분리합니다.

규칙 기반 엔진이 처리할 것:

```text
오늘 수업 생성
보강 삽입 여부
진도 연기 여부
수업량 조절
복구 계획 생성
다음 수업 조율
커리큘럼 상태 업데이트
```

AI 담임 응답이 처리할 것:

```text
학생 요구사항 해석
AI 담임 코멘트 생성
조율 이유 자연어 설명
학생 친화적 피드백 생성
```

이 분리를 유지해야 LLM API를 나중에 붙이더라도 핵심 진도 조율 로직이 흔들리지 않습니다.
