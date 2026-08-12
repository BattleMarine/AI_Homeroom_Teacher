# LLM 연결 전 준비 체크리스트

## 문서 목적

이 문서는 실제 LLM 공급자를 연결하기 전에 프론트엔드, 백엔드 API, 규칙 기반 진도 운영 엔진과 도구 호출 경계를 어느 수준까지 안정화해야 하는지 정의한다.

핵심 목표는 다음과 같다.

> LLM 연결 뒤 문제가 발생했을 때 모델의 요청 해석 문제와 백엔드 도구·상태·화면 연결 문제를 분리해서 진단할 수 있어야 한다.

LLM은 커리큘럼과 진도를 직접 변경하는 주체가 아니다. 학생의 자연어 요청을 구조화하고, 검증된 백엔드 도구를 선택하며, 규칙 엔진의 결과를 학생에게 설명하는 역할만 담당한다.

## 현재 준비 상태

| 영역 | 현재 상태 | LLM 연결 전 판단 |
| --- | --- | --- |
| 프론트 API 전환 | 백엔드 응답 중심으로 전환됨 | 통합 시나리오 재검증 필요 |
| 추천 학습 항목 실행 계약 | `nextRecommendedItem`, `action`, `playbackAvailable` 구현됨 | 종류별 화면 동작 재검증 필요 |
| 백엔드 상태 snapshot | `LearningSnapshot` 생성과 일부 응답 적용 | 모든 상태 변경 API의 응답 통일 확인 필요 |
| 상태 revision | 학생별 revision 존재 | 조율 제안 생성·확정 간 충돌 검증 필요 |
| 커리큘럼 도구 | 생성·압축·연장·기한 평가·적용 도구 존재 | 압축·연장 정책은 아직 기준 계획과 동일 |
| 진도 운영 도구 | 보강·연기·일정 영향 도구 존재 | 대화 API와 조율 제안 경계 통합 필요 |
| 대화 API | mock LLM 어댑터와 도구 요청 응답 존재 | `adjust_curriculum` 명칭과 실행 경로 정리 필요 |
| 저장소 | 학생별 서버 메모리 상태 | 데모에는 허용, 실제 사용자 테스트 전 DB 판단 필요 |
| 인증 | 미구현 | 다중 사용자 테스트 전 필요 |
| 실제 LLM | 미연결 | 아래 필수 조건 완료 후 시작 |

현재는 LLM 연결 직전 단계에 가깝지만, 바로 쓰기 가능한 도구를 모델에 열기보다 백엔드 상태 변경 계약과 통합 테스트를 먼저 고정하는 편이 안전하다.

## 우선순위 요약

### P0: LLM 연결 전에 반드시 완료

```text
추천 항목 종류별 실행 흐름 통합 검증
모든 상태 변경 API의 snapshot 계약 통일
오늘 수업 조정과 전체 커리큘럼 조정 도구 분리
조율 제안의 revision 충돌·중복 확정 방지
핵심 사용자 시나리오 자동화
도구 호출과 상태 변경 관측 로그 추가
```

### P1: 실제 사용자 또는 외부 배포 전에 완료

```text
DB 저장소와 상태 복구
인증과 학생 식별
요청 제한과 비용 보호
대화·학습 데이터 보존 정책
운영 환경 오류 추적
```

데모 내부에서 LLM 연결만 검증한다면 P1을 미룰 수 있다. 외부 사용자가 접근하거나 여러 학생 상태를 동시에 다룬다면 DB와 인증을 LLM보다 먼저 도입한다.

## 1. 추천 학습 항목 실행 계약 재검증

현재 백엔드는 다음 추천 항목에 실행 방식을 포함한다.

```text
lecture -> play-lesson
review -> open-review
practice -> start-practice
check -> start-check
```

LLM 연결 전 확인할 항목:

```text
play-lesson은 playbackAvailable: true와 함께만 반환된다.
review, practice, check는 영상 자동 재생 대상이 아니다.
프론트 버튼 문구와 동작이 action을 기준으로 결정된다.
지원하지 않는 action은 무반응 대신 명시적 오류를 표시한다.
추천 항목이 null이면 완료 상태를 표시한다.
```

완료 기준:

> 추천 알고리즘이 어떤 종류의 항목을 반환하더라도 프론트가 해당 항목을 영상으로 오인하지 않고 정의된 행동을 수행한다.

## 2. 백엔드 상태 snapshot 통일

프론트는 상태 변경 결과를 로컬에서 다시 계산하지 않고 백엔드가 반환한 snapshot으로 교체해야 한다.

권장 공통 계약:

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

확인할 상태 변경 API:

```text
커리큘럼 선택
커리큘럼 계획 적용
오늘 수업 조율 확정
보강 항목 삽입
수업 항목 연기
강의별 피드백 기록
```

각 API는 가능한 한 같은 snapshot 구조를 반환한다. 프론트가 변경 직후 여러 GET 요청을 조합하거나 이전 응답과 수동 병합하지 않도록 한다.

완료 기준:

```text
상태 변경 한 번에 revision이 한 번 증가한다.
snapshot의 수업·맵·진행 보고가 같은 revision을 나타낸다.
새로고침 후 서버 snapshot만으로 동일한 학습 화면을 복원한다.
API 실패 시 마지막 정상 snapshot을 유지한다.
```

## 3. 오늘 수업 조정과 전체 계획 조정 분리

현재 `adjust_curriculum`은 오늘 수업량 조절과 전체 커리큘럼 변경을 모두 떠올리게 하므로 LLM 도구 이름으로 사용하기에 모호하다.

권장 분리:

| 도구 | 책임 |
| --- | --- |
| `adjust_today_session` | 오늘 가능 시간·복습 우선·새 강의 축소 반영 |
| `create_curriculum_plan` | 전체 학습 계획 생성 |
| `compress_curriculum_plan` | 목표일에 맞춘 압축 계획 제안 |
| `extend_curriculum_plan` | 하루 부담을 낮춘 연장 계획 제안 |
| `assess_schedule_impact` | 오늘 변경이 이후 일정에 미치는 영향 계산 |
| `insert_remediation` | 취약 개념 보강 삽입 |
| `defer_learning_item` | 특정 학습 항목을 이후 세션으로 이동 |
| `apply_curriculum_plan` | 학생이 확인한 전체 계획 적용 |

`오늘 시간이 부족해요`는 기본적으로 `adjust_today_session`을 사용한다. 오늘 항목 이월이 목표일에 영향을 줄 수 있을 때만 `assess_schedule_impact`를 추가로 호출한다.

완료 기준:

```text
각 도구의 입력·출력 JSON 스키마가 문서와 코드에 고정된다.
읽기 도구와 상태 변경 도구가 구분된다.
상태 변경 도구는 학생 확인 없이 확정되지 않는다.
지원하지 않는 입력은 규칙 엔진이 검증 오류로 거절한다.
```

## 4. 커리큘럼 정책의 실제 동작 확인

현재 커리큘럼 도구는 `stable`, `compressed`, `practice` 요청을 보존하지만 실제 적용 결과는 기준 계획과 같을 수 있다.

LLM을 연결하기 전에 다음 중 하나를 선택한다.

### 선택 A: 정책 구현

```text
stable: 원본 순서와 필수 항목 유지, 하루 부담 안정화
compressed: 선택 가능 항목 통합과 목표일 위험 계산
practice: 문제·적용 항목 우선 신호와 개념 보강 조건 반영
```

### 선택 B: 기능 제한 명시

메타데이터가 부족해 정책을 구현하지 않는다면 도구가 성공한 것처럼 설명하지 않는다.

```text
appliedPlanProfile: baseline
reasonCodes: policy_not_applied
teacherSummary: 현재 데이터로는 안전한 압축 기준을 적용할 수 없음
```

완료 기준:

> 도구 결과와 AI 담임 설명이 실제 적용된 정책을 과장하지 않는다.

## 5. 조율 제안 무결성 보강

학생 확인이 필요한 모든 변경은 제안과 확정을 분리한다.

```text
요청 해석
→ 현재 revision 기준 조율안 계산
→ before/after와 이유 반환
→ 학생 확인
→ revision 재검증
→ 한 번만 적용
→ 최신 snapshot 반환
```

필수 방어 조건:

```text
adjustmentId와 studentId 일치 확인
제안 생성 당시 revision 저장
확정 시 현재 revision과 비교
이미 확정·폐기된 adjustmentId 재사용 방지
확정 전 서버 상태 비변경
부분 적용 실패 시 이전 상태 유지
```

충돌 응답은 일반적인 내부 오류와 구분한다. mock 단계에서는 `409`와 새 snapshot 재조회 안내로 충분하다.

## 6. 핵심 사용자 시나리오 자동화

LLM 없이 아래 시나리오가 모두 결정적으로 통과해야 한다.

### 기본 수업 흐름

```text
안정형 선택
→ 오늘 수업 생성
→ lecture 재생
→ 피드백 기록
→ 다음 추천 항목 갱신
```

### 시간 부족 조율

```text
오늘 시간이 부족하다고 요청
→ 25분 이내 조정안 제안
→ 확정 전 상태 불변
→ 확정 후 수업량 변경
→ 이월 항목 보존
```

### 낮은 이해도 보강

```text
낮은 이해도 제출
→ 취약 개념 반영
→ 보강 항목 삽입
→ open-review action 반환
→ 영상 자동 재생하지 않음
```

### 전체 계획 조정

```text
목표일 또는 압축 요청
→ 일정 영향 평가
→ curriculum-plan 범위 제안
→ 학생 확인 후 적용
→ 오늘 수업과 커리큘럼 맵 동시 갱신
```

### 실패 흐름

```text
API 연결 실패 시 이전 snapshot 유지
잘못된 도구 입력은 400 계열로 거절
오래된 revision 확정은 409로 거절
같은 제안 중복 확정 거절
지원하지 않는 action은 사용자에게 오류 표시
```

권장 테스트 구성:

```text
백엔드 도메인 규칙 단위 테스트
Fastify 앱 주입 API 계약 테스트
프론트 API mapper와 action 분기 테스트
핵심 흐름 브라우저 통합 테스트
```

## 7. 도구 호출 관측성

실제 LLM 연결 후 다음 세 문제를 구분할 수 있어야 한다.

```text
모델이 잘못된 도구를 선택함
도구 입력 검증에 실패함
도구는 성공했지만 프론트 반영에 실패함
```

민감 정보를 제외하고 다음 항목을 구조화 로그로 남긴다.

```text
requestId
conversationId
비식별 학생 내부 ID
선택한 도구 이름
도구 실행 성공·실패
reasonCodes
adjustmentId
확정 여부
처리 시간
적용 전·후 revision
```

로그에 남기지 않을 항목:

```text
API 키와 인증 토큰
전체 학생 발화 원문
전체 LLM 응답 원문
개인정보와 민감한 학습 기록
내부 프롬프트 전문
```

## 8. 실제 LLM 연결 방식

LLM은 한 번에 모든 권한을 받지 않는다.

### 1단계: 설명 전용

```text
규칙 엔진 결과를 입력으로 제공
LLM은 학생용 설명만 생성
도구 호출과 상태 변경 권한 없음
mock 응답과 결과 비교
```

### 2단계: 읽기 도구 허용

```text
get_student_context
get_today_session
get_curriculum_map
assess_schedule_impact
```

모델이 필요한 상태를 조회하고 설명하되 변경하지 못한다.

### 3단계: 제안 도구 허용

```text
adjust_today_session
create_curriculum_plan
compress_curriculum_plan
extend_curriculum_plan
insert_remediation
defer_learning_item
```

이 단계에서도 도구는 제안만 생성한다. 학생 확인 전에는 학습 상태를 변경하지 않는다.

### 4단계: 확인된 변경 적용

`apply_curriculum_plan`과 조율 확정 API는 LLM이 임의로 직접 호출하지 않는다. 프론트가 학생의 명시적 확인을 전달하고 백엔드가 제안 ID와 revision을 검증한 뒤 적용한다.

## 9. LLM 어댑터 요구사항

실제 공급자 코드는 현재 mock 어댑터와 같은 내부 인터페이스 뒤에 둔다.

```ts
type TeacherLlmService = {
  generateResponse(input: TeacherLlmInput): Promise<TeacherLlmResponse>;
};
```

공급자별 구현이 알아야 할 것:

```text
모델 이름
API 호출 형식
도구 스키마 전달 방식
응답과 도구 호출 파싱
재시도와 타임아웃
```

공급자별 구현이 알면 안 되는 것:

```text
프론트 컴포넌트 구조
커리큘럼 상태 변경 규칙
보강·연기 판단 로직
DB 저장 구조
```

환경 변수와 키는 백엔드에서만 읽는다. 키가 없을 때는 mock 어댑터로 명확히 전환하거나 서버 시작을 중단하며, 조용히 다른 동작으로 대체하지 않는다.

## 10. DB·인증 도입 판단

### 데모 내부 검증

다음 조건이면 서버 메모리 상태를 유지한 채 LLM 연결을 먼저 검증할 수 있다.

```text
한 명 또는 소수의 내부 사용자
서버 재시작 시 상태 초기화 허용
개인정보와 실제 성적 데이터 미사용
비용 제한이 가능한 환경
```

### 외부 사용자 검증

다음 조건이면 DB와 인증을 LLM보다 먼저 도입한다.

```text
여러 학생이 동시에 사용
재시작 후 학습 상태 보존 필요
대화와 학습 기록을 사용자별로 분리해야 함
실제 개인정보 또는 학습 결과 사용
도구 실행에 사용자 권한 확인 필요
```

## 권장 작업 단위

1. `[통합] 추천 항목 action별 화면 흐름 재검증`
2. `[백엔드] 상태 변경 API의 LearningSnapshot 계약 통일`
3. `[백엔드] 조율 제안 revision 충돌과 중복 확정 방지`
4. `[백엔드] adjust_today_session 도구 경계 분리`
5. `[백엔드] 커리큘럼 프로필 정책 구현 또는 제한 응답 명시`
6. `[통합] 핵심 사용자 시나리오 자동화`
7. `[백엔드] 도구 호출 구조화 로그 추가`
8. `[LLM] 설명 전용 실제 공급자 어댑터 연결`
9. `[LLM] 읽기 도구 호출 활성화`
10. `[LLM] 확인 기반 조율 제안 활성화`

## LLM 연결 시작 조건

다음 조건을 모두 만족하면 실제 LLM 연결 작업을 시작한다.

```text
프론트에서 커리큘럼과 오늘 수업을 계산하지 않는다.
상태 변경 API가 최신 snapshot을 반환한다.
추천 항목 action별 UI가 무반응 없이 동작한다.
오늘 수업 조정과 전체 계획 조정 도구가 구분된다.
쓰기 도구는 학생 확인 전 상태를 변경하지 않는다.
revision 충돌과 중복 확정이 방지된다.
핵심 정상·실패 시나리오가 자동 테스트로 통과한다.
도구 실행 결과와 reasonCodes를 추적할 수 있다.
LLM 없이도 데모의 전체 학습 흐름이 완주된다.
```

## 이번 단계에서 하지 않을 일

```text
LLM이 직접 커리큘럼 JSON 생성
LLM이 강의 순서와 보강 여부를 단독 결정
학생 확인 없는 상태 변경
프론트에서 모델 API 직접 호출
API 키를 프론트 또는 Git 추적 문서에 기록
메타데이터 근거 없는 강의 자동 삭제
실제 영상 플랫폼 연동
```

## 관련 문서

```text
docs/teacher-llm-api.md
docs/curriculum-backend-ownership-migration.md
docs/curriculum-tool-api.md
docs/progress-tool-api.md
docs/backend-api-guide.md
docs/orchestration-rules.md
```
