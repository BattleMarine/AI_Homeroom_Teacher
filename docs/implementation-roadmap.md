# 구현 로드맵

## 전제

현재 단계는 핵심 데모 구현이 거의 마무리된 상태입니다.
아래 로드맵은 구현 범위가 과도하게 넓어지지 않도록 기준을 제시하고, 현재 완료 여부를 함께 기록합니다.

## 현재 진행 상태

```text
1단계 정적 화면 구현: 완료
2단계 mock data 연결: 완료
3단계 오늘 수업 생성 로직: 완료
4단계 강의별 간단 체크 반영: 완료
5단계 내부 다음 수업 조율 및 진행 보고: 완료
6단계 학생 요구사항 반영: 완료
7단계 AI 담임 코멘트 개선: 완료
8단계 PostgreSQL 영속화: 기반 구현 완료, 화면 조회 통합 예정
9단계 LLM API 연결: 미진행
```

## 다음 데모 보완 방향

현재 데모의 다음 보완은 실제 LLM 또는 전체 일정 최적화 알고리즘을 바로 구현하는 일이 아닙니다.
먼저 학생 요청을 채팅 안으로 통합하고, AI 담임이 내부 조율 결과를 바탕으로 편성안을 먼저 제안하는 mock 흐름을 구성합니다.

```text
사용자 화면의 요구사항 반영 카드 제거
채팅 입력을 통한 시간 제한·복습 선호·새 진도 축소 요청
mock AI의 조정 수업안 제안과 사용자 확인 질문
사용자 추가 의견에 따른 mock 편성안 수정 또는 확정
```

전체 커리큘럼 조율 알고리즘은 목표일, 날짜별 가능 시간, 남은 수업량 같은 데이터 모델을 정의한 뒤 후속 단계에서 구현합니다.
자세한 방향은 `docs/curriculum-adjustment-design.md`를 기준으로 합니다.

## 1단계. 정적 화면 구현

상태: 완료

목표:

```text
AI 담임 서비스 데모의 핵심 화면을 정적으로 확인한다.
```

만들 화면:

```text
커리큘럼 선택
AI 담임 홈
오늘 수업 세션
강의별 간단 체크
오늘의 학습 진행 보고
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

상태: 완료

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

상태: 완료

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

## 4단계. 강의별 간단 체크 반영

상태: 완료

목표:

```text
강의 종료 직후의 이해도·집중도만 학생 상태와 다음 수업 조율에 반영한다.
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
낮은 이해도는 해당 강의의 개념 태그를 보강 후보에 추가한다.
상세 설문과 확인 문제 입력은 초기 데모에서 받지 않는다.
```

완료 기준:

```text
강의별 간단 체크 결과가 다음 수업 조율의 내부 입력으로 사용된다.
```

## 5단계. 다음 수업 조율

상태: 완료

목표:

```text
다음 수업을 내부 조율하고 학생에게는 간단한 진행 보고만 보여준다.
```

예상 파일:

```text
src/features/progress-orchestrator/adjustment.service.ts
```

완료 기준:

```text
완료 강의, 이해도·집중도, 내부 반영 안내가 읽기 전용 화면에 표시된다.
```

## 6단계. 학생 요구사항 반영

상태: 완료

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

상태: 완료

목표:

```text
조율 결과를 학생에게 부드럽고 명확하게 설명한다.
```

완료 기준:

```text
AI 담임 코멘트가 조율 이유, 현재 상태, 다음 행동을 함께 설명한다.
비난하는 표현 없이 복구 계획을 제시한다.
```

## 8단계. PostgreSQL 영속화

상태: 기반 구현 완료, 화면 조회 통합 진행 전

완료된 범위:

```text
강좌·강의와 학생 진도 상태 저장
피드백·조율 제안 저장
학생별 커리큘럼과 불변 버전 저장
학생·과목별 활성 커리큘럼 원자적 선택
sourceId와 화면 메타데이터를 포함한 현재 버전 읽기 모델
```

다음 완료 기준:

```text
오늘 수업·커리큘럼 맵·강의 상세가 활성 DB 버전을 단일 원천으로 사용한다.
새로고침과 서버 재시작 뒤에도 같은 학습 화면을 복원한다.
DB 오류가 메모리 데이터로 조용히 대체되지 않는다.
```

## 9단계. LLM API 연결

상태: 미진행

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

## 데모 마감 전 추가 확인 항목

```text
AI 담임 말풍선 안에 현재 상황에 맞는 카드가 첨부되는지 확인한다.
우측 상단 개발용 단계 이동 컨트롤로 AI 답변에 첨부될 카드를 강제로 바꿀 수 있는지 확인한다.
localStorage 저장값은 데모용 임시 상태로만 사용한다.
README의 현재 구현 상태와 실제 화면 흐름이 맞는지 확인한다.
.gitignore가 환경 변수, 비밀 문서, 로그, 빌드 산출물을 제외하는지 확인한다.
pnpm build가 통과하는지 확인한다.
```

## 초기 데모에서 하지 않는 일

```text
LLM API 연결
로그인 구현
관리자 페이지 설계
실제 영상 스트리밍 설계
```
