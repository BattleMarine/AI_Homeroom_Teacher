# 커리큘럼 조율 백엔드 전권 이전 계획

## 문서 목적

현재 프론트엔드와 백엔드에 나뉘어 있는 커리큘럼·오늘 수업 조율 책임을 백엔드로 일원화하기 위한 수정 범위와 전환 순서를 정의한다.

목표는 다음과 같다.

> 프론트엔드는 학생의 입력을 전달하고 백엔드가 반환한 학습 상태를 표시한다. 커리큘럼 선택, 오늘 수업 편성, 수업량 조절, 보강·연기, 전체 일정 영향 판단은 모두 백엔드가 결정한다.

이 문서는 백엔드 전권 이전 당시의 설계 기록입니다. 해당 책임 이전은 완료되었고, 이후 PostgreSQL 저장소와 학생별 커리큘럼 버전까지 도입되었습니다. 현재 후속 작업은 활성 DB 버전을 모든 학습 화면 조회의 단일 원천으로 연결하는 것이며, 인증과 실제 LLM은 아직 범위 밖입니다.

## 결론과 예상 수정 규모

이 작업은 **중간 이상 규모의 경계 리팩터링**이다. 화면을 새로 만드는 작업은 아니지만, 프론트에 남은 규칙 기반 계산을 제거하고 백엔드의 오늘 수업 조율과 전체 커리큘럼 도구를 하나의 상태 흐름으로 통합해야 한다.

| 구분 | 최소 전환 | 권장 전환 |
| --- | --- | --- |
| 목표 | `오늘 시간이 부족해요` 흐름만 백엔드 전용으로 변경 | 모든 커리큘럼·진도 판단을 백엔드 전권으로 변경 |
| 프론트 수정 | 핵심 2~3개 파일 | 핵심 3~5개 파일, 로컬 규칙 모듈 5~7개 제거 또는 미사용 전환 |
| 백엔드 수정 | 핵심 2~4개 파일 | 핵심 7~10개 파일, 조율 오케스트레이터 1개 모듈 추가 권장 |
| 테스트 | 대화·확정 흐름 3~5개 | API·도구·상태 일관성 10~15개 시나리오 |
| 난이도 | 중간 | 중간 이상 |
| 주요 위험 | 프론트 fallback이 계속 계산함 | 오늘 수업 조율과 전체 계획 조율의 경계 혼동 |

권장안은 두 단계로 나눠 진행한다. 먼저 프론트의 계산을 제거해 백엔드를 단일 권위로 만든 뒤, 전체 커리큘럼 알고리즘과 오늘 수업 조율을 백엔드 내부에서 통합한다.

## 현재 구조 진단

### 프론트엔드에 남은 판단

`src/app/App.tsx`는 API 응답을 사용하면서도 다음 로컬 계산을 함께 수행한다.

```text
createDemoSessionData로 학생·커리큘럼 예시 상태 생성
generateTodaySession으로 오늘 수업 생성
applyStudentRequestToProgress로 시간 부족·복습 요청 계산
studentRequestKind로 조정 상태 유지
selectedCurriculumId와 일부 진행 상태를 localStorage에 저장
API 요청 전에 조정된 오늘 수업 요약을 미리 계산
```

따라서 같은 학생 요청에 대해 프론트 규칙 결과와 백엔드 규칙 결과가 동시에 존재한다. 두 구현이 달라지면 카드, 진행 보고, 커리큘럼 맵이 서로 다른 상태를 표시할 수 있다.

### 백엔드의 두 조율 체계

현재 백엔드에는 서로 다른 두 경로가 있다.

| 경로 | 현재 역할 | 현재 한계 |
| --- | --- | --- |
| `progressService.createAdjustmentProposal` | 시간 부족·복습 요청으로 오늘 세션 제안 | 전체 커리큘럼 추천 도구와 직접 연결되지 않음 |
| `/api/curriculum-recommendations` | 카탈로그 기반 전체 학습 경로 계산 | 프론트가 호출하지 않으며 학생 상태에 자동 적용되지 않음 |
| `/api/curriculum-tools/execute` | 계획 생성·압축·연장·기한 평가·적용 | 압축형·연장형도 현재 기준 계획과 동일 |
| `/api/session-adjustments/:id/confirm` | 오늘 수업 제안을 학생 상태에 확정 | 변경 범위와 전체 일정 영향이 명시되지 않음 |

대화 응답의 `requestedTools: ["adjust_curriculum"]`은 도구 요청처럼 보이지만, 실제 제안은 범용 커리큘럼 도구 실행기가 아니라 `progressService.createAdjustmentProposal`이 직접 만든다.

## 목표 책임 경계

### 프론트엔드

```text
학생 입력과 확인 의사 전달
로딩·오류·재시도 상태 표시
백엔드 snapshot 렌더링
대화 메시지와 UI 전용 상태 유지
강의 재생과 화면 상호작용 처리
```

프론트엔드가 하지 않을 일:

```text
오늘 수업 생성
시간 제한에 따른 항목 제외·이월
커리큘럼 단계 선택
취약 개념에 따른 보강 삽입
다음 추천 강의 계산
목표일까지의 가능 여부 판단
API 실패 시 로컬 규칙으로 학습 계획 대체
```

### 백엔드

```text
선택된 커리큘럼과 적용 계획 관리
학생 상태·완료 이력·취약 개념 관리
오늘 수업 생성과 다음 추천 계산
학생 요청 해석 결과를 조율 명령으로 변환
오늘 수업 조정과 전체 계획 영향 평가
조율 제안 생성·확정·폐기
학습 피드백 반영과 후속 세션 재계산
일관된 snapshot 반환
```

## 도구 이름과 범위 정리

현재 `adjust_curriculum`은 오늘 수업 변경과 전체 커리큘럼 변경을 모두 떠올리게 하므로 경계가 모호하다. 다음처럼 분리하는 것을 권장한다.

| 도구 | 책임 |
| --- | --- |
| `adjust_today_session` | 오늘 가능 시간, 복습 우선, 새 강의 축소 반영 |
| `create_curriculum_plan` | 카탈로그와 학생 조건으로 전체 계획 생성 |
| `compress_curriculum_plan` | 목표일까지 맞추기 위한 전체 계획 압축 제안 |
| `extend_curriculum_plan` | 하루 부담 완화를 위한 전체 계획 연장 제안 |
| `assess_schedule_impact` | 오늘 변경이 목표일과 이후 일정에 미치는 영향 계산 |
| `insert_remediation` | 취약 개념 보강 항목 삽입 |
| `defer_learning_item` | 미완료 또는 선택 항목을 이후 세션으로 이동 |
| `apply_curriculum_plan` | 확인된 전체 계획을 학생 상태에 적용 |

기존 `adjust_curriculum`은 전환 기간에만 `adjust_today_session`의 호환 별칭으로 유지하고 문서와 응답에서 점진적으로 제거한다.

## 권장 API 상태 계약

모든 상태 변경 API는 같은 형태의 최신 snapshot을 반환해야 한다.

```ts
type LearningSnapshot = {
  revision: number;
  studentContext: ApiStudentContext;
  curriculumPlan: ApiCurriculumPlan;
  todaySession: ApiTodaySession;
  curriculumMap: ApiCurriculumMap;
  progress: ApiTodaySessionProgress;
};
```

`revision`은 프론트가 오래된 응답으로 최신 상태를 덮어쓰는 것을 방지한다. mock 단계에서는 학생별 정수 증가값이면 충분하다.

상태 변경 API:

```text
POST /api/student-context/curriculum
POST /api/session-adjustments/:adjustmentId/confirm
POST /api/lesson-feedback
POST /api/curriculum-tools/execute 중 apply 계열
```

위 API는 가능한 한 모두 `LearningSnapshot`을 포함한다. 프론트는 응답을 받은 뒤 별도의 로컬 재계산 없이 snapshot 전체를 교체한다.

## 조율 제안 계약 보강

오늘 수업 조정과 전체 계획 조정을 구분할 수 있도록 제안에 범위를 추가한다.

```ts
type AdjustmentProposal = {
  adjustmentId: string;
  scope: "today-session" | "curriculum-plan";
  interpretedRequest: {
    conditionKinds: string[];
    maxSessionMinutes: number | null;
    targetDays: number | null;
  };
  before: AdjustmentSummary;
  after: AdjustmentSummary;
  scheduleImpact: {
    targetAchievable: boolean | null;
    minimumRequiredDays: number | null;
    deferredItemCount: number;
  };
  reasonCodes: string[];
  requiresConfirmation: true;
};
```

`오늘 시간이 부족해요`는 기본적으로 `scope: "today-session"`이다. 다만 항목 이월로 목표일 위험이 생기면 백엔드가 `assess_schedule_impact`를 실행하고, 전체 계획 변경이 필요하다는 후속 제안을 만들 수 있다.

## 프론트엔드 수정 범위

### 1. `src/app/App.tsx`

가장 큰 수정 지점이다.

제거 또는 변경할 내용:

```text
createDemoSessionData 호출 제거
generateTodaySession 호출 제거
applyStudentRequestToProgress 호출 제거
로컬 adjustedTodaySession 생성 제거
studentRequestKind를 도메인 계산 입력으로 사용하는 코드 제거
API 응답과 로컬 계산을 합치는 useMemo 제거
커리큘럼 선택 직후 로컬 오늘 수업 생성 제거
시간 부족 버튼은 메시지 API만 호출하도록 단순화
조율 확정 뒤 snapshot 전체 교체
API 실패 시 로컬 수업안 대신 오류·재시도 표시
```

UI 선택 강조가 필요하면 `studentRequestKind` 대신 마지막 요청 또는 서버 응답의 `conditionKinds`를 표시 전용으로 사용한다.

### 2. `src/api/teacher-api.ts`

```text
LearningSnapshot 타입 추가
AdjustmentProposal.scope·scheduleImpact 타입 추가
상태 변경 API 응답 타입 통일
필요 시 현재 snapshot 조회 함수 추가
커리큘럼 도구 결과 타입 추가
```

프론트에서 `/api/curriculum-recommendations`를 직접 호출하지 않는 것을 권장한다. 대화나 명시적 사용자 행동을 백엔드 명령 API에 전달하고, 백엔드 오케스트레이터가 필요한 알고리즘을 선택한다.

### 3. `src/app/demo-storage.ts`

백엔드 전권 이후 `localStorage`에서 제거할 후보:

```text
selectedCurriculumId
studentRequestKind
강의 완료와 학습 피드백
오늘 수업과 커리큘럼 진행 상태
```

남겨도 되는 값:

```text
현재 열려 있는 화면
접힌 UI 영역
개발용 단계 표시
민감하지 않은 대화 UI 편의 상태
```

### 4. 프론트 로컬 도메인 모듈

다음 모듈은 즉시 삭제하기보다 참조를 먼저 제거하고, 검색으로 미사용을 확인한 뒤 제거한다.

```text
src/features/progress-orchestrator/session-builder.ts
src/features/progress-orchestrator/student-request.rules.ts
src/features/progress-orchestrator/orchestrator.rules.ts
src/features/progress-orchestrator/next-session-builder.ts
src/mock/demo-session.data.ts
```

타입과 표시용 변환 함수는 API 타입 또는 UI mapper로 옮길 수 있다.

## 백엔드 수정 범위

### 1. 조율 오케스트레이터 추가

권장 위치:

```text
apps/api/src/orchestration/
  curriculum-orchestrator.service.ts
  curriculum-orchestrator.types.ts
```

책임:

```text
학생 요청의 구조화된 조건 수신
오늘 수업 조정인지 전체 계획 조정인지 판별
progress 서비스와 curriculum tool 호출
목표일 영향 평가
before/after 제안 생성
확정 전 상태 비변경 보장
```

HTTP 핸들러나 LLM 어댑터가 직접 여러 서비스를 조합하지 않도록 한다.

### 2. `progress` 상태 모델 통합

현재 `contexts`, `appliedCurriculums`, `remediationItems`, `adjustmentProposals`로 나뉜 학생별 상태를 하나의 저장소 인터페이스 뒤로 모은다.

```ts
type StudentLearningState = {
  revision: number;
  context: StudentContext;
  appliedPlan: CurriculumDefinition;
  remediationItems: LessonItem[];
  pendingAdjustments: AdjustmentProposal[];
};
```

mock 단계에서는 메모리 Map을 유지하되, 이후 DB 저장소로 교체할 수 있도록 서비스가 Map을 직접 여러 개 소유하지 않게 한다.

### 3. 커리큘럼 도구 실제 정책 구현

현재 `stable`, `compressed`, `practice` 요청은 모두 `appliedPlanProfile: "baseline"`을 반환한다. 백엔드 전권을 선언하려면 적어도 다음 차이가 실제 계획에 반영되어야 한다.

```text
stable: 원본 순서와 필수 강의를 유지하고 하루 부담을 안정적으로 배분
compressed: 선택 가능 항목 통합 또는 축소, 목표일 위험 계산
practice: 문제·적용 강의 우선 신호와 개념 보강 조건 반영
```

카탈로그에 필수/선택·난이도 메타데이터가 부족한 동안에는 임의 삭제하지 않고, `policy_not_applied` 사유 코드로 한계를 명시한다.

### 4. 오늘 수업과 전체 계획 연결

`apply_curriculum_plan` 이후 `getTodaySession`, 커리큘럼 맵, 진행 보고가 모두 같은 적용 계획을 읽어야 한다. 오늘 시간 제한으로 이월된 항목도 전체 계획에서 사라지지 않고 다음 세션 또는 복구 후보로 남아야 한다.

### 5. 대화 API 정리

현재 대화 라우트가 `createAdjustmentProposal`과 도구 실행을 각각 호출하는 구조를 오케스트레이터 한 번 호출로 변경한다.

```text
현재: 진행 조율 제안 생성 + LLM 응답 + 일부 커리큘럼 도구 별도 실행
목표: 요청 해석 → 오케스트레이터 실행 → 구조화 결과 → LLM 설명
```

LLM이 선택한 도구 이름은 참고 입력이며, 상태 변경은 검증된 백엔드 명령과 학생 확인을 거쳐야 한다.

### 6. 확정 처리

```text
adjustmentId와 studentId 일치 확인
이미 확정·폐기된 제안 재사용 방지
제안 생성 당시 revision과 현재 revision 비교
한 번의 상태 변경으로 계획·세션·맵·진행 보고 갱신
최신 LearningSnapshot 반환
```

## 테스트 범위

### 백엔드 필수 시나리오

```text
커리큘럼 선택 뒤 snapshot의 모든 영역이 같은 planId/revision을 가진다.
시간 부족 요청은 확정 전 서버 상태를 변경하지 않는다.
확정 후 오늘 수업 시간이 제한값 이하가 된다.
이월 항목은 전체 계획에서 사라지지 않는다.
전체 압축 요청은 curriculum-plan 범위 제안을 반환한다.
목표일 위험이 있으면 scheduleImpact에 사실대로 표시된다.
낮은 이해도는 보강 신호와 다음 snapshot에 반영된다.
오래된 revision의 제안 확정은 충돌로 거절된다.
같은 adjustmentId의 중복 확정은 거절된다.
API 재시작 전까지 학생별 상태가 서로 섞이지 않는다.
```

### 프론트엔드 필수 시나리오

```text
API 호출 전 오늘 수업 카드가 로컬 계산으로 바뀌지 않는다.
제안 응답은 읽기 전용으로 표시된다.
확정 응답의 snapshot으로 화면 전체가 갱신된다.
API 실패 시 이전 서버 snapshot을 유지하고 오류를 표시한다.
새로고침 후 서버 snapshot을 다시 조회한다.
localStorage를 삭제해도 서버의 학습 계획은 유지된다.
```

## 단계별 이전 계획

### 1단계: 프론트 로컬 판단 차단

```text
시간 부족·복습 요청에서 로컬 계산 제거
커리큘럼 선택 뒤 API snapshot만 사용
API 실패 fallback을 오류·재시도로 변경
```

완료 기준: 같은 학생 상태에서 화면의 오늘 수업이 항상 백엔드 응답과 일치한다.

### 2단계: 백엔드 snapshot 통일

```text
LearningSnapshot 도입
선택·확정·피드백 응답 통일
revision과 제안 충돌 검사 추가
```

완료 기준: 프론트가 상태 변경 후 추가 계산이나 여러 GET 조합 없이 한 응답으로 갱신된다.

### 3단계: 조율 도구 통합

```text
adjust_today_session과 curriculum-plan 도구 분리
오케스트레이터 도입
오늘 변경의 일정 영향 평가
```

완료 기준: 대화 API가 요청에 맞는 백엔드 도구를 실행하고, 제안 범위와 이유를 구조화해 반환한다.

### 4단계: 로컬 규칙 제거

```text
미사용 프론트 progress-orchestrator 구현 삭제
커리큘럼 관련 localStorage 제거
문서와 타입 정리
```

완료 기준: `src/`에서 오늘 수업 또는 커리큘럼을 계산하는 도메인 함수 호출이 없다.

## 권장 작업 단위

한 번에 전부 수정하지 않고 다음 작업으로 나누는 것이 안전하다.

1. `[프론트] 시간 부족 요청의 로컬 계산 제거`
2. `[백엔드] LearningSnapshot 응답 계약 도입`
3. `[프론트] 상태 변경 응답을 snapshot으로 통일`
4. `[백엔드] 오늘 수업·전체 커리큘럼 조율 도구 분리`
5. `[백엔드] 일정 영향 평가와 revision 충돌 검사 추가`
6. `[프론트] 커리큘럼 관련 localStorage와 미사용 규칙 제거`
7. `[통합] 조율 시나리오와 문서 최종 검증`

## 이번 전환에서 하지 않을 일

```text
DB와 인증 도입
실제 LLM 연결
실제 영상 플랫폼 연동
정교한 일정 최적화
메타데이터 근거 없는 강의 자동 삭제
프론트 화면 전면 재설계
```

## 최종 완료 기준

```text
프론트는 커리큘럼·오늘 수업을 계산하지 않는다.
백엔드가 학생별 단일 학습 상태를 관리한다.
모든 상태 변경은 백엔드 제안과 확인 절차를 거친다.
오늘 수업 조정과 전체 계획 조정의 범위가 구분된다.
이월·보강 항목이 전체 계획에서 유실되지 않는다.
API 실패가 프론트 로컬 fallback으로 숨겨지지 않는다.
새로고침 후 서버 snapshot만으로 같은 화면을 복원할 수 있다.
프론트와 백엔드 테스트가 같은 API 계약을 검증한다.
```
