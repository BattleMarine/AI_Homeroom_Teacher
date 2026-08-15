# 강좌 카탈로그 기반 커리큘럼 추천 알고리즘

## 목적

강좌 카탈로그에 있는 실제 강의 순서와 재생 시간을 사용해, 학생이 시작할 수 있는 학습 경로와 일별 학습 세션을 추천한다.

이 기능은 AI 담임의 진도 조율 엔진에 입력을 제공하는 규칙 기반 기능이다. LLM은 추천 결과와 조율 사유를 학생에게 자연스럽게 설명할 수 있지만, 강의 선택과 일정 가능 여부 판단은 이 알고리즘이 담당한다.

## 현재 데이터 원본

현재 파일 원본은 아래와 같다.

```text
data/course-catalog/ebsi-2026-suneungwanseong-namchiyeol-math-calculus.json
```

카탈로그에서 사용하는 값은 다음과 같다.

```text
강좌 식별자와 강좌 정보
강의 sequence
강의 유형(orientation, lecture, mock_exam)
과목 영역(subjectAreas)
단원 이름(unitNames)
강의별 실제 재생 시간(duration.seconds)
```

`sourceUrl`과 `playbackTargetId`는 현재 비어 있는 메타데이터이므로 추천 알고리즘에서 사용하지 않는다.

## 추천 입력

`POST /api/curriculum-recommendations`는 아래 조건을 조합할 수 있다.

```text
courseId: 추천할 강좌 식별자, 생략하면 기본 카탈로그
subjectArea: 특정 과목 영역만 추천
unitNames: 특정 단원만 추천
completedLessonIds: 이미 완료한 강의 제외
weakUnitNames: 취약 단원 표시
availableMinutesPerDay: 하루 학습 가능 시간(분), 기본 60분
targetDays: 목표 완료 일수
```

## 처리 순서

1. 카탈로그에서 대상 강좌를 찾는다.
2. 오리엔테이션과 완료 강의를 제외한다.
3. 과목 영역과 단원 조건이 있으면 해당 강의만 남긴다.
4. 남은 강의를 `sequence` 오름차순으로 정렬한다. 원본 순서를 바꾸거나 임의로 강의를 삭제하지 않는다.
5. 연속된 같은 단원 조합을 하나의 추천 단계로 묶는다.
6. 하루 가능 시간을 넘지 않도록 순서대로 강의를 일별 세션으로 묶는다.
7. 한 강의가 하루 가능 시간보다 길면 해당 강의를 분할하거나 숨기지 않고, 단독 세션 및 초과 표시로 반환한다.
8. 전체 남은 시간, 최소 필요 일수, 목표 일수 기준 필요 평균 시간을 계산해 목표 가능 여부를 반환한다.

## 목표 일수 판단

목표 일수가 있으면 다음 조건을 모두 만족해야 `targetAchievable: true`가 된다.

```text
최소 필요 일수 <= 목표 일수
목표일 기준 필요 평균 학습 시간 <= 하루 가능 시간
하루 가능 시간을 넘는 단일 강의가 없음
```

따라서 시간이 부족한 경우에도 강의를 자동으로 생략하지 않는다. 대신 `target_days_at_risk` 사유 코드와 필요한 평균 시간을 반환해 AI 담임이 목표일 조정, 하루 가능 시간 확대, 범위 조정 같은 다음 대화를 제안할 수 있게 한다.

## 현재 한계

카탈로그에는 난이도, 선수 관계, 필수/선택 여부, 공식 단원 체계가 아직 없다. 따라서 현재 알고리즘은 다음 판단을 하지 않는다.

```text
난이도에 따른 선행 또는 후행 순서 변경
강의 중요도에 따른 자동 생략
취약 단원의 복습 강의 자동 삽입
문제 풀이와 개념 강의의 비율 조정
```

`subjectAreas`와 `unitNames`도 강의 제목에서 정규화한 임시 값이므로, 공식 강좌 데이터가 들어오면 이를 우선한다.

## 저장소 전환 지점

`CourseCatalogRepository` 인터페이스가 파일 또는 PostgreSQL 원본을 감쌉니다. `PERSISTENCE_MODE`에 따라 구현을 교체하고, 추천 서비스와 HTTP API 계약은 유지합니다.

```text
메모리 개발 모드: createFileCourseCatalogRepository()
PostgreSQL 모드: createPostgresCourseCatalogRepository()
```

## API 가이드

정확한 HTTP 요청·응답 예시는 [backend-api-guide.md](./backend-api-guide.md)를 따른다.
