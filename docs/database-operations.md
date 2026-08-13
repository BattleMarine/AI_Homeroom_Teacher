# PostgreSQL 개발 환경 실행과 복구

## 목적

이 문서는 AI 담임 데모 백엔드의 PostgreSQL 개발 환경을 실행하고, 스키마·기준 데이터를 재현하며, 학습 상태 복구를 확인하는 절차를 설명합니다.

PostgreSQL은 강좌·강의 카탈로그, 학생별 학습 상태와 revision, 강의별 피드백 이력, 오늘 수업 조율 제안을 저장합니다. 사전 정의 커리큘럼과 규칙 기반 진도 판단 로직은 계속 애플리케이션 코드가 담당합니다.

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
- `db:seed`: 데모 학생 `000`과 JSON 기준 강좌·강의 목록을 멱등 방식으로 적재합니다.
- `db:check`: `SELECT 1`로 DB 연결을 확인합니다.

`db:migrate`와 `db:seed`는 반복 실행해도 안전합니다.

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

## 개발 데이터 초기화

아래 명령은 named volume과 모든 로컬 DB 데이터를 삭제합니다. 개발 데이터를 완전히 초기화할 때만 명시적으로 실행합니다.

```powershell
docker compose --env-file .env.db.local down -v
```

초기화 뒤에는 컨테이너를 다시 실행하고 `db:migrate`, `db:seed`를 순서대로 실행합니다.
