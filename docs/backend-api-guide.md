# 백엔드 Mock API 호출 가이드

## 목적

이 문서는 프론트엔드가 AI 담임 백엔드 mock API를 실제로 호출하기 위한 계약입니다.

경로, HTTP 메서드, 요청 본문, 쿼리 문자열, 성공·실패 상태는 `apps/api/src/app.ts`의 현재 구현과 일치합니다. 프론트는 이 문서의 응답을 렌더링하고, 진도·다음 강의·조율 결과를 자체적으로 다시 계산하지 않습니다.

## 공통 규칙

### API 주소

프론트 코드는 상대 경로 `/api`만 사용합니다. 아래 `curl` 예시는 API 서버를 직접 확인할 때만 사용합니다.

로컬 API 주소는 Git 추적에서 제외된 `docs/secrets/`의 로컬 개발 기록을 참고해 각자 설정합니다. 이 문서에는 실제 도메인, 포트, API 키를 기록하지 않습니다.

```bash
export API_BASE_URL="로컬 API 서버 주소"
export STUDENT_ID="000"
```

### 학생 식별자

`studentId`는 인증 전 mock 단계의 임시 상태 키입니다.

```text
쿼리 API: ?studentId={studentId}
본문 API: { "studentId": "..." }
생략 시: 000
```

같은 학생 흐름에서는 모든 API 호출에 동일한 `studentId`를 사용해야 합니다. 다른 값으로 호출하면 별도의 메모리 mock 상태가 생성됩니다.

### 저장 범위

```text
상태는 API 서버 프로세스 메모리에만 저장된다.
API 서버를 재시작하면 모든 studentId의 상태가 초기값으로 돌아간다.
DB·로그인 도입 전에는 다른 기기·다른 서버 프로세스와 상태를 공유하지 않는다.
```

## 공통 응답과 오류

성공 응답에는 항상 `dataSource: "mock"`이 포함됩니다.

| 상태 | 의미 | 프론트 처리 |
| --- | --- | --- |
| `200` | 요청 성공 | 응답 데이터를 화면 상태에 반영합니다. |
| `400` | JSON 본문 검증 실패 | 입력값을 수정하거나 요청 생성 로직을 확인합니다. |
| `404` | 커리큘럼·강의 항목·조율 제안을 찾지 못함 | 현재 `studentId`, 식별자, 선택된 커리큘럼을 확인합니다. |
| `500` | 서버 내부 오류 | 진도 상태를 자체 계산하지 말고 오류·재시도 UI를 표시합니다. |

`POST` 요청은 모두 `Content-Type: application/json` 헤더가 필요합니다.

---

## 1. API 상태 확인

```text
GET /api/health
```

```bash
curl -sS "$API_BASE_URL/api/health"
```

응답:

```json
{
  "status": "ok",
  "service": "ai-homeroom-api",
  "dataSource": "mock"
}
```

---

## 2. 강좌 카탈로그 목록 조회

```text
GET /api/course-catalogs
```

```bash
curl -sS "$API_BASE_URL/api/course-catalogs"
```

응답의 `courses`에는 추천 가능한 강좌의 메타데이터가 들어간다. 현재는 파일 기반 미적분 강좌 한 개를 반환한다.

```json
{
  "dataSource": "mock",
  "catalogDataSource": "file",
  "courses": [
    {
      "id": "ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all",
      "primarySubject": "미적분",
      "lessonCount": 52
    }
  ]
}
```

## 3. 강좌 카탈로그 상세 조회

```text
GET /api/course-catalogs/:courseId
```

```bash
curl -sS "$API_BASE_URL/api/course-catalogs/ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all"
```

응답의 `courseCatalog.lessons`는 원본 순서를 가진 전체 강의 배열이다. `orientation`, `lecture`, `mock_exam` 유형과 `subjectAreas`, `unitNames`, `duration.seconds`를 포함한다.

존재하지 않는 `courseId`는 `404`와 아래 응답을 반환한다.

```json
{
  "message": "강좌 카탈로그를 찾을 수 없습니다."
}
```

## 4. 커리큘럼 추천 생성

```text
POST /api/curriculum-recommendations
```

`courseId`, 과목·단원 범위, 완료 강의, 취약 단원, 하루 가능 시간, 목표 일수를 조합해 추천할 수 있다. 모든 조건은 선택값이며, 조건을 생략하면 기본 강좌 전체에서 오리엔테이션을 제외한 순서형 경로를 추천한다.

```bash
curl -sS -X POST "$API_BASE_URL/api/curriculum-recommendations" \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all",
    "subjectArea": "미적분",
    "unitNames": ["수열의 극한"],
    "completedLessonIds": ["ebsi-namchiyeol-2026-math-calculus-028"],
    "weakUnitNames": ["수열의 극한"],
    "availableMinutesPerDay": 60,
    "targetDays": 2
  }'
```

성공 응답의 핵심 구조는 아래와 같다.

```json
{
  "dataSource": "mock",
  "catalogDataSource": "file",
  "recommendation": {
    "algorithm": "rule-based-v1",
    "summary": {
      "remainingLessonCount": 3,
      "availableMinutesPerDay": 60,
      "targetDays": 2
    },
    "feasibility": {
      "targetDateConfigured": true,
      "targetAchievable": false,
      "requiredAverageMinutesPerDay": 74,
      "overBudgetLessonCount": 0
    },
    "steps": [],
    "sessions": [],
    "reasonCodes": [
      "catalog_sequence_preserved",
      "orientation_excluded",
      "subject_area_filtered",
      "unit_filtered",
      "completed_lessons_excluded",
      "weak_unit_review_signal",
      "target_days_at_risk"
    ],
    "teacherSummary": "..."
  }
}
```

`sessions`는 원본 강의 순서를 보존한 일별 묶음이다. `steps[].weakUnit`은 `weakUnitNames`와 일치한 단원을 표시하며, 취약 단원을 자동으로 앞으로 옮기거나 강의를 삭제하지 않는다.

입력 값의 조건은 아래와 같다.

| 필드 | 조건 |
| --- | --- |
| `courseId`, `subjectArea` | 비어 있지 않은 문자열 |
| `unitNames`, `weakUnitNames` | 최대 50개 문자열 배열 |
| `completedLessonIds` | 최대 500개 문자열 배열 |
| `availableMinutesPerDay` | 정수 `1`~`720` |
| `targetDays` | 정수 `1`~`3650` |

존재하지 않는 `courseId`는 `404`, 조건에 맞는 미완료 강의가 없으면 `422`를 반환한다.

```json
{
  "message": "추천 조건에 맞는 미완료 강의가 없습니다."
}
```

추천 규칙과 데이터 한계는 [curriculum-recommendation-algorithm.md](./curriculum-recommendation-algorithm.md)에서 관리한다.

## 5. 커리큘럼 목록 조회

```text
GET /api/curriculums?studentId={studentId}
```

```bash
curl -sS --get "$API_BASE_URL/api/curriculums" \
  --data-urlencode "studentId=$STUDENT_ID"
```

응답의 `curriculums` 배열 항목:

```json
{
  "id": "stable-log",
  "title": "안정형 커리큘럼",
  "pace": "안정형",
  "description": "기초 보강과 개념 흐름을 충분히 포함해 로그함수 단원을 안정적으로 완성합니다.",
  "recommendedFor": ["기초가 약한 학생", "로그함수 그래프가 불안한 학생"],
  "stepCount": 7,
  "selected": true,
  "currentStepId": "log-graph"
}
```

선택되지 않은 커리큘럼은 `selected: false`, `currentStepId: null`을 반환합니다.

---

## 6. 커리큘럼 선택 또는 변경

```text
POST /api/student-context/curriculum
```

요청 본문:

```json
{
  "studentId": "000",
  "curriculumId": "compressed-log"
}
```

```bash
curl -sS -X POST "$API_BASE_URL/api/student-context/curriculum" \
  -H "Content-Type: application/json" \
  -d "{\"studentId\":\"$STUDENT_ID\",\"curriculumId\":\"compressed-log\"}"
```

`curriculumId`는 필수 문자열이며 현재 아래 값만 허용됩니다.

```text
stable-log
compressed-log
practice-log
```

성공 응답은 `studentContext`, `session`, `curriculumMap`을 함께 반환합니다. 선택을 변경하면 해당 `studentId`의 강의별 완료 기록과 조율 상태는 선택한 커리큘럼의 초기 mock 상태로 다시 시작합니다.

존재하지 않는 `curriculumId`는 `404`와 아래 응답을 반환합니다.

```json
{
  "message": "존재하지 않는 커리큘럼입니다."
}
```

---

## 7. 학생 현재 상태 조회

```text
GET /api/student-context?studentId={studentId}
```

```bash
curl -sS --get "$API_BASE_URL/api/student-context" \
  --data-urlencode "studentId=$STUDENT_ID"
```

응답의 `studentContext` 필드:

```json
{
  "studentId": "000",
  "selectedCurriculumId": "stable-log",
  "currentStepId": "log-graph",
  "completedStepIds": ["log-meaning", "log-calculation"],
  "delayedStepIds": [],
  "weakConcepts": ["점근선", "평행이동"],
  "completedLessonItemIds": [],
  "lowFocusRecorded": false,
  "maxSessionMinutes": 45
}
```

---

## 8. 오늘 수업 조회

```text
GET /api/today-session?studentId={studentId}
```

```bash
curl -sS --get "$API_BASE_URL/api/today-session" \
  --data-urlencode "studentId=$STUDENT_ID"
```

응답의 `session` 핵심 필드:

```json
{
  "id": "000:log-graph",
  "date": "YYYY-MM-DD",
  "goal": "로그함수 그래프의 점근선과 평행이동 정리",
  "estimatedMinutes": 44,
  "items": [
    {
      "id": "stable-log-graph-review-asymptote",
      "kind": "review",
      "title": "점근선 보강 카드",
      "description": "로그함수 그래프에서 점근선이 생기는 이유를 짧게 복습합니다.",
      "conceptTags": ["점근선", "그래프"],
      "estimatedMinutes": 6,
      "required": true,
      "reason": "취약 개념 보강"
    }
  ],
  "delayedItems": [],
  "reasonCodes": ["current_step_based", "weak_concept_review"],
  "explanationItems": ["..."],
  "adjustmentReason": "취약 개념을 현재 수업의 앞부분에서 먼저 확인합니다.",
  "teacherComment": "헷갈렸던 개념을 짧게 확인한 뒤 핵심 진도로 이어가겠습니다."
}
```

`items`와 `delayedItems`의 `kind` 값은 `lecture`, `review`, `practice`, `check` 중 하나입니다. `playbackTargetId`는 강의(`lecture`) 항목에만 포함될 수 있으며, 실제 재생 정보는 강의 상세 API의 `playback` 필드를 사용합니다.

---

## 9. 오늘 수업 진행 보고 조회

```text
GET /api/today-session/progress?studentId={studentId}
```

```bash
curl -sS --get "$API_BASE_URL/api/today-session/progress" \
  --data-urlencode "studentId=$STUDENT_ID"
```

응답의 `progress` 필드:

```json
{
  "sessionId": "000:log-graph",
  "completedItemIds": ["stable-log-graph-asymptote-lecture"],
  "completedItemCount": 1,
  "totalItemCount": 6,
  "progressPercent": 17,
  "completedItems": [],
  "carryOverItems": [],
  "isCompleted": false,
  "nextRecommendedItem": {
    "id": "stable-log-graph-review-asymptote",
    "kind": "review",
    "title": "점근선 보강 카드",
    "action": "open-review",
    "playbackAvailable": false
  },
  "teacherReport": "다음으로 점근선 보강 카드를 이어서 진행해 보겠습니다."
}
```

`nextRecommendedItem`은 오늘 수업에서 아직 완료하지 않은 필수 항목을 우선 반환하며, 더 이상 없으면 `null`입니다. `action`은 백엔드가 결정한 실행 방식이며, 프론트는 해당 값에 맞는 UI만 표시합니다. `play-lesson`은 `playbackAvailable: true`와 함께만 반환됩니다.

---

## 10. 커리큘럼 맵 조회

```text
GET /api/curriculum-map?studentId={studentId}
```

```bash
curl -sS --get "$API_BASE_URL/api/curriculum-map" \
  --data-urlencode "studentId=$STUDENT_ID"
```

응답의 `curriculumMap` 필드:

```json
{
  "curriculumId": "stable-log",
  "curriculumTitle": "안정형 커리큘럼",
  "currentStepId": "log-graph",
  "completedStepIds": ["log-meaning", "log-calculation"],
  "delayedStepIds": [],
  "weakConcepts": ["점근선", "평행이동"],
  "steps": [
    {
      "id": "log-graph",
      "title": "로그함수 그래프",
      "conceptTags": ["점근선", "평행이동", "그래프"],
      "estimatedMinutes": 44,
      "status": "진행 중"
    }
  ]
}
```

`steps[].status`는 `완료`, `진행 중`, `예정`, `보강 필요`, `연기됨` 중 하나입니다.

---

## 11. 강의·수업 항목 상세 조회

```text
GET /api/lesson-items/:lessonItemId?studentId={studentId}
```

```bash
curl -sS --get "$API_BASE_URL/api/lesson-items/stable-log-graph-asymptote-lecture" \
  --data-urlencode "studentId=$STUDENT_ID"
```

응답의 `lessonItem` 필드:

```json
{
  "id": "stable-log-graph-asymptote-lecture",
  "kind": "lecture",
  "title": "로그함수 그래프: 점근선과 정의역",
  "description": "그래프가 가까워지는 선과 정의역의 관계를 정리합니다.",
  "conceptTags": ["점근선", "정의역", "그래프"],
  "estimatedMinutes": 9,
  "required": true,
  "reason": "그래프 핵심 개념",
  "playbackTargetId": "mock-video:stable-log-graph-asymptote-lecture",
  "currentSessionId": "000:log-graph",
  "sessionReason": "그래프 핵심 개념",
  "completed": false,
  "playback": {
    "kind": "mock-video",
    "targetId": "mock-video:stable-log-graph-asymptote-lecture",
    "mediaType": "image",
    "contentType": "image/png",
    "mediaUrl": "/api/lesson-items/stable-log-graph-asymptote-lecture/playback?studentId=000",
    "durationSeconds": 540
  }
}
```

`playback.mediaUrl`은 프론트가 가공하지 않고 그대로 요청하는 `/api` 상대 경로입니다. `durationSeconds`는 모의 플레이어 표시용 길이이며 `estimatedMinutes`와 별도로 관리합니다. `review`, `practice`, `check` 항목은 `playback: null`을 반환합니다. 기존 `playbackTargetId`, `playback.kind`, `playback.targetId`는 호환성을 위해 유지합니다.

### 11-1. 강의 mock 미디어 조회

```text
GET /api/lesson-items/:lessonItemId/playback?studentId={studentId}
```

강의 상세의 `playback.mediaUrl`을 그대로 요청합니다.

```bash
curl -sS --get "$API_BASE_URL/api/lesson-items/stable-log-graph-asymptote-lecture/playback" \
  --data-urlencode "studentId=$STUDENT_ID" \
  --output mock-lecture.png
```

성공하면 `200`과 `image/png` 바이너리를 반환합니다. API는 서버 내부의 허용된 `assetKey`만 사용하며, 요청의 `lessonItemId`를 파일 경로로 연결하지 않습니다.

| 상태 | 의미 |
| --- | --- |
| `200` | 재생 가능한 lecture의 mock PNG 반환 |
| `400` | 비어 있거나 형식이 잘못된 `studentId` 또는 `lessonItemId` |
| `404` | 현재 학생의 커리큘럼에 없는 항목 또는 재생 불가 항목 |
| `500` | 등록된 mock 미디어 자산을 읽지 못함 |

실제 영상 URL, 스트리밍, CDN, 구간 재생은 이번 mock API 범위에 포함하지 않습니다.

---

## 12. 강의별 이해도·집중도 기록

```text
POST /api/lesson-feedback
```

요청 본문:

```json
{
  "studentId": "000",
  "lessonId": "stable-log-graph-asymptote-lecture",
  "understandingLevel": 2,
  "focusLevel": 2
}
```

```bash
curl -sS -X POST "$API_BASE_URL/api/lesson-feedback" \
  -H "Content-Type: application/json" \
  -d "{\"studentId\":\"$STUDENT_ID\",\"lessonId\":\"stable-log-graph-asymptote-lecture\",\"understandingLevel\":2,\"focusLevel\":2}"
```

| 필드 | 조건 |
| --- | --- |
| `lessonId` | 비어 있지 않은 문자열 |
| `understandingLevel` | 정수 `1`~`5` |
| `focusLevel` | 정수 `1`~`5` |

`studentId`는 선택 입력입니다. 직접 호출할 때는 상태 연결을 위해 전달합니다.

성공 응답의 핵심 필드:

```json
{
  "responseType": "mock",
  "lessonId": "stable-log-graph-asymptote-lecture",
  "recorded": true,
  "completedLesson": {},
  "appliedFeedback": {
    "understandingLevel": 2,
    "focusLevel": 2
  },
  "weakConcepts": ["점근선", "평행이동", "정의역", "그래프"],
  "reasonCodes": ["low_understanding", "weak_concept_review", "low_focus", "reduce_next_session_load"],
  "teacherNote": "이해도가 낮게 기록되어, 해당 강의의 개념을 취약 개념으로 반영했습니다.",
  "progress": {}
}
```

`progress`의 구조는 `GET /api/today-session/progress`의 `progress`와 같습니다. 프론트는 이 응답으로 진행 보고와 다음 추천 학습 항목을 표시합니다.

---

## 13. AI 담임 메시지와 조율 제안

```text
POST /api/conversations/:conversationId/messages
```

요청 본문:

```json
{
  "studentId": "000",
  "message": "오늘 시간이 부족하고 복습 위주로 하고 싶어요."
}
```

```bash
curl -sS -X POST "$API_BASE_URL/api/conversations/frontend-conversation/messages" \
  -H "Content-Type: application/json" \
  -d "{\"studentId\":\"$STUDENT_ID\",\"message\":\"오늘 시간이 부족하고 복습 위주로 하고 싶어요.\"}"
```

`message`는 필수 문자열이며 길이는 `1`~`2000`자입니다. `studentId`는 선택 입력입니다.

조율 대상 메시지의 응답 핵심 필드:

```json
{
  "conversationId": "frontend-conversation",
  "responseType": "mock",
  "assistantMessage": "...",
  "requestedTools": ["adjust_curriculum"],
  "attachment": {
    "type": "session-adjustment",
    "data": {
      "adjustmentId": "adjustment-...",
      "interpretedRequest": {
        "kind": "short_time",
        "conditionKinds": ["short_time", "review_first"],
        "summary": "오늘 시간이 부족해요, 복습 위주로 진행하고 싶어요",
        "focusConcept": null,
        "maxSessionMinutes": 25
      },
      "before": {
        "estimatedMinutes": 44,
        "itemIds": [],
        "delayedItemIds": []
      },
      "proposedSession": {},
      "teacherNote": "...",
      "requiresConfirmation": true,
      "availableActions": ["confirm", "continue_conversation"]
    }
  }
}
```

조율 대상이 아닌 메시지는 `attachment: null`을 반환합니다.

`conditionKinds`에는 `short_time`, `review_first`, `confused_concept`, `reduce_new_lecture`가 조합되어 들어갈 수 있습니다. `proposedSession`은 오늘 수업 조회의 `session`과 같은 구조이며, 제안 단계에서는 현재 `studentContext`와 현재 수업이 바뀌지 않습니다.

---

## 14. 조율 제안 확정

```text
POST /api/session-adjustments/:adjustmentId/confirm
```

`adjustmentId`는 바로 앞의 대화 API 응답 `attachment.data.adjustmentId`를 사용합니다.

요청 본문:

```json
{
  "studentId": "000"
}
```

```bash
curl -sS -X POST "$API_BASE_URL/api/session-adjustments/adjustment-id/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"studentId\":\"$STUDENT_ID\"}"
```

요청 본문은 빈 객체 `{}`도 허용하며, 이 경우 `000` 상태에 대해서만 확정합니다. `studentId`를 대화 요청에 보냈다면 반드시 같은 값을 다시 보내야 합니다.

성공 응답은 `adjustmentId`, `confirmed: true`, `studentContext`, `session`, `curriculumMap`, `teacherNote`를 포함합니다. 존재하지 않거나 다른 `studentId`에 속한 `adjustmentId`는 `404`를 반환하며, 확정된 제안 ID는 다시 사용할 수 없습니다.

## 프론트 전환 순서

```text
1. 앱 진입: GET /api/curriculums, GET /api/student-context, GET /api/today-session, GET /api/curriculum-map
2. 커리큘럼 선택: POST /api/student-context/curriculum 응답으로 카드·맵·학생 상태를 함께 갱신
3. 강의 열기: GET /api/lesson-items/:lessonItemId
4. 강의 종료: POST /api/lesson-feedback 응답의 progress로 진행 보고와 다음 추천 렌더링
5. 학생 요구사항: POST /api/conversations/:conversationId/messages
6. 조율 동의: POST /api/session-adjustments/:adjustmentId/confirm 응답으로 카드·맵·학생 상태를 함께 갱신
```

API 요청 실패 시에는 연결 오류와 재시도 UI만 표시합니다. 프론트의 기존 mock 규칙으로 수업·진도·다음 추천을 대체 계산하지 않습니다.

## 15. 커리큘럼 도구 실행

```text
POST /api/curriculum-tools/execute
```

LLM 또는 클라이언트가 규칙 기반 커리큘럼 도구를 실행할 때 사용합니다. 현재 `create_curriculum_plan`, `compress_curriculum_plan`, `extend_curriculum_plan`, `assess_curriculum_deadline`, `apply_curriculum_plan`을 지원합니다.

`planProfile`은 `stable`, `compressed`, `practice` 중 하나입니다. 초기 버전은 어떤 값을 요청해도 `result.appliedPlanProfile: "baseline"`과 같은 기준 커리큘럼을 반환합니다.

정확한 요청·응답 계약과 mock LLM 연동 규칙은 [curriculum-tool-api.md](./curriculum-tool-api.md)를 참고합니다.

## 16. 적용된 커리큘럼 계획 조회

```text
GET /api/curriculum-plans/current?studentId={studentId}
```

`apply_curriculum_plan`으로 mock 상태에 보관한 계획을 반환합니다. 아직 적용 계획이 없으면 `404`를 반환합니다.