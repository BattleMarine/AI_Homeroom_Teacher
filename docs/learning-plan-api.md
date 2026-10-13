# 전체 학습 계획 도구 API

이 문서는 새 학습 계획 도구의 HTTP 계약이다. 자연어·LLM·대화 ID 없이 호출하며 과거 커리큘럼 API와 별개다. [로드맵](./learning-plan-roadmap.md)의 현재 R1·R2 대상이고 저장·테스트 DB 계약은 [저장 문서](./learning-plan-persistence.md)를 따른다. 프론트·실제 LLM 연결과 실제 서버 재시작 검증은 별도 통합 작업이다.

## 호출 순서

기존 학생을 명시해 `생성 제안 → 후보 확인 → 확정 → 조회 → 실제 수강 → 재편성/부분 조정 제안 → 확정`으로 사용한다. 학생 자동 생성·기본 학생 ID는 없다. PostgreSQL 저장소가 연결되지 않으면 새 도구는 503이며 파일/mock 결과로 대체하지 않는다. 프론트와 LLM도 동일 상대 경로 `/api`를 사용한다.

| 메서드·경로 | 용도 |
| --- | --- |
| `POST /api/learning-plans/proposals/create` | 최초 전체 일정 제안 |
| `GET /api/learning-plans?studentId=…` | 학생 현재 전체 계획·basis |
| `GET /api/learning-plans/:planId?studentId=…&date=YYYY-MM-DD&versionId=…` | 지정 계획·선택적 날짜/과거 버전 조회 |
| `POST /api/learning-plans/:planId/proposals/rebalance` | 실제 잔여 분량의 전체 재편성·조건/강좌 변경 |
| `POST /api/learning-plans/:planId/proposals/adjust` | 명시한 구간 이동·교환만 제안 |
| `POST /api/learning-plans/proposals/:proposalId/confirm` | 서버 저장 후보 확정 |
| `POST /api/learning-plans/:planId/progress` | 실제 수강 위치·소비 시간·선택적 종료 피드백 기록 |
| `POST /api/learning-plans/:planId/feedback` | 실제 완료 뒤 최초 피드백 제출 |

조회의 `date`, `versionId`는 선택적이다. 과거 버전은 당시 예정 일정·조건을 반환하고 실제 기록은 별도 현재 `progress`, `completions`, `dailyUsage`다. 실제 완료를 과거 강의 ID에 합쳐 재계산하지 않는다. `basis`는 현재 계획·현재 선택 카탈로그 기준이며 과거 버전 변경 기준이 아니다.

## 생성·확정·기준값

생성 입력 예시(식별자는 실제 학생·카탈로그 값으로 바꾼다):

```json
{
  "studentId": "<student-id>",
  "selections": [{"subjectCode": "<course-primarySubject>", "courseId": "<course-id>"}],
  "startDate": "2026-10-01",
  "deadlineDate": "2026-10-31",
  "availableSecondsPerDay": 10800,
  "dateOverrides": [{"date": "2026-10-02", "totalSeconds": 3000}]
}
```

시작일 생략 시 서버 서울 오늘, 시작·마감 모두 포함한다. 과거 시작일의 예정 계획도 허용한다. 날짜는 실제 `YYYY-MM-DD`와 연도 1~9999, 기간은 최대 3650일이다. 과목 식별자는 강좌 `primarySubject`와 일치해야 한다. 선택 강좌의 전체 `lecture`, `mock_exam`을 사용하고 `orientation`은 `excludedItems`에 ID·이유를 반환한다. 특정 강의 수나 과목을 고정하지 않는다. 평소 하루 총한도는 0~86400 정수 초, 날짜 예외도 같은 총한도 계약이다.

성공은 HTTP 200의 `{kind:"proposed", proposal, candidate, diff, warnings}`다. 아직 현재 계획·학습 기록은 바뀌지 않는다. `proposal`에는 `proposalId`, `targetPlanId`, `studentId`, `expectedBasis`, DB 시각 `createdAt`, `expiresAt`이 있다. 제안 유효시간은 30분이다.

확정 요청은 아래와 같으며 candidate를 전송하지 않는다.

```json
{"studentId":"<student-id>","expectedBasis":{"planId":null,"currentVersionId":null,"planRevision":0,"completionRevision":0,"catalogHash":"<proposal.expectedBasis.catalogHash>"}}
```

실제로는 제안 응답의 **`proposal.expectedBasis` 객체 전체를 그대로** 사용한다. 변경 도구 요청에는 GET의 `basis`를 사용한다. `basis`에는 `planId`, `currentVersionId`, `planRevision`, `completionRevision`, `catalogHash`가 모두 필요하다. 새 과목을 선택할 때 호출자가 새 hash를 계산하지 않는다. 서버가 기존 GET 기준을 확인한 뒤 새 선택 카탈로그를 조회하고 제안의 확정 기준을 반환한다.

확정 응답은 `{planId, version, basis, replayed}`다. 정확한 같은 제안·학생·최초 기준 재시도는 최초 결과를 반환한다. 다른 실제 수강·피드백·계획 변경 뒤 오래된 미확정 제안은 409이며 다시 조회·계산한다.

## 예정 구간과 실제 수강

`candidate.items[].durationSeconds`는 원본 강의 전체 초이며 바꾸지 않는다. `assignments[]`는 `itemKey`, `segmentKey`, `lessonId`, `courseId`, `subjectCode`, `date`, `order`, `startOffsetSeconds`, `endOffsetSeconds`, `durationSeconds`를 가진다. 구간은 원본 강의의 `[시작, 끝)`이며 구간 시간은 끝-시작이다. 같은 강의의 다일 이어보기는 같은 `itemKey`를 사용한다.

신규 강의의 잔여 분량이 해당 날짜 총한도를 넘으면 이어보기 배치한다. 미래 날짜의 큰 한도는 오늘 배치를 막는 조건이 아니다. 오늘 3000초·내일 6000초에도 4200초 강의는 오늘 0~3000, 내일 3000~4200으로 배정할 수 있다. 이월 강의는 실제 사용시간을 차감한 여유에서 오래된 순으로 신규보다 먼저 이어본다. 해당 날짜 총한도 안에 완강 가능한 신규 강의는 과목 균형이나 단순 자투리 채우기를 위해 쪼개지 않는다. 실제로 2100초까지 수강했다면 재편성은 2100~4200의 2100초만 배정한다. 계획된 3000초를 실제 수강으로 간주하지 않는다.

실제 수강 요청:

```json
{"studentId":"<student-id>","itemKey":"<item-key>","idempotencyKey":"<stable-event-key>","positionSeconds":2100,"spentSeconds":2100}
```

`positionSeconds`는 원본 기준 단조 위치, `spentSeconds`는 이번 사건의 실제 소비 초다. 배속·다시 보기 때문에 서로 같다고 추정하지 않는다. 소비 초는 0~86400 정수다. 위치 증가 또는 양수 소비가 있는 실제 사건만 받는다. 위치 회귀·원본 끝 초과·무변화 사건은 거절한다. 동일 위치의 양수 소비는 다시 보기 시간이며 새 콘텐츠 생성 기능은 아니다. `studyDate`는 클라이언트 입력 없이 DB의 서울 오늘로 기록한다.

재시도에는 **같은 사건의 같은 key와 요청 전체**를 사용한다. 동일 요청·같은 key는 당시 결과와 revision을 반환하고 시간은 재가산하지 않는다. 같은 값에 새 key를 붙이면 별도의 실제 사건이므로 소비 시간이 추가된다. 진도나 소비 시간의 최초 사건은 `completionRevision`을 바꿔 이전 제안을 무효화한다.

원본 끝에 도달하면 실제 완료 시각을 저장한다. 끝 사건에 `feedback`을 동봉하거나 완료 후 `/feedback`으로 최초 피드백을 제출할 수 있다.

```json
{"studentId":"<student-id>","itemKey":"<item-key>","idempotencyKey":"<stable-feedback-key>","feedback":{"understandingLevel":3,"focusLevel":4,"weakConcepts":["취약 개념"],"comment":"선택 입력"}}
```

이해도·집중도는 1~5 정수, 취약 개념 목록과 댓글은 선택이다. 실제 미완료의 피드백 제출은 거절한다. 최초 피드백은 보존하며 다른 본문으로 덮어쓰면 409다. 미제출 `payload:null`과 제출된 피드백을 구분한다. 피드백 key는 진도 사건 key와 다른 동작 범위다. 피드백 제출도 제안 기준을 무효화하되 실제 시간·위치를 추정해 늘리지 않는다.

## 전체 재편성과 부분 조정

재편성은 `studentId`, GET의 `expectedBasis`를 필수로 받는다. `fromDate` 기본은 서울 오늘이다. `deadlineDate`, `availableSecondsPerDay`, `dateOverrides`, `selections`를 생략하면 기존 값을 사용한다. `dateOverrides`를 전달하면 예외 목록 전체를 교체한다. `selections`도 최종 수강 강좌 목록 전체이며 기존 강좌에 추가·제거·교체를 적용하는 방법이다. 재편성의 `selections:[]`는 마지막 과목까지 명시 제거한 빈 일정이며 과거 진도·피드백·소비 시간은 보존한다. 최초 생성의 빈 선택은 허용하지 않는다.

오늘 시간 변경은 `todayTime:{mode:"total",seconds:3000}` 또는 `{mode:"additional",seconds:3000}`이다. additional은 서버가 **계획 전체의 오늘 실제 소비**를 조회해 더한 총한도로 저장한다. 제거된 과목의 소비도 차감한다. 평소 한도는 유지한다. 요청 총한도보다 이미 소비한 시간이 많아도 실제 기록은 줄이지 않고 그날 추가 배정은 0이다.

`candidate.normalizedDays[].capacitySeconds`는 총한도다. `progressSnapshot`에 전체 실제 위치·일별 사용 근거를 별도로 저장한다. 엔진·검증기는 실제 사용을 한 번만 차감한다. GET `days`에는 `totalSeconds`, `spentSeconds`, `remainingSeconds`, `scheduledSeconds`를 구분한다. scheduled는 해당 버전 예정 구간 합계이며 실제 실행 후 자동으로 원본 계획을 수정하지 않는다.

생성과 전체 재편성은 동일 공통 엔진에서 남은 기간 전체의 날짜별 여유에 맞춰 일반 진도를 분산한다. 하루 한도는 채워야 할 분량이 아니다. 계산 중의 유연한 누적 목표와 실제 강의 배정 편차를 사용하되 그 목표를 `availableSecondsPerDay`, `dateOverrides` 또는 새 저장 조건으로 바꾸지 않는다. 원본 강의 단위·당일 총한도에 따른 이어보기·이월 우선·선수 순서를 지켜 빈 날짜나 목표 초과가 생길 수 있으며, 분산 목표 때문에 완강 가능한 강의를 쪼개지 않는다. 제한된 과목 시작 순서 탐색으로 전역 최적화·모든 유효 입력의 발견을 보장하지 않는다. 별도 요청·확정 없이 기존 저장 일정을 재계산하지 않는다.

재편성은 강좌 원본 순서를 지킨 뒤 오래된 이월을 우선하고 여유 내 여러 과목·인접 날짜를 순환한다. `carryoverCandidates`에 최초 지난 미완료 예정 날짜를 제시하며 기존 최초 날짜를 초기화하지 않는다. 완료·부분 진도·피드백과 제외된 항목의 과거 기록은 보존한다.

부분 조정은 다음 형식이다. 교환은 두 이동을 한 요청으로 명시한다.

```json
{"studentId":"<student-id>","expectedBasis":{"planId":"<plan-id>","currentVersionId":"<version-id>","planRevision":1,"completionRevision":0,"catalogHash":"<GET basis.catalogHash>"},"moves":[{"segmentKey":"<segment-key>","date":"2026-10-03","order":0}]}
```

실제 요청에는 GET의 `basis` 객체 전체를 넣는다. 지정하지 않은 구간의 위치·초를 바꾸지 않는다. 실제 진도 보정이 필요한 구간이 요청 밖에 있으면 `EXECUTION_SCOPE_CONFLICT`로 409를 반환하고 별도 재편성을 요청한다. 이동 범위 안 실제 수강 보정과 이동은 diff로 설명하며 전체 순서·커버리지·한도를 검증한다. 실패 시 현재 계획·제안 저장은 불변이다.

## 실패와 제한

| HTTP·코드/결과 | 의미 |
| --- | --- |
| 200 `kind:not-plannable`, `INSUFFICIENT_CAPACITY` | 기간 총잔여 용량 부족. `shortageSeconds`, 미배정 항목, 대안 반환. `proposal:null` |
| 200 `kind:not-plannable`, `SEARCH_LIMIT` | 제한 배치 탐색 실패. 수학적 불가능/최적해라는 뜻 아님. 제안 없음 |
| 400 | 잘못된 HTTP 형식·필수값·미지원 추가 필드. 추가 필드를 조용히 삭제하지 않음 |
| 404 `NOT_FOUND` | 학생·계획·제안·버전 없음 또는 다른 학생 귀속 |
| 409 `ADJUSTMENT_CONFLICT` | 명시 부분 이동의 순서·커버리지·시간·범위 충돌. 제안 없음 |
| 409 `BASIS_CONFLICT`/`CATALOG_CONFLICT` | 오래된 상태·카탈로그. 재조회 후 재계산 |
| 409 `IDEMPOTENCY_CONFLICT` | 같은 key의 다른 요청 또는 이미 제출한 피드백 변경 |
| 409 `PROPOSAL_EXPIRED`/`INVALID_STATE` | 만료·현재 상태에서 허용되지 않는 실행 |
| 422 `SUBJECT_COURSE_MISMATCH` | 선택 과목과 실제 강좌 과목 불일치 |
| 422 `REENROLLMENT_SELECTION_REQUIRED` | 제거 강좌 재등록의 이어가기/새로 시작 계약 미결 |
| 422 기타 입력·카탈로그 오류 | 실제 날짜·시간·카탈로그·구간 조건이 지원 범위 밖 |
| 503/500 | 저장 미연결/예상하지 못한 처리 장애. mock 성공으로 숨기지 않음 |

대안은 배열이다. `increase-time.additionalCapacitySecondsLowerBound`는 총부족의 하한이며 그만큼 늘리기만 하면 반드시 성공한다는 뜻이 아니다. `extend-deadline`은 동일 제약으로 배치를 다시 계산해 성공한 기한만 제공하며 최소 기한을 보장하지 않는다. 최대 16개의 과목 시작 순서·8개의 기한 확장 후보만 탐색한다.

현재 선수 조건은 실제 강좌의 sequence만 지원한다. 메타데이터에 없는 과목 간 선수 조건·요일별 규칙·과목별 기한·복습/문제 콘텐츠 생성은 지원하지 않는다. 제거한 같은 강좌 재등록은 임의 완료 승계·삭제 없이 차단하고 `resume`/`new` 선택 계약을 추가 논의한다. 기존 카탈로그 항목의 초·순서·유형이 바뀌면 기존 학습 귀속을 조용히 덮어쓰지 않는다.

## 검증

재등록의 향후 최소 선택안은 `reenrollment:{courseId,mode:"resume"|"new",sourceVersionId}`다. resume은 명시한 과거 학습 회차의 itemKey·진도·피드백·최초 이월일을 승계하고, new는 새 itemKey·진도 0으로 시작하되 과거 행과 학생 계획 전체의 오늘 사용시간을 보존하는 방향이다. sourceVersionId는 어떤 과거 회차를 선택하는지 구분한다. **현재 허용 입력이 아니며 정책·구현은 미확정**이다. 지금은 해당 재등록 경로의 422를 유지한다.

`pnpm --filter @ai-homeroom/api test`로 순수 엔진·HTTP 단위 검사 및 기존 회귀를 실행한다. API 단위 검사의 저장 경계 대역은 DB 저장·복구 검증을 대신하지 않는다. 전용 DB 검사는 저장 문서, 실제 HTTP·독립 SQL·OS 서버 재시작 인수는 통합의 `verify:learning-plan` 검사로 구분한다. DB 검사와 카탈로그 변조 검사를 같은 전용 DB에서 동시에 실행하지 않는다.
