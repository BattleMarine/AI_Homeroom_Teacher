# 구현 로드맵

## 전제

현재 단계는 프로젝트 제작이 아니라 문서화와 구조 설계 단계입니다.
아래 로드맵은 실제 구현을 시작할 때 작업 범위가 과도하게 넓어지지 않도록 기준을 제시합니다.

## 1단계. 정적 화면 구현

목표:

```text
AI 담임 서비스 데모의 핵심 화면을 정적으로 확인한다.
```

만들 화면:

```text
커리큘럼 선택
AI 담임 홈
오늘 수업 세션
학습 후 체크
조율 결과
커리큘럼 맵
```

예상 파일:

```text
src/app/App.tsx
src/components/layout/AppShell.tsx
src/components/curriculum/CurriculumCard.tsx
src/components/curriculum/CurriculumMap.tsx
src/components/lesson/TodaySessionCard.tsx
src/components/lesson/LessonItemList.tsx
src/components/feedback/LearningCheckForm.tsx
src/components/ai-teacher/TeacherComment.tsx
```

완료 기준:

```text
첫 화면이 강의 목록이 아니라 오늘 수업 중심으로 보인다.
사용자가 전체 데모 흐름을 시각적으로 이해할 수 있다.
```

## 2단계. mock data 연결

목표:

```text
정적 문구를 mock data 기반으로 교체한다.
```

예상 파일:

```text
src/mock/demo-student.data.ts
src/features/curriculum/curriculum.data.ts
src/mock/demo-session.data.ts
```

완료 기준:

```text
커리큘럼 카드와 오늘 수업 세션이 데이터에서 렌더링된다.
```

## 3단계. 오늘 수업 생성 로직

목표:

```text
선택한 커리큘럼과 학생 상태를 기반으로 오늘 수업을 생성한다.
```

예상 파일:

```text
src/features/progress-orchestrator/session-builder.ts
src/features/progress-orchestrator/orchestrator.rules.ts
src/features/progress-orchestrator/orchestrator.service.ts
```

초기 규칙:

```text
취약 개념이 있으면 보강을 앞에 배치한다.
현재 단계의 기본 수업 항목을 오늘 수업에 포함한다.
예상 시간이 너무 길면 필수 항목과 선택 항목을 구분한다.
```

완료 기준:

```text
사용자가 커리큘럼을 선택하면 오늘 수업이 자동 생성된다.
```

## 4단계. 학습 후 체크 반영

목표:

```text
학습 결과 입력을 학생 상태와 다음 수업 조율에 반영한다.
```

예상 파일:

```text
src/features/learning-check/learning-check.types.ts
src/features/learning-check/learning-check.service.ts
```

초기 규칙:

```text
이해도 어려움이면 보강 필요 상태를 추가한다.
집중도 낮음이면 다음 수업 예상 시간을 줄인다.
정답률이 낮으면 관련 개념을 취약 개념에 추가한다.
일부 완료 또는 미완료면 연기 항목을 생성한다.
```

완료 기준:

```text
학습 후 체크 결과가 다음 수업 조율의 입력으로 사용된다.
```

## 5단계. 다음 수업 조율

목표:

```text
기존 다음 수업과 조정된 다음 수업을 비교해 보여준다.
```

예상 파일:

```text
src/features/progress-orchestrator/adjustment.service.ts
```

완료 기준:

```text
추가된 보강, 연기된 진도, 조정 이유가 화면에 표시된다.
```

## 6단계. 학생 요구사항 반영

목표:

```text
학생이 입력한 오늘 상황을 오늘 수업 조정에 반영한다.
```

예상 파일:

```text
src/features/teacher-response/teacher-response.mock.ts
src/features/teacher-response/teacher-response.service.ts
```

초기 지원 요구:

```text
오늘 시간이 부족해요.
복습 위주로 하고 싶어요.
특정 개념이 헷갈려요.
```

완료 기준:

```text
학생 요구사항에 따라 오늘 수업 구성과 예상 시간이 바뀐다.
```

## 7단계. AI 담임 코멘트 개선

목표:

```text
조율 결과를 학생에게 부드럽고 명확하게 설명한다.
```

완료 기준:

```text
AI 담임 코멘트가 조율 이유, 현재 상태, 다음 행동을 함께 설명한다.
비난하는 표현 없이 복구 계획을 제시한다.
```

## 8단계. LLM API 연결

목표:

```text
mock AI 응답을 실제 LLM API로 교체할 수 있는 구조를 마련한다.
```

주의:

```text
LLM은 판단을 독점하지 않는다.
진도 조율 판단은 계속 규칙 기반 엔진이 담당한다.
API 키는 환경 변수로만 관리한다.
```

## 이번 문서화 단계에서 하지 않는 일

```text
프로젝트 초기화
패키지 설치
화면 구현
LLM API 연결
로그인 구현
DB 설계
관리자 페이지 설계
실제 영상 스트리밍 설계
```
