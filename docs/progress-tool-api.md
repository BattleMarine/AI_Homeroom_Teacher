# 진도 운영 도구 API

적용된 커리큘럼 계획 위에서 보강 삽입, 강의 연기, 일정 영향 계산을 수행한다. 원본 커리큘럼을 삭제하지 않고 학생별 서버 메모리의 운영 조정 상태만 변경한다.

```text
POST /api/progress-tools/execute
```

지원 도구는 다음과 같다.

| 도구 | 입력 | 동작 |
| --- | --- | --- |
| `insert_remediation` | `concept`, `estimatedMinutes` | 현재 수업 앞에 보강 항목 삽입 |
| `defer_learning_item` | `lessonItemId` 선택 | 지정 항목 또는 현재 수업의 마지막 미완료 항목 연기 |
| `assess_schedule_impact` | `availableMinutesPerDay`, `targetDays` | 남은 시간·최소 필요 일수·기한 가능 여부 계산 |

예시:

```json
{
  "tool": "insert_remediation",
  "input": {
    "studentId": "000",
    "concept": "점근선",
    "estimatedMinutes": 10
  }
}
```

`apply_curriculum_plan`을 실행하면 카탈로그 기반 계획이 실제 `GET /api/today-session`, `GET /api/curriculum-map` 조회 결과에 반영된다. 서버를 재시작하면 계획과 조정 상태는 사라진다.
