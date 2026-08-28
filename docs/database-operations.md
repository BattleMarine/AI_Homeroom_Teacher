# PostgreSQL 개발 환경 실행과 복구

## 목적

이 문서는 AI 담임 데모 백엔드의 PostgreSQL 개발 환경을 실행하고, 스키마·기준 데이터를 재현하며, 학습 상태 복구를 확인하는 절차를 설명합니다.

PostgreSQL은 강좌·강의 카탈로그, 학생별 커리큘럼과 버전 이력, 학생별 학습 상태와 revision, 강의별 피드백 이력, 오늘 수업 조율 제안을 저장합니다. 규칙 기반 진도 판단 로직은 계속 애플리케이션 코드가 담당합니다.

## 준비

1. Docker Desktop을 실행합니다.
2. `.env.db.example`을 복사해 `.env.db.local`을 만듭니다.
3. `.env.db.local`에 로컬 전용 `POSTGRES_PASSWORD`와 `DATABASE_URL`을 설정합니다.

```powershell
Copy-Item .env.db.example .env.db.local
```

`.env.db.local`과 실제 접속 문자열은 Git에 커밋하지 않습니다.

## PostgreSQL 실행

```powershell
docker compose --env-file .env.db.local up -d db
docker compose ps
```

컨테이너 이름은 `ai-homeroom-postgres`이며, 로컬 `127.0.0.1:5432`에서만 포트를 노출합니다. named volume `ai_homeroom_postgres_data`는 일반적인 `docker compose down` 이후에도 유지됩니다.

## 스키마와 기준 데이터 적용

현재 PowerShell 세션에만 `DATABASE_URL`을 설정한 뒤 아래 명령을 실행합니다.

```powershell
$env:DATABASE_URL = "postgresql://사용자:비밀번호@127.0.0.1:5432/데이터베이스"
pnpm --filter @ai-homeroom/api db:migrate
pnpm --filter @ai-homeroom/api db:seed
pnpm --filter @ai-homeroom/api db:check
```

- `db:migrate`: `apps/api/src/db/migrations/`의 SQL을 순서대로 한 번만 적용합니다.
- `db:seed`: 데모 학생 `000`, JSON 강좌·강의 목록(2026 수학+미적분 52강, 2027 국어 언어와 매체 36강, 2027 영어 41강), 안정형·압축형·문제적용형 후보 커리큘럼을 멱등 방식으로 적재합니다.
- `db:check`: `SELECT 1`로 DB 연결을 확인합니다.

`db:migrate`와 `db:seed`는 반복 실행해도 안전합니다.

후보 커리큘럼은 모두 `candidate` 상태로 생성됩니다. 각 후보의 pace·소개·추천 대상·AI 담임 안내는 `student_curricula.presentation_json`에 저장됩니다. 학생이 선택하면 같은 과목의 기존 `active` 후보는 다시 `candidate`가 되고, 선택한 하나만 `active`가 됩니다. 선택 상태, 해당 과목의 `student_learning_states.state_json`, 두 revision은 하나의 트랜잭션에서 함께 갱신됩니다. 표시명은 기존 API와 동일하게 `문제적용형`을 사용하며 내부 ID `practice-log`는 유지합니다.

구조를 바꾸는 작업은 기존 `curriculum_versions`·`curriculum_steps`·`curriculum_items` 행을 수정하지 않습니다. 새 버전을 저장한 뒤 `student_curricula.current_version_id`, 과목별 실행 상태와 revision을 같은 트랜잭션에서 갱신합니다. `curriculum_steps.source_id`, `curriculum_items.source_id`는 API·규칙 엔진용 원본 식별자를 보존하므로 DB ID 문자열을 파싱하지 않습니다. `lecture` 항목에는 존재하는 `lessons.id`가 필수이며, 기준 강좌에 재생 대상이 비어 있을 때 seed는 결정적인 `mock-video:<lessonId>` 재생 대상을 DB에 보완합니다.

## 커리큘럼 읽기 모델

`GET /api/curriculum-read-model?studentId=...`은 활성 커리큘럼의 presentation·현재 버전·단계·항목과 같은 과목의 실행 상태를 하나의 읽기 전용 repeatable-read 트랜잭션에서 반환합니다.

활성 커리큘럼이 없으면 `GET /api/learning-snapshot`과 읽기 모델 API는 아래 응답으로 선택 화면 전환을 요청합니다.

```text
HTTP 409
code = CURRICULUM_SELECTION_REQUIRED
```

## API를 PostgreSQL 모드로 실행

```powershell
$env:PERSISTENCE_MODE = "postgres"
$env:DATABASE_URL = "postgresql://사용자:비밀번호@127.0.0.1:5432/데이터베이스"
$env:API_HOST = "127.0.0.1"
$env:API_PORT = "3001"
pnpm --filter @ai-homeroom/api dev
```

`PERSISTENCE_MODE=postgres`에서는 서버가 시작 전에 DB 연결을 검증합니다. 연결 또는 마이그레이션이 누락됐을 때 메모리 저장소로 자동 전환하지 않으며, 원인을 알 수 있는 오류와 함께 시작을 중단합니다.

`PERSISTENCE_MODE`를 생략하거나 `memory`로 설정하면 기존 파일·메모리 저장소를 사용합니다.

## 검증

```powershell
pnpm --filter @ai-homeroom/api test
$env:DATABASE_URL = "postgresql://사용자:비밀번호@127.0.0.1:5432/데이터베이스"
pnpm --filter @ai-homeroom/api test:db
```

DB 통합 테스트는 다음을 검증합니다.

- 강좌·강의 카탈로그의 PostgreSQL 조회
- 커리큘럼 선택과 강의 피드백 뒤 서버 재시작 상태 복구
- revision 증가와 피드백 이벤트 기록
- 조율안의 한 번만 확정 처리와 오래된 revision의 `409` 응답
- 후보 커리큘럼 하나만 활성화되는 선택 처리
- 커리큘럼 새 버전 저장 시 이전 버전 보존, 잘못된 강의 연결의 전체 롤백
- 선택 전 `409 CURRICULUM_SELECTION_REQUIRED`와 원자적 선택·실행 상태 갱신
- presentation 메타데이터·sourceId를 포함한 repeatable-read 읽기 모델

## 개발 데이터 초기화

아래 명령은 named volume과 모든 로컬 DB 데이터를 삭제합니다. 개발 데이터를 완전히 초기화할 때만 명시적으로 실행합니다.

```powershell
docker compose --env-file .env.db.local down -v
```

초기화 뒤에는 컨테이너를 다시 실행하고 `db:migrate`, `db:seed`를 순서대로 실행합니다.
