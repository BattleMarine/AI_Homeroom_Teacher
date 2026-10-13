# PostgreSQL 개발 운영

현재 코드의 DB 실행·복구 안내다. 기존 과목별 스키마가 새 전체 일정 설계의 정답이라는 뜻은 아니다. 구조의 실제 기준은 `apps/api/src/db/schema.ts`와 `migrations/`다.

## 준비와 실행

1. [개발환경 안내](./local-development-bootstrap-guide.md)에 따라 `.env.db.local`을 준비한다.
2. Docker Desktop을 실행한다. 기존 DB를 사용할 때는 접속 대상과 데이터 보존 여부를 먼저 확인한다.
3. 저장소 compose를 사용할 경우:

```bash
docker compose --env-file .env.db.local up -d db
docker compose ps
```

이미 별도 컨테이너를 사용한다면 중복 생성하지 않는다. 포트·volume·이미지는 `compose.yaml`을 기준으로 확인한다. 기존 volume의 비밀번호는 환경 파일 수정만으로 바뀌지 않는다.

## 마이그레이션·seed

DB 관리 명령은 API 개발 실행기와 달리 `.env.db.local`을 자동으로 읽지 않는다. 신뢰하는 로컬 파일을 셸에 로드하거나 안전하게 DATABASE_URL을 전달한다.

WSL Bash 예시:

```bash
set -a
source .env.db.local
set +a
pnpm --filter @ai-homeroom/api db:check
pnpm --filter @ai-homeroom/api db:migrate
pnpm --filter @ai-homeroom/api db:seed
```

PowerShell에서도 같은 환경 변수가 필요하다. 비밀번호를 명령문·히스토리·출력에 직접 적지 말고 로컬 환경 파일을 안전하게 로드한다.

- `db:check`: 연결 확인이며 스키마·제품 기능 전체 검증이 아니다.
- `db:migrate`: 현재 브랜치의 SQL migration을 적용한다. 적용 이력이나 SQL을 수동 조작하지 않는다.
- `db:seed`: 카탈로그와 검증용 초기 데이터를 적재한다. 새 검증 DB에서 먼저 사용하고 기존 DB에는 변경 범위·멱등성을 확인한 뒤 적용한다.

안정형·압축형·문제적용형 seed는 검증 자료이지 제품의 고정 계획 유형이 아니다.

## API 실행

```bash
pnpm dev:api
```

PostgreSQL 모드가 기본이며 실행기는 DB 연결과 현재 migration 누락을 검사한다. 실패하면 시작을 중단한다. 메모리 모드는 `pnpm dev:api-memory`로 명시한다.

브랜치 변경은 DB 스키마를 되돌리지 않는다. 이전 브랜치의 추가 migration·데이터가 남아 있다면 호환성을 확인하거나 별도 DB에서 이 브랜치를 검증한다. DB 삭제를 해결책으로 자동 실행하지 않는다.

## DB 테스트 안전 조건

현재 `apps/api/test/db.integration.test.ts`는 **DATABASE_URL**을 읽는다. 전용 테스트 URL 변수의 자동 분리를 가정하지 않는다. URL이 없으면 DB 테스트가 skip될 수 있으며 이것은 통과가 아니다.

1. 개발·실제 데이터와 분리된 테스트 전용 DB를 준비한다.
2. 별도 셸에서 DATABASE_URL을 해당 전용 DB로 지정한다. 실제 값은 출력하지 않는다.
3. 현재 migration·필요 seed와 테스트의 데이터 삭제 범위를 확인한다.
4. 아래 명령을 실행하고 통과·실패·skip·정리 결과를 구분해 보고한다.

```bash
pnpm --filter @ai-homeroom/api test:db
```

기존 테스트는 고정 fixture ID의 행을 삭제할 수 있다. 학생 ID만 다르면 안전하다고 가정하지 않는다. 검증 후 API를 실행할 때 테스트 DB 환경이 남아 있지 않은지 확인한다.

전체 일정 검사는 `.env.learning-plan-test.local`의 전용 DB 설정을 사용한다. 허용 변수·전용 DB 식별·정리 범위는 [저장 계약](./learning-plan-persistence.md)의 실행 조건을 따른다. 같은 DB에 쓰는 검사는 순차 실행하며 개발 API의 환경과 섞지 않는다.

```bash
pnpm --filter @ai-homeroom/api test:db:learning-plan
pnpm --filter @ai-homeroom/api verify:learning-plan
pnpm --filter @ai-homeroom/api verify:learning-plan:distribution-http
```

기간 분산 HTTP 검사는 실제 카탈로그 전체와 자체 생성한 가상학생으로 제안·확정·부분 수강·완료·피드백을 검증하고, API·독립 SQL·실제 서버 프로세스 재시작 결과를 대조한 뒤 자체 데이터를 정리한다. 모델은 호출하지 않는다. DB 없는 공개 파일 카탈로그 품질 검사는 `pnpm --filter @ai-homeroom/api verify:learning-plan:distribution`으로 실행한다. 지표·허용 편차·전후 결과는 [로드맵](./learning-plan-roadmap.md)의 기간 전체 분산 절을 따른다.

## 중지·복구

일반 중지는 `docker compose stop db`를 사용한다. volume 삭제·DB 초기화·파괴적 migration은 대상과 복구 수단을 확인하고 사용자 승인 후 수행한다. 이 문서는 초기화를 자동 실행할 권한을 부여하지 않는다.

실제 접속 정보·dump·volume·로그는 Git에 넣지 않는다. DB 오류를 메모리 상태로 대체하지 말고 원인과 차단 조건을 보고한다.
