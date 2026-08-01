# 커리큘럼 도구 API

## 목적

커리큘럼 도구는 AI 담임 LLM이 직접 진도 판단을 하지 않고, 규칙 기반 커리큘럼 알고리즘을 호출하도록 만드는 백엔드 경계입니다. 현재는 mock LLM이 도구 요청을 만들고 서버가 이를 실행합니다.

초기 버전에서는 안정형, 압축형, 문제 적용형 중 어떤 유형을 선택해도 같은 기준 계획을 반환합니다. 각 유형의 실제 압축·연장 정책은 이후 강의 중요도, 선수 관계, 복습 가능 여부 메타데이터가 준비된 뒤에 추가합니다.

## 도구 목록

| 도구 | 현재 동작 | 이후 확장 |
| --- | --- | --- |
| `create_curriculum_plan` | 카탈로그의 원래 순서로 기준 계획 생성 | 학생 수준과 시작점 반영 |
| `compress_curriculum_plan` | 기준 계획과 동일한 결과 반환 | 선택·복습 구간 축소 |
| `extend_curriculum_plan` | 기준 계획과 동일한 결과 반환 | 하루 부담 완화, 복습 여유 삽입 |
| `assess_curriculum_deadline` | 최소 필요 일수와 하루 필요 시간을 계산 | 휴일·학습 가능 요일 반영 |
| `apply_curriculum_plan` | 계획을 학생별 서버 메모리에 보관 | DB 저장 및 오늘 수업 운영 엔진 반영 |

## 도구 실행

```text
POST /api/curriculum-tools/execute
```

```json
{
  "tool": "compress_curriculum_plan",
  "input": {
    "studentId": "000",
    "courseId": "ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all",
    "availableMinutesPerDay": 60,
    "targetDays": 14,
    "planProfile": "compressed"
  }
}
```

성공하면 `result.appliedPlanProfile`은 현재 항상 `baseline`입니다. `requestedPlanProfile`에는 요청한 선택값을 보존하므로, 이후 실제 압축 정책을 추가해도 요청 계약을 바꾸지 않아도 됩니다.

응답의 `recommendation`은 기존 `POST /api/curriculum-recommendations`와 같은 규칙 기반 계획입니다. `deadline`에는 기한 위험 판단에 필요한 최소 일수와 하루 필요 시간이 별도로 정리됩니다.

`apply_curriculum_plan` 실행 뒤에는 다음 API로 현재 mock 상태의 적용 계획을 확인할 수 있습니다.

```text
GET /api/curriculum-plans/current?studentId={studentId}
```

상태는 API 서버 메모리에만 보관되며, 재시작하면 사라집니다. 아직 오늘 수업·보강·연기 상태를 바꾸지 않습니다.

## mock LLM 연동

대화 API는 mock LLM이 요청한 도구와 서버 실행 결과를 함께 반환합니다.

```text
POST /api/conversations/:conversationId/messages
```

예를 들어 `커리큘럼을 압축해 주세요.`는 `compress_curriculum_plan`을 요청합니다. 응답의 `requestedTools`에는 mock LLM의 요청이, `toolCalls`에는 서버가 실제 실행한 도구 결과가 들어갑니다.

```json
{
  "responseType": "mock",
  "requestedTools": ["compress_curriculum_plan"],
  "toolCalls": [
    {
      "name": "compress_curriculum_plan",
      "result": {
        "appliedPlanProfile": "baseline"
      }
    }
  ]
}
```

LLM은 요청 유형 선택과 결과 설명만 담당합니다. 강의 순서, 완료 강의 제외, 하루 학습 시간, 기한 가능 여부는 커리큘럼 도구가 계산합니다.

## 진도 운영 도구와의 분리

낮은 이해도에 따른 보강 삽입, 강의 연기, 오늘 수업의 순서 조정은 이 도구의 범위가 아닙니다. 현재 `adjust_curriculum`과 학습 후 체크 API가 담당하는 진도 운영 영역이며, 이후 `insert_remediation`, `defer_learning_item`, `assess_schedule_impact` 같은 별도 도구 계약으로 분리합니다.