# AI 담임 LLM API 설계

## 목적

AI 담임의 대화 응답은 백엔드에서만 생성합니다. 프론트는 모델 공급자, API 키, 프롬프트, 도구 정의를 알지 못하며, 상대 경로 API로 학생 메시지를 전달하고 AI 담임 응답만 받습니다.

현재는 실제 LLM을 호출하지 않고 mock 구현이 같은 계약을 반환합니다. 이후 실제 LLM 연결은 `apps/api/src/teacher-llm/` 안의 구현만 교체하는 방식으로 진행합니다.

## 공개 API

```text
POST /api/conversations/:conversationId/messages
```

요청 본문:

```json
{
  "studentId": "000",
  "message": "오늘 시간이 부족해서 복습 위주로 하고 싶어요."
}
```

응답 형태:

```json
{
  "dataSource": "mock",
  "conversationId": "demo-conversation",
  "responseType": "mock",
  "assistantMessage": "말씀해 주신 조건을 반영해 오늘 수업량과 보강 우선순위를 다시 계산했습니다.",
  "requestedTools": ["adjust_today_session"],
  "attachment": {
    "type": "session-adjustment",
    "data": {
      "adjustmentId": "adjustment-...",
      "interpretedRequest": {
        "conditionKinds": ["short_time", "review_first"],
        "maxSessionMinutes": 25
      },
      "proposedSession": {},
      "requiresConfirmation": true,
      "availableActions": ["confirm", "continue_conversation"]
    }
  }
}
```

`requestedTools`는 AI 담임이 다음에 필요한 내부 도구를 나타냅니다. 현재 mock 단계에서는 `get_student_context`, `adjust_today_session` 두 도구 이름만 반환합니다.

조율이 필요한 학생 메시지에는 `attachment.type`이 `session-adjustment`로 반환됩니다. `attachment.data.proposedSession`은 아직 확정되지 않은 제안이므로, 프론트는 읽기 전용 카드로 표시한 뒤 학생이 동의할 때만 아래 API를 호출합니다.

```text
POST /api/session-adjustments/:adjustmentId/confirm
```

확인 요청 본문에는 대화 요청과 같은 `studentId`를 전달합니다. 확인 전에는 서버의 현재 수업과 진도 상태가 바뀌지 않습니다.

```json
{
  "studentId": "000"
}
```

확인 성공 응답에는 확정된 `studentContext`, `session`, `curriculumMap`, `teacherNote`가 포함됩니다. 프론트는 이 응답으로 현재 화면을 갱신하고 조율 결과를 자체 계산하지 않습니다.

## 백엔드 구조

```text
POST /api/conversations/:conversationId/messages
  -> TeacherLlmService.generateResponse()
  -> mock LLM 구현
  -> AI 담임 응답 반환
```

| 경로 | 역할 |
| --- | --- |
| `teacher-llm.types.ts` | LLM 요청·응답과 서비스 계약을 정의합니다. |
| `teacher-llm.service.ts` | 현재 사용할 LLM 구현을 선택합니다. |
| `teacher-llm.mock.ts` | 실제 LLM 없이 대화 흐름을 검증하는 mock 응답을 생성합니다. |

## 실제 LLM 전환 원칙

실제 LLM을 붙일 때도 다음 원칙을 유지합니다.

```text
API 키와 공급자 SDK는 백엔드에만 둔다.
프론트엔드는 계속 같은 대화 API만 호출한다.
LLM은 학생 요청 해석과 설명 문장 생성에 사용한다.
오늘 수업 편성, 보강 삽입, 진도 조율 판단은 규칙 기반 엔진이 담당한다.
LLM이 요청한 도구 호출은 서버가 허용 목록과 입력값을 검증한 뒤 실행한다.
```

실제 공급자 전환 시에는 `responseType`을 `llm`으로 바꾸고, API 계약 변경 여부를 프론트 세션과 클레임 문서에서 함께 확인합니다.

## 커리큘럼 도구 요청

mock LLM은 커리큘럼 관련 메시지를 받으면 `create_curriculum_plan`, `compress_curriculum_plan`, `extend_curriculum_plan`, `assess_curriculum_deadline`, `apply_curriculum_plan` 중 하나를 요청합니다. 대화 API는 이 요청을 서버의 규칙 기반 도구로 실행한 뒤 `toolCalls`에 결과를 포함합니다.

현재 선택 유형별 실제 차등 정책은 아직 적용하지 않았으므로, 모든 도구 결과의 `appliedPlanProfile`은 `baseline`입니다. 도구 상세 계약은 [curriculum-tool-api.md](./curriculum-tool-api.md)를 참고합니다.
## 조율 제안과 상태 변경 경계

`adjust_today_session`은 오늘 수업 조율안을 생성하는 제안 도구이며 상태를 바꾸지 않습니다. `baseRevision`을 가진 제안은 학생 확인 API에서만 적용되며, stale revision은 `409`와 최신 `snapshot`으로 거절됩니다.