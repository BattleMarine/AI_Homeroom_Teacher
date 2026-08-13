# PostgreSQL 기초 구축 및 백엔드 전환 작업 계획

## 1. 문서 목적

이 문서는 현재 파일·메모리 기반인 백엔드 데이터를 PostgreSQL에 저장하고, 기존 API가 데이터베이스를 통해 학생 정보와 강좌·강의 목록을 조회하도록 전환하는 작업 순서를 정의한다.

첫 DB 단계의 목표는 다음과 같다.

> 학생과 강좌·강의의 기초 테이블을 만들고, 백엔드가 저장소 계층을 통해 PostgreSQL에 질의한 결과를 기존 HTTP API 계약으로 반환한다.

이번 단계에서는 실제 LLM, 인증, 개인정보, 결제, 실제 영상 스트리밍을 다루지 않는다. 프론트가 데이터베이스에 직접 접속하는 구조도 만들지 않는다.

```text
프론트엔드
  → 백엔드 HTTP API
    → 도메인 서비스
      → 저장소 인터페이스
        → PostgreSQL
```

## 2. 현재 상태

현재 백엔드는 다음 저장 방식을 사용한다.

| 데이터 | 현재 저장 방식 | DB 전환 목표 |
| --- | --- | --- |
| 강좌와 강의 목록 | JSON 파일 | PostgreSQL 조회로 전환 |
| 사전 정의 커리큘럼 | TypeScript mock data | 초기에는 유지하고 후속 단계에서 DB 전환 |
| 학생 학습 상태 | API 프로세스의 `Map` | PostgreSQL 영속화 |
| 보강·연기 상태 | API 프로세스의 `Map` | 학생 학습 상태 또는 별도 테이블에 저장 |
| 강의별 피드백 | 현재 상태에 즉시 반영 | 이벤트 테이블에 기록하고 상태에도 반영 |
| 조율 제안 | API 프로세스의 `Map` | 제안 테이블과 트랜잭션으로 전환 |
| 적용한 커리큘럼 계획 | API 프로세스의 `Map` | 후속 테이블로 영속화 |

현재 API 계약은 가능한 한 유지한다. DB 테이블 구조를 프론트 응답에 그대로 노출하지 않고, 저장소 결과를 기존 API 타입으로 변환한다.

## 3. 범위

### 이번 단계에 포함

```text
PostgreSQL 연결 설정
마이그레이션 도구 구성
학생 기초 테이블
강좌·강의 기초 테이블
기존 강좌 JSON 데이터 seed
학생·강좌·강의 저장소 인터페이스
PostgreSQL 저장소 구현
기존 조회 API의 DB 전환
학생 학습 상태와 revision 저장 기반
DB 연결·마이그레이션·저장소 통합 테스트
서버 재시작 뒤 데이터 보존 확인
실행 및 복구 문서
```

### 이번 단계에서 제외

```text
회원가입과 로그인
실제 개인정보 저장
관리자용 CRUD 화면
프론트의 DB 직접 연결
LLM 대화 원문 저장
실제 영상 파일 저장
전체 커리큘럼 정책 재설계
운영용 고가용성·복제·자동 백업
```

## 4. 선행 확인

- [ ] 현재 작업 트리가 깨끗하고 기준 커밋이 명확하다.
- [ ] 프론트의 `nextRecommendedLesson`과 백엔드의 `nextRecommendedItem` 계약 불일치를 별도 작업으로 수정한다.
- [ ] Docker PostgreSQL 이미지 버전을 `latest`가 아닌 특정 버전으로 고정한다.
- [ ] 실제 비밀번호와 `DATABASE_URL`이 Git 추적에서 제외되는지 확인한다.
- [ ] 현재 API 테스트를 실행해 DB 전환 전 기준 결과를 기록한다.

## 5. 권장 기술 구성

```text
PostgreSQL 18 고정 버전 이미지
pg
drizzle-orm
drizzle-kit
Docker Compose
Fastify
```

프로젝트 패키지는 전역 설치하지 않고 `@ai-homeroom/api` 패키지에 추가한다.

```bash
pnpm --filter @ai-homeroom/api add drizzle-orm pg
pnpm --filter @ai-homeroom/api add -D drizzle-kit @types/pg
```

추가할 명령의 목표 예시는 다음과 같다.

```text
db:generate  스키마 변경으로 SQL 마이그레이션 생성
db:migrate   생성된 마이그레이션 적용
db:seed      개발용 기준 데이터 적재
db:check     DB 연결과 현재 마이그레이션 상태 확인
```

## 6. 기초 테이블 설계

### 6.1 `students`

인증 전 단계의 내부 학생 레코드다. 이름, 이메일, 전화번호 같은 실제 개인정보는 저장하지 않는다.

| 컬럼 | 형식 | 제약 | 설명 |
| --- | --- | --- | --- |
| `id` | `varchar` | PK | 현재 `studentId`와 연결되는 내부 식별자 |
| `display_name` | `varchar` | nullable | 데모 표시용 이름 |
| `status` | `varchar` | not null | `active`, `inactive` |
| `created_at` | `timestamptz` | not null | 생성 시각 |
| `updated_at` | `timestamptz` | not null | 수정 시각 |

초기 seed에는 현재 기본 학생인 `000`을 추가한다.

### 6.2 `courses`

현재 JSON 강좌 카탈로그의 강좌 정보를 저장한다.

| 컬럼 | 형식 | 제약 | 설명 |
| --- | --- | --- | --- |
| `id` | `varchar` | PK | 강좌 식별자 |
| `provider_id` | `varchar` | not null | 제공자 식별자 |
| `provider_name` | `varchar` | not null | 제공자 표시명 |
| `instructor_id` | `varchar` | not null | 강사 식별자 |
| `instructor_name` | `varchar` | not null | 강사 표시명 |
| `title` | `varchar` | not null | 강좌명 |
| `primary_subject` | `varchar` | not null | 대표 과목 |
| `included_subjects` | `jsonb` | not null | 포함 과목 목록 |
| `curriculum_year` | `integer` | not null | 교육과정 연도 |
| `lesson_count` | `integer` | not null | 전체 항목 수 |
| `orientation_count` | `integer` | not null | 오리엔테이션 수 |
| `content_lesson_count` | `integer` | not null | 실제 강의 수 |
| `total_duration_seconds` | `integer` | not null | 전체 재생 시간 |
| `source_url` | `text` | nullable | 원본 출처 주소 |
| `status` | `varchar` | not null | 현재는 `metadata_only` |
| `created_at` | `timestamptz` | not null | 생성 시각 |
| `updated_at` | `timestamptz` | not null | 수정 시각 |

### 6.3 `lessons`

강좌에 포함된 원본 강의 목록을 저장한다.

| 컬럼 | 형식 | 제약 | 설명 |
| --- | --- | --- | --- |
| `id` | `varchar` | PK | 강의 식별자 |
| `course_id` | `varchar` | FK | `courses.id` 참조 |
| `sequence` | `integer` | not null | 강좌 내 정렬 순서 |
| `lecture_number` | `integer` | nullable | 원본 강의 번호 |
| `title` | `varchar` | not null | 강의명 |
| `lesson_type` | `varchar` | not null | `orientation`, `lecture`, `mock_exam` |
| `subject_areas` | `jsonb` | not null | 과목 영역 목록 |
| `unit_names` | `jsonb` | not null | 단원명 목록 |
| `duration_display` | `varchar` | not null | 원본 표시 시간 |
| `duration_seconds` | `integer` | not null | 초 단위 재생 시간 |
| `source_url` | `text` | nullable | 원본 출처 주소 |
| `playback_target_id` | `varchar` | nullable | 재생 대상 식별자 |
| `created_at` | `timestamptz` | not null | 생성 시각 |
| `updated_at` | `timestamptz` | not null | 수정 시각 |

필수 제약과 인덱스:

```text
FK lessons.course_id → courses.id
UNIQUE lessons(course_id, sequence)
INDEX lessons(course_id)
INDEX lessons(course_id, lesson_type)
```

### 6.4 `student_learning_states`

학생별 진도 운영 상태를 보관한다. 첫 DB 단계에서는 변화가 잦은 상태를 `jsonb` aggregate로 저장해 과도한 정규화를 피한다.

| 컬럼 | 형식 | 제약 | 설명 |
| --- | --- | --- | --- |
| `student_id` | `varchar` | PK, FK | `students.id` 참조 |
| `revision` | `integer` | not null | 상태 변경 충돌 검사 값 |
| `state_json` | `jsonb` | not null | `StudentContext`와 보강·연기 상태 |
| `created_at` | `timestamptz` | not null | 생성 시각 |
| `updated_at` | `timestamptz` | not null | 수정 시각 |

초기 `state_json`에는 다음 데이터를 저장한다.

```text
selectedCurriculumId
currentStepId
completedStepIds
delayedStepIds
weakConcepts
completedLessonItemIds
lowFocusRecorded
maxSessionMinutes
deferredLessonItemIds
remediationItems
```

### 6.5 `lesson_feedback_events`

강의별 이해도·집중도 제출을 이력으로 남긴다.

| 컬럼 | 형식 | 제약 | 설명 |
| --- | --- | --- | --- |
| `id` | `uuid` | PK | 피드백 이벤트 식별자 |
| `student_id` | `varchar` | FK | 학생 식별자 |
| `lesson_item_id` | `varchar` | not null | 피드백 대상 학습 항목 |
| `understanding_level` | `integer` | not null | 이해도 값 |
| `focus_level` | `integer` | not null | 집중도 값 |
| `reason_codes` | `jsonb` | not null | 규칙 엔진 판단 코드 |
| `created_at` | `timestamptz` | not null | 기록 시각 |

`lesson_item_id`는 초기에는 사전 정의 커리큘럼 항목도 가리킬 수 있으므로 `lessons.id` 외래 키로 강제하지 않는다. 강좌 카탈로그와 학습 항목 모델이 통합된 뒤 제약을 강화한다.

### 6.6 `session_adjustment_proposals`

오늘 수업 조율 제안과 확정 상태를 보관한다.

| 컬럼 | 형식 | 제약 | 설명 |
| --- | --- | --- | --- |
| `id` | `varchar` | PK | 조율 제안 식별자 |
| `student_id` | `varchar` | FK | 학생 식별자 |
| `base_revision` | `integer` | not null | 제안 생성 당시 revision |
| `proposal_json` | `jsonb` | not null | 제안 전후 상태와 설명 |
| `status` | `varchar` | not null | `pending`, `confirmed`, `expired`, `cancelled` |
| `created_at` | `timestamptz` | not null | 생성 시각 |
| `confirmed_at` | `timestamptz` | nullable | 확정 시각 |

필수 인덱스:

```text
INDEX session_adjustment_proposals(student_id, status)
INDEX session_adjustment_proposals(created_at)
```

## 7. 후속 테이블

다음 테이블은 기초 조회와 학생 상태 영속화가 완료된 뒤 추가한다.

```text
curriculums
curriculum_steps
curriculum_step_items
student_curriculum_plans
conversation_threads
conversation_messages
```

사전 정의 커리큘럼까지 한 번에 DB로 옮기면 강좌 카탈로그 전환과 진도 규칙 전환이 섞이므로 첫 마이그레이션에서는 제외한다.

## 8. 백엔드 저장소 구조

DB 드라이버를 Fastify 라우트나 규칙 엔진에서 직접 호출하지 않는다.

권장 구조:

```text
apps/api/src/
  db/
    client.ts
    schema.ts
    migrate.ts
    seed.ts
  students/
    student.types.ts
    student.repository.ts
    student.postgres-repository.ts
  course-catalog/
    course-catalog.types.ts
    course-catalog.file-repository.ts
    course-catalog.postgres-repository.ts
  progress/
    progress.repository.ts
    progress.memory-repository.ts
    progress.postgres-repository.ts
    progress.service.ts
```

저장소 인터페이스 예시:

```ts
type StudentRepository = {
  findById(studentId: string): Promise<Student | undefined>;
};

type CourseCatalogRepository = {
  listCourses(): Promise<CourseCatalogCourse[]>;
  getCourseCatalog(courseId: string): Promise<CourseCatalog | undefined>;
  getDefaultCourseCatalog(): Promise<CourseCatalog>;
};

type ProgressStateRepository = {
  findByStudentId(studentId: string): Promise<PersistedLearningState | undefined>;
  save(
    state: PersistedLearningState,
    expectedRevision: number,
  ): Promise<PersistedLearningState>;
};
```

PostgreSQL I/O는 비동기이므로 현재 동기식 `CourseCatalogRepository`와 `ProgressService` 메서드를 `Promise` 기반으로 전환해야 한다. 라우트에서는 각 서비스 호출을 `await`한다.

## 9. API 전환 계획

새로운 DB 전용 공개 API를 무분별하게 추가하지 않고 기존 도메인 API의 데이터 원본을 교체한다.

### 9.1 학생 조회

현재 API:

```text
GET /api/student-context?studentId={studentId}
```

처리 흐름:

```text
studentId 검증
→ students 조회
→ student_learning_states 조회
→ 없으면 명시적인 초기화 정책 실행
→ StudentContext 응답으로 변환
```

학생 원본 정보 조회가 실제 화면에 필요해질 때만 `GET /api/students/:studentId`를 추가한다. 현재 데모에는 학생 프로필 화면이 없으므로 우선순위는 낮다.

### 9.2 강좌 목록

기존 `GET /api/course-catalogs`의 데이터 원본만 교체한다.

```text
파일 JSON 읽기
→ CourseCatalogRepository.listCourses()
→ PostgreSQL courses 조회
→ 기존 CourseCatalogCourse 응답 유지
```

### 9.3 강좌와 강의 목록

기존 `GET /api/course-catalogs/:courseId`를 다음처럼 전환한다.

```text
courses에서 강좌 조회
→ lessons에서 course_id 기준 조회
→ sequence 오름차순 정렬
→ CourseCatalog 응답으로 조립
```

없는 강좌는 기존과 동일하게 `404`를 반환한다.

### 9.4 커리큘럼 추천

기존 `POST /api/curriculum-recommendations`는 강좌·강의 목록을 PostgreSQL 저장소에서 조회한 뒤 기존 규칙 기반 추천 서비스에 전달한다. DB 조회와 추천 규칙을 같은 모듈에 섞지 않는다.

### 9.5 상태 변경 API

다음 API는 학생 상태 영속화 단계에서 PostgreSQL 트랜잭션으로 전환한다.

```text
POST /api/student-context/curriculum
POST /api/lesson-feedback
POST /api/session-adjustments/:adjustmentId/confirm
POST /api/progress-tools/execute
POST /api/curriculum-tools/execute의 계획 적용 동작
```

각 성공 응답은 기존 `LearningSnapshot` 계약을 유지한다.

## 10. seed 계획

개발용 데이터는 HTTP API가 아니라 seed 명령으로 넣는다.

초기 seed 대상:

```text
students: 데모 학생 000
courses: 현재 JSON 카탈로그의 강좌
lessons: 현재 JSON 카탈로그의 강의 목록
```

seed 규칙:

- [ ] 같은 seed를 여러 번 실행해도 중복 데이터가 생기지 않는다.
- [ ] 기본 키 기준 `insert ... on conflict` 정책을 명시한다.
- [ ] 운영 데이터나 실제 개인정보를 포함하지 않는다.
- [ ] 원본 JSON과 적재된 강의 수·총 시간이 같은지 검증한다.
- [ ] seed 실패 시 일부 데이터만 남지 않도록 트랜잭션으로 처리한다.

## 11. 작업 단계

### 단계 1. DB 실행 기반 고정

- [x] 현재 Docker 컨테이너의 PostgreSQL 메이저·패치 버전을 확인한다.
- [x] `compose.yaml`에 고정 이미지 태그, named volume, healthcheck를 정의한다.
- [x] `.env.db.example`에는 변수 이름만 기록한다.
- [ ] 실제 `.env.db.local`과 `DATABASE_URL`은 Git에서 제외한다.
- [ ] DB 시작·중지·상태 확인 명령을 문서화한다.

완료 기준:

```text
새 개발환경에서 문서만 보고 PostgreSQL 컨테이너를 실행할 수 있다.
컨테이너를 재생성해도 named volume의 데이터가 유지된다.
```

### 단계 2. DB 클라이언트와 마이그레이션 구성

- [x] `pg`, `drizzle-orm`, `drizzle-kit`, `@types/pg`를 API 패키지에 추가한다.
- [x] `DATABASE_URL` 검증을 백엔드 설정 계층에 추가한다.
- [x] 개발·테스트용 연결 풀 생성과 종료 처리를 구현한다.
- [ ] DB 연결 실패 시 서버가 명확한 오류로 시작을 중단하도록 한다.
- [x] 마이그레이션 생성·적용 명령을 추가한다.

완료 기준:

```text
백엔드에서 SELECT 1 연결 검증이 성공한다.
마이그레이션 명령을 반복 실행해도 안전하다.
```

### 단계 3. 기초 스키마 생성

- [x] `students` 테이블을 만든다.
- [x] `courses` 테이블을 만든다.
- [x] `lessons` 테이블을 만든다.
- [x] `student_learning_states` 테이블을 만든다.
- [x] `lesson_feedback_events` 테이블을 만든다.
- [x] `session_adjustment_proposals` 테이블을 만든다.
- [ ] FK, unique, check, index를 추가한다.
- [ ] 초기 마이그레이션 SQL을 검토한다.

완료 기준:

```text
빈 DB에 한 번의 마이그레이션 명령으로 모든 기초 테이블이 생성된다.
pgAdmin에서 테이블, FK, 인덱스를 확인할 수 있다.
```

### 단계 4. 기준 데이터 seed

- [x] 데모 학생 `000`을 추가한다.
- [x] 기존 강좌 JSON을 읽어 `courses`에 적재한다.
- [x] 기존 강의 JSON을 읽어 `lessons`에 적재한다.
- [ ] 중복 실행 안전성을 보장한다.
- [ ] 원본과 DB의 강의 수·순서·총 시간을 비교하는 테스트를 추가한다.

완료 기준:

```text
pgAdmin에서 데모 학생, 강좌, 전체 강의 목록을 확인할 수 있다.
seed를 두 번 실행해도 레코드 수가 증가하지 않는다.
```

### 단계 5. 강좌·강의 조회 저장소 전환

- [x] `CourseCatalogRepository`를 비동기 인터페이스로 변경한다.
- [ ] 기존 파일 저장소가 새 인터페이스를 계속 만족하게 한다.
- [x] `PostgresCourseCatalogRepository`를 구현한다.
- [ ] 의존성 주입으로 저장소 구현을 선택하도록 한다.
- [ ] `GET /api/course-catalogs`를 DB 저장소로 검증한다.
- [ ] `GET /api/course-catalogs/:courseId`를 DB 저장소로 검증한다.
- [ ] 추천 서비스가 DB에서 받은 강의 순서를 그대로 사용하게 한다.

완료 기준:

```text
기존 파일 저장소와 PostgreSQL 저장소가 동일한 API 응답을 반환한다.
프론트 변경 없이 강좌·강의 목록을 조회할 수 있다.
```

### 단계 6. 학생 상태 저장소 전환

- [x] `ProgressStateRepository` 인터페이스를 만든다.
- [ ] 현재 `Map` 사용을 `MemoryProgressStateRepository`로 옮긴다.
- [x] `PostgresProgressStateRepository`를 구현한다.
- [ ] 학생 상태가 없을 때의 초기화 정책을 고정한다.
- [ ] 커리큘럼 선택 결과를 DB에 저장한다.
- [ ] 강의별 피드백 이벤트와 최신 상태를 같은 트랜잭션에 저장한다.
- [ ] 상태 변경마다 revision이 정확히 한 번 증가하도록 한다.

완료 기준:

```text
API 서버를 재시작해도 선택한 커리큘럼과 완료 강의가 복구된다.
기존 LearningSnapshot 응답 구조가 유지된다.
```

### 단계 7. 조율 제안 트랜잭션 전환

- [x] 조율 제안을 `session_adjustment_proposals`에 저장한다.
- [x] 확정 시 학생과 조율안 행을 트랜잭션 안에서 조회한다.
- [ ] `base_revision`과 현재 revision을 비교한다.
- [ ] `pending` 제안만 한 번 확정할 수 있게 한다.
- [ ] 충돌 시 상태를 변경하지 않고 `409`와 최신 snapshot을 반환한다.
- [ ] 성공 시 학생 상태와 제안 상태를 원자적으로 갱신한다.

완료 기준:

```text
동일한 조율안의 중복 확정이 방지된다.
서버 인스턴스가 달라도 revision 충돌 방지가 유지된다.
```

### 단계 8. 테스트와 문서 마감

- [x] 스키마와 seed 테스트를 추가한다.
- [x] PostgreSQL 저장소 통합 테스트를 추가한다.
- [ ] DB를 사용하는 Fastify 앱 주입 테스트를 추가한다.
- [ ] 서버 재시작 상태 복구 시나리오를 검증한다.
- [ ] 연결 실패, 마이그레이션 누락, revision 충돌을 검증한다.
- [ ] README와 백엔드 API 문서를 DB 기준으로 갱신한다.
- [ ] 로컬 DB 초기화와 복구 절차를 문서화한다.

## 12. 테스트 전략

### 단위 테스트

```text
규칙 기반 오늘 수업 생성
피드백 분석
추천 항목 action 결정
DB 행과 도메인 타입 간 mapper
```

단위 테스트에서는 메모리 저장소를 사용할 수 있다.

### 저장소 통합 테스트

```text
학생 생성·조회
강좌·강의 순서 조회
revision 조건부 저장
피드백 이벤트 기록
조율안 중복 확정 방지
트랜잭션 실패 시 롤백
```

### API 계약 테스트

```text
GET /api/course-catalogs
GET /api/course-catalogs/:courseId
GET /api/student-context
POST /api/student-context/curriculum
POST /api/lesson-feedback
POST /api/session-adjustments/:adjustmentId/confirm
```

API 테스트는 테이블 행 자체가 아니라 기존 JSON 응답 계약과 상태 코드를 검증한다.

## 13. 데이터 및 보안 원칙

```text
프론트는 DATABASE_URL을 알지 못한다.
DB 비밀번호는 Git에 기록하지 않는다.
현재 studentId는 인증된 사용자 식별자가 아니라 데모용 내부 ID다.
학생 이름·이메일·전화번호·실제 성적은 저장하지 않는다.
SQL 문자열을 요청값으로 직접 조립하지 않는다.
조회와 변경은 파라미터 바인딩 또는 ORM을 사용한다.
운영 단계에서는 앱 전용 최소 권한 DB 사용자를 별도로 만든다.
```

Docker 공식 이미지의 `POSTGRES_USER`는 초기 관리 사용자 성격이므로, 로컬 데모에는 사용할 수 있지만 외부 배포 전에 마이그레이션 권한과 앱 실행 권한을 분리한다.

## 14. 장애 및 복구 원칙

### DB 연결 실패

```text
서버 시작 시 DB 모드를 선택했다면 조용히 메모리 저장소로 대체하지 않는다.
명확한 연결 오류를 출력하고 서버 시작을 중단한다.
```

### 마이그레이션 누락

```text
필수 테이블이나 마이그레이션이 없으면 API가 임의로 테이블을 만들지 않는다.
마이그레이션 명령을 실행하도록 안내한다.
```

### 개발 데이터 초기화

named volume 삭제는 데이터 전체 삭제이므로 명시적인 개발용 초기화 명령으로만 수행한다. 일반적인 `docker compose down`에는 볼륨 삭제 옵션을 포함하지 않는다.

## 15. 구현 완료 기준

다음 조건을 모두 만족하면 첫 DB 단계를 완료한 것으로 본다.

```text
마이그레이션으로 기초 테이블을 재현할 수 있다.
seed로 데모 학생과 강좌·강의 목록을 재현할 수 있다.
강좌·강의 API가 PostgreSQL에서 데이터를 조회한다.
학생의 커리큘럼 선택과 강의 완료 상태가 서버 재시작 뒤 유지된다.
피드백 이벤트가 이력으로 남는다.
상태 변경은 revision과 트랜잭션으로 보호된다.
조율 제안은 한 번만 확정된다.
기존 프론트 API 계약을 불필요하게 변경하지 않는다.
DB 연결 실패를 메모리 fallback으로 숨기지 않는다.
기존 규칙 기반 진도 운영 테스트와 신규 DB 통합 테스트가 모두 통과한다.
```

## 16. 권장 커밋 단위

```text
docs : [DB] 기초 구축 계획 정리
chore : [DB] PostgreSQL 개발환경과 마이그레이션 구성
feat : [DB] 학생·강좌·강의 기초 스키마 추가
feat : [DB] 강좌 카탈로그 PostgreSQL 저장소 추가
feat : [DB] 학생 학습 상태 영속화
feat : [DB] 조율 제안 트랜잭션 적용
test : [DB] PostgreSQL 저장소 통합 테스트 추가
docs : [DB] 실행과 복구 절차 업데이트
```

위 구현과 관련된 커밋은 DB 전담 대화 세션이 직접 생성한다. 프론트 세션과 백엔드 세션은 DB 세션 소유 파일을 자신의 커밋에 포함하지 않는다.

DB 세션은 작업 범위의 파일만 명시적으로 스테이징하며 프론트 변경, 실제 LLM 작업, DB 전환과 무관한 백엔드 기능 변경을 섞지 않는다. `apps/api/package.json`, `pnpm-lock.yaml`, `docs/`처럼 공유되는 파일은 DB 관련 변경만 포함됐는지 전체 diff를 확인한다.

## 17. 관련 문서

```text
README.md
AGENTS.md
docs/domain-model.md
docs/backend-api-foundation.md
docs/backend-api-guide.md
docs/curriculum-recommendation-algorithm.md
docs/pre-llm-integration-checklist.md
docs/project-structure.md
```
