# 진도 운영 도구 API

적용된 커리큘럼 계획 위에서 보강 삽입, 강의 연기, 일정 영향 계산을 수행한다. 원본 커리큘럼 버전을 변경하지 않고 학생별 진도 실행 상태만 변경한다.

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

`apply_curriculum_plan`을 실행하면 카탈로그 기반 계획이 `GET /api/today-session`, `GET /api/curriculum-map` 조회 결과에 반영됩니다. `PERSISTENCE_MODE=memory`이면 서버 재시작 시 상태가 초기화되고, `postgres`이면 PostgreSQL에 유지됩니다.

## 오늘 수업 조율 제안

`adjust_today_session`은 학생 메시지를 입력으로 받아 오늘 수업의 시간·복습 우선순위 조율안을 생성합니다. 이 도구는 학습 상태를 변경하지 않으며, 응답의 `baseRevision`과 조율 제안 ID를 사용해 학생 확인 뒤에만 적용합니다.

## 상태 변경과 LearningSnapshot

커리큘럼 선택, 커리큘럼 계획 적용, 보강 삽입, 학습 항목 연기, 강의별 피드백 기록, 조율 제안 확정 응답은 모두 최신 `snapshot`을 포함합니다. `snapshot.revision`은 상태 변경마다 1씩 증가합니다.

조율 제안 확정은 제안의 `baseRevision`과 현재 revision이 다르면 `409` 및 최신 `snapshot`을 반환합니다. 충돌이 난 제안 ID는 다시 확정할 수 없습니다.
