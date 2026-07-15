# 프로젝트 구조 설계

## 구조 설계 원칙

이 프로젝트는 완성형 서비스가 아니라 AI 담임 서비스의 검증용 데모입니다.
따라서 폴더 구조는 기능을 넓게 확장하기보다, 데모의 핵심 경험을 빠르게 구현하고 검증할 수 있도록 나눕니다.

핵심 기준은 다음과 같습니다.

```text
1. 커리큘럼 선택과 오늘 수업 편성을 분리한다.
2. 진도 조율 로직은 화면 코드와 분리한다.
3. 학습 후 체크 분석은 별도 모듈로 둔다.
4. AI 담임 문장은 규칙 기반 결과를 설명하는 계층으로 둔다.
5. 초기에는 mock data와 localStorage 중심으로 단순하게 유지한다.
```

## 제안 폴더 트리

아래 트리는 향후 구현 시 기준으로 삼을 구조입니다.
현재는 폴더 일부만 먼저 만들어 두었고, 실제 파일은 구현 단계에서 생성합니다.

```text
AI_Homeroom_Teacher/
  README.md
  AGENTS.md
  apps/
    api/
      src/
        app.ts
        config.ts
        server.ts
        mock/
          teacher.mock.ts
  docs/
    README.md
    project-structure.md
    demo-flow.md
    domain-model.md
    curriculum-adjustment-design.md
    implementation-roadmap.md
    backend-api-foundation.md
    backend-development-brief.md
    claims/
      lesson-feedback-proxy-issue.md
    prompts/
      backend-development-session.md
  public/
  src/
    app/
      App.tsx
      main.tsx
      app.css
      demo-flow.types.ts
      demo-storage.ts
    components/
      ai-teacher/
        TeacherComment.tsx
      curriculum/
        CurriculumCard.tsx
        CurriculumMap.tsx
      lesson/
        TodaySessionCard.tsx
        LessonItemList.tsx
      feedback/
        LearningCheckForm.tsx
      layout/
        AppShell.tsx
    features/
      curriculum/
        curriculum.data.ts
        curriculum.service.ts
        curriculum.types.ts
      progress-orchestrator/
        orchestrator.rules.ts
        orchestrator.service.ts
        session-builder.ts
        adjustment.service.ts
        progress.types.ts
      learning-check/
        learning-check.service.ts
        learning-check.types.ts
      teacher-response/
        teacher-response.mock.ts
        teacher-response.service.ts
        teacher-response.types.ts
    mock/
      demo-student.data.ts
      demo-session.data.ts
    storage/
      local-storage.repository.ts
    types/
      shared.types.ts
    utils/
      date.ts
      format.ts
```

## 루트 폴더

| 경로 | 역할 |
| --- | --- |
| `README.md` | 프로젝트 목표, 데모 범위, 실행 방법, 현재 구현 상태를 설명합니다. |
| `AGENTS.md` | 에이전트 작업 지침을 관리합니다. 프로젝트 지침이 바뀔 때만 수정합니다. |
| `docs/` | 구현 전 설계 문서와 이후 개발 참고 문서를 관리합니다. |
| `public/` | 정적 이미지, 아이콘, 데모용 공개 자산을 둡니다. |
| `src/` | 실제 애플리케이션 코드를 둡니다. |
| `apps/api/` | 프론트엔드와 분리된 HTTP API 서버를 둡니다. 초기에는 mock 데이터를 반환하고, 이후 인증·DB·LLM 오케스트레이터를 추가합니다. |

## `src/app`

앱의 진입점과 전역 조립을 담당합니다.

예상 파일은 다음과 같습니다.

| 파일 | 역할 |
| --- | --- |
| `main.tsx` | 앱 렌더링 진입점입니다. |
| `App.tsx` | 채팅 앱 기반 데모 흐름과 AI 답변 첨부 카드를 조립합니다. |
| `demo-flow.types.ts` | 데모 단계 타입을 정의합니다. |
| `demo-storage.ts` | 데모용 localStorage 임시 저장과 복원을 담당합니다. |
| `routes.tsx` | 화면 단위 라우팅이 필요할 때 사용합니다. 초기 데모에서는 생략할 수 있습니다. |
| `app.css` | 전역 스타일 또는 앱 레벨 스타일을 둡니다. |

초기 데모에서는 복잡한 라우팅보다 단일 페이지의 단계 상태 전환을 우선합니다.

## `src/components`

화면에 보이는 UI 컴포넌트를 둡니다.
비즈니스 판단은 가능한 한 `features/`에 두고, 컴포넌트는 전달받은 상태를 보여주는 역할에 집중합니다.

예상 하위 폴더는 다음과 같습니다.

| 경로 | 역할 |
| --- | --- |
| `components/ai-teacher/` | AI 담임 코멘트, 조율 이유, 안내 문구 UI를 둡니다. |
| `components/curriculum/` | 커리큘럼 카드와 커리큘럼 맵 UI를 둡니다. |
| `components/lesson/` | 오늘 수업 카드, 수업 항목 목록, 시간 안내 UI를 둡니다. |
| `components/feedback/` | 학습 후 체크 입력 UI를 둡니다. |
| `components/layout/` | 앱 레이아웃, 상단 바, 화면 컨테이너를 둡니다. |

## `src/features`

데모의 핵심 기능 단위를 둡니다.
이 폴더는 화면보다 도메인 역할을 기준으로 나눕니다.

### `features/curriculum`

사전 정의 커리큘럼을 관리합니다.

책임:

```text
커리큘럼 목록 반환
선택된 커리큘럼 조회
현재 단계 조회
다음 단계 조회
커리큘럼 맵 표시용 상태 계산
```

### `features/progress-orchestrator`

프로젝트의 핵심 모듈입니다.
개발용 명칭은 `Adaptive Progress Orchestrator`입니다.

책임:

```text
오늘 수업 생성
학생 요구사항 반영
수업량 조절
진도 밀림 반영
보강 삽입
복구 계획 생성
다음 수업 조율
```

이 모듈은 LLM이 아니라 규칙 기반 로직을 우선합니다.

### `features/learning-check`

학습 후 체크 결과를 분석합니다.

책임:

```text
이해도 분석
집중도 분석
헷갈린 개념 분석
확인 문제 결과 분석
보강 필요 여부 판단
```

### `features/teacher-response`

AI 담임의 문장 생성을 담당합니다.
초기에는 mock response를 사용하고, 나중에 LLM API를 연결할 수 있도록 분리합니다.

책임:

```text
AI 담임 코멘트 생성
학생 요구사항 해석
조율 이유 설명
학생 친화적 피드백 생성
```

## `src/mock`

초기 데모 데이터를 둡니다.

예상 데이터:

```text
사전 정의 커리큘럼
데모 학생 상태
이전 학습 결과
강의/보강/문제 카드
오늘 수업 예시
```

## `src/storage`

초기에는 서버와 DB를 두지 않고 localStorage를 우선 사용합니다.

예상 책임:

```text
선택된 커리큘럼 저장
학생 진행 상태 저장
학습 후 체크 결과 저장
다음 수업 조율 결과 저장
```

## `src/types`

여러 기능에서 공유하는 타입을 둡니다.
특정 기능에만 쓰는 타입은 각 `features/*/*.types.ts`에 둡니다.

## `src/utils`

날짜, 시간, 표시 형식처럼 도메인 판단이 아닌 공통 유틸리티를 둡니다.

## 구현 시 피해야 할 구조

초기 데모에서는 다음 구조를 만들지 않습니다.

```text
auth/
billing/
admin/
rag/
vector-db/
parent-report/
streaming/
```

위 기능은 현재 데모 목표와 직접 관련이 없으므로, 필요하더라도 데모 검증 이후로 미룹니다.
