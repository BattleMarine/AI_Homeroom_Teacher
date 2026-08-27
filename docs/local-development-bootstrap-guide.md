# 로컬 개발환경 복구 및 실행 파일 생성 가이드

## 문서 목적

이 문서는 Git 저장소만 받은 새 Windows·WSL 개발환경에서 현재 프로젝트를 다시 실행하기 위한 설계도다.

API 주소, DB 접속 문자열, 비밀번호와 로컬 협업 기록은 보안과 환경 차이 때문에 Git에 포함하지 않는다. 대신 이 문서에서 다음 내용을 정의한다.

```text
Git에서 복원되는 파일
로컬에서 새로 만들어야 하는 파일
각 로컬 파일의 필드와 값 결정 방법
Docker PostgreSQL 재구성 절차
마이그레이션과 seed 적용 순서
프론트·백엔드 실행 방법
새 환경이 정상인지 판정하는 방법
사람 또는 AI 에이전트가 지켜야 할 보안 규칙
```

이 문서는 실제 비밀값을 전달하지 않는다. 새 환경의 작업자는 자신의 로컬 값으로 파일을 생성한다.

---

## 1. 현재 실행 구조

현재 기본 개발 흐름은 다음과 같다.

```text
브라우저
→ Vite 프론트엔드
→ /api 개발 프록시
→ Fastify API
→ PostgreSQL repository
→ Docker PostgreSQL
```

기본 개발 명령의 의미는 다음과 같다.

| 명령 | 실행 대상 | PostgreSQL 필요 |
| --- | --- | --- |
| `pnpm dev` | 프론트 + PostgreSQL 백엔드 | 필요 |
| `pnpm dev:front` | 프론트만 | 불필요하지만 API 기능 사용 불가 |
| `pnpm dev:api` | PostgreSQL 백엔드 | 필요 |
| `pnpm dev:api-postgresql` | `dev:api` 별칭 | 필요 |
| `pnpm dev:api-memory` | 메모리 백엔드 | 불필요 |

일상적인 개발 기준은 `pnpm dev`다. 메모리 모드는 DB 장애를 숨기는 대체 경로가 아니라 명시적인 테스트·개발 예외 모드다.

---

## 2. Git 파일과 로컬 파일의 책임 구분

### Git에서 복원되는 항목

다음 항목은 저장소 clone으로 복원되어야 한다.

| 항목 | 역할 | 새 환경 조치 |
| --- | --- | --- |
| `package.json` | 루트 실행 명령과 프론트 의존성 | 수정하지 않고 `pnpm install` |
| `pnpm-lock.yaml` | 고정된 의존성 버전 | 반드시 사용 |
| `pnpm-workspace.yaml` | 워크스페이스 구성 | 그대로 사용 |
| `apps/api/package.json` | API·DB 명령과 의존성 | 그대로 사용 |
| `apps/api/scripts/dev-server.mjs` | 로컬 DB 환경 파일 로드와 사전 검사 | 그대로 사용 |
| `vite.config.ts` | 프론트 개발 서버와 `/api` 프록시 | 현재 API 포트 계약과 함께 확인 |
| `compose.yaml` | PostgreSQL 컨테이너 기준 | Docker에서 재생성 |
| `apps/api/src/db/schema.ts` | 애플리케이션 DB 스키마 정의 | 직접 실행 파일이 아님 |
| `apps/api/src/db/migrations/` | DB 구조 재현 | 순서대로 적용 |
| `apps/api/src/db/seed.ts` | 검증용 초기 데이터 | 빈 개발 DB에 적용 |
| `apps/api/src/config.ts` | 서버 환경 변수 계약 | 로컬 파일 작성 시 기준 |
| `apps/api/src/server.ts` | 저장소 모드 선택과 서버 기동 | PostgreSQL 연결 검사 포함 |
| `docs/database-operations.md` | DB 운영 상세 절차 | 이 문서와 함께 참고 |

Git에 포함된 스키마·마이그레이션·seed가 있으면 Docker volume 자체를 복사하지 않아도 검증 가능한 새 DB를 만들 수 있다.

### Git에서 제외되며 새 환경에서 생성해야 하는 항목

| 로컬 항목 | 실행 필수 여부 | 복구 방법 |
| --- | --- | --- |
| `.env.db.local` | PostgreSQL 모드에 필수 | 이 문서의 계약에 따라 생성 |
| PostgreSQL 컨테이너 | PostgreSQL 모드에 필수 | `compose.yaml` 또는 Docker Desktop으로 생성 |
| PostgreSQL volume 데이터 | 기존 진행 상태 복원 시에만 필요 | 새 검증환경은 migration+seed로 재생성 |
| `node_modules/` | 실행에 필요하지만 Git 불필요 | `pnpm install`로 재생성 |
| 브라우저 `localStorage` | 실행 자체에는 불필요 | 새 브라우저에서 다시 생성 |
| `docs/secrets/` | 선택 사항 | 개인 운영 메모가 필요할 때만 생성 |
| `docs/claims/` 개별 문서 | 실행에 불필요 | 세션 간 로컬 협업 기록 |
| 로그·빌드 산출물 | 실행에 불필요 | 실행·빌드 과정에서 재생성 |

### 복사하지 말아야 하는 항목

```text
실제 DATABASE_URL
DB 비밀번호
Docker volume 내부 파일
다른 PC에서 생성된 node_modules
API 키와 인증 토큰
개인 학습 데이터 dump
로그인 쿠키와 브라우저 프로필
```

특히 Windows와 WSL에서 생성된 `node_modules`를 서로 복사하거나 함께 사용하지 않는다. 프로젝트를 실행할 환경 안에서 다시 설치한다.

---

## 3. 권장 실행 환경

현재 프로젝트는 다음 구성을 권장한다.

```text
Windows: Docker Desktop 실행과 편집기
WSL: Git, Node.js, pnpm, 프로젝트 실행
Docker Desktop: WSL 2 백엔드와 PostgreSQL 컨테이너
```

필요 도구:

```text
Git
WSL 2
Docker Desktop
Node.js
Corepack 또는 pnpm
선택: pgAdmin
```

버전은 우선 저장소의 `package.json`, lockfile, 문서에 명시된 값을 따른다. 별도 고정 파일이 없다면 현재 LTS 또는 프로젝트에서 이미 검증한 Node.js 버전을 사용한다.

확인 명령:

```bash
git --version
node --version
pnpm --version
docker version
docker compose version
```

WSL에서 `docker version`이 나오지 않으면 Docker Desktop의 WSL Integration 설정에서 사용하는 배포판을 활성화한다. Docker Desktop만 설치돼 있고 PostgreSQL 컨테이너가 정지된 상태도 실행 준비 완료가 아니다.

---

## 4. 저장소 준비

WSL에서 저장소로 이동한다.

```bash
cd /mnt/d/Projects/AI_Homeroom_Teacher
```

새 PC에서는 먼저 clone한 디렉터리로 이동한다.

현재 브랜치와 변경 상태를 확인한다.

```bash
git status --short --branch
git log --oneline -5
```

의존성을 설치한다.

```bash
corepack enable
pnpm install --frozen-lockfile
```

`--frozen-lockfile`이 실패하면 바로 lockfile을 갱신하지 않는다. Node.js·pnpm 버전과 설치 환경이 기존 프로젝트 기준에 맞는지 먼저 확인한다.

---

## 5. `.env.db.local` 생성 설계

### 파일 위치

저장소 루트에 다음 파일을 생성한다.

```text
AI_Homeroom_Teacher/.env.db.local
```

이 파일은 Git에 커밋하지 않는다.

### 최소 필드 계약

```dotenv
PERSISTENCE_MODE=postgres
DATABASE_URL=postgresql://<DB_USER>:<URL_ENCODED_DB_PASSWORD>@<DB_HOST>:<DB_PORT>/<DB_NAME>
```

개발 실행기가 기본값을 제공하지만 필요하면 다음 값을 명시할 수 있다.

```dotenv
API_HOST=127.0.0.1
API_PORT=4100
```

권장 전체 형태:

```dotenv
# 저장소 선택
PERSISTENCE_MODE=postgres

# PostgreSQL 접속 문자열
DATABASE_URL=postgresql://<DB_USER>:<URL_ENCODED_DB_PASSWORD>@127.0.0.1:5432/<DB_NAME>

# 로컬 API 바인딩: 생략 시 개발 실행기 기본값 사용
API_HOST=127.0.0.1
API_PORT=4100
```

`<...>`는 실제로 사용할 로컬 값으로 교체한다. 꺾쇠 괄호를 그대로 남기지 않는다.

### 필드 의미

| 필드 | 필수 | 의미 |
| --- | --- | --- |
| `PERSISTENCE_MODE` | 예 | `postgres`이면 PostgreSQL 저장소 사용 |
| `DATABASE_URL` | 예 | API가 접속할 PostgreSQL 연결 문자열 |
| `API_HOST` | 아니요 | API 수신 주소, 로컬 기본값 `127.0.0.1` |
| `API_PORT` | 아니요 | API 수신 포트, 로컬 기본값 `4100` |

### `DATABASE_URL` 작성 규칙

```text
postgresql://사용자:비밀번호@호스트:포트/데이터베이스
```

API를 WSL에서 실행하고 Docker가 PostgreSQL 포트를 Windows·WSL localhost에 게시한다면 일반적으로 호스트는 `127.0.0.1`을 사용한다.

비밀번호에 다음과 같은 특수 문자가 있으면 URL 인코딩한다.

```text
@  :  /  ?  #  %
```

실제 연결 문자열을 터미널 출력, 스크린샷, 문서, 이슈 또는 채팅에 붙여 넣지 않는다.

### 값 결정 방법

DB 이름·사용자·비밀번호·게시 포트는 PostgreSQL 컨테이너를 생성할 때 사용한 값과 정확히 같아야 한다.

```text
DB_USER     ↔ 컨테이너의 PostgreSQL 사용자
DB_PASSWORD ↔ 컨테이너 생성 시 지정한 비밀번호
DB_NAME     ↔ 컨테이너의 데이터베이스 이름
DB_PORT     ↔ 호스트에 게시한 포트
```

새 환경에서는 기존 비밀번호를 복사할 필요가 없다. 새 로컬 비밀번호를 만들고 컨테이너와 `.env.db.local`에 같은 값을 사용한다.

---

## 6. Docker PostgreSQL 재구성

### 기본 원칙

```text
Docker Desktop 실행
→ PostgreSQL 컨테이너 실행
→ 포트 게시 확인
→ migration 적용
→ seed 적용
→ API 연결 검사
```

Docker Desktop이 실행 중인 것과 PostgreSQL 컨테이너가 실행 중인 것은 별개의 조건이다.

### 저장소 compose 사용

먼저 추적된 compose 구성을 확인한다.

```bash
docker compose config
```

출력에 비밀번호가 포함될 수 있는 환경에서는 화면 공유나 로그 저장을 하지 않는다.

compose가 별도 환경 변수를 요구하지 않는다면 다음 명령으로 실행한다.

```bash
docker compose up -d
docker compose ps
```

compose가 `${POSTGRES_...}` 형태의 변수를 요구한다면 `compose.yaml`에 적힌 변수 이름만 확인하고, 별도의 Git 제외 로컬 환경 파일을 만든다. 실제 변수명은 compose에 선언된 이름을 그대로 사용하며 임의로 새 이름을 만들지 않는다.

예시 구조:

```dotenv
POSTGRES_USER=<새 로컬 사용자>
POSTGRES_PASSWORD=<새 로컬 비밀번호>
POSTGRES_DB=<새 로컬 DB 이름>
POSTGRES_PORT=5432
```

그 뒤 해당 파일을 명시해서 실행한다.

```bash
docker compose --env-file <로컬-compose-환경파일> up -d
```

`compose.yaml`에 요구되지 않는 파일은 추가하지 않는다.

### Docker Desktop에서 이미 만든 컨테이너 사용

기존 컨테이너를 계속 사용해도 된다. 다음 조건만 맞추면 된다.

```text
PostgreSQL 컨테이너가 running 상태
호스트 포트가 게시됨
DATABASE_URL의 사용자·비밀번호·DB 이름이 컨테이너와 일치
필수 migration이 모두 적용됨
```

이미 데이터가 있는 volume을 확인하지 않고 컨테이너나 volume을 삭제하지 않는다.

### 상태 확인

```bash
docker compose ps
docker ps
```

컨테이너가 `running` 또는 healthcheck가 있다면 `healthy`인지 확인한다.

---

## 7. DB 구조와 초기 데이터 생성

개발 실행기 `pnpm dev:api`는 `.env.db.local`을 자동으로 읽지만, DB 관리 명령은 현재 셸에 환경 변수를 먼저 전달해야 할 수 있다.

WSL Bash에서:

```bash
set -a
source .env.db.local
set +a
```

환경 변수 값을 출력하지 않는다.

연결을 확인한다.

```bash
pnpm --filter @ai-homeroom/api db:check
```

빈 DB 또는 새 DB에 migration을 적용한다.

```bash
pnpm --filter @ai-homeroom/api db:migrate
```

검증용 초기 데이터를 넣는다.

```bash
pnpm --filter @ai-homeroom/api db:seed
```

다시 연결과 구조를 확인한다.

```bash
pnpm --filter @ai-homeroom/api db:check
```

주의사항:

```text
기존 데이터가 있는 DB에 seed를 다시 실행하기 전에 seed의 멱등성을 확인한다.
migration SQL을 수동으로 골라 실행하지 않는다.
마이그레이션 파일 이름과 적용 이력 테이블을 임의로 수정하지 않는다.
테스트 편의를 위해 실제 개발 데이터를 초기화하지 않는다.
```

---

## 8. 프론트와 백엔드 실행

### 기본 실행

```bash
pnpm dev
```

이 명령은 프론트와 PostgreSQL 백엔드를 함께 실행한다.

정상 로그의 핵심 조건:

```text
FRONT 프로세스가 Vite 개발 주소에서 수신
API 프로세스가 로컬 API 주소에서 수신
백엔드 시작 로그의 persistenceMode가 postgres
PostgreSQL 연결·마이그레이션 사전 검사 통과
```

### 개별 실행

```bash
pnpm dev:front
pnpm dev:api
pnpm dev:api-postgresql
pnpm dev:api-memory
```

`pnpm dev:front`만 실행하면 화면 서버는 열리지만 API가 없으므로 전체 기능은 동작하지 않는다.

### 종료

프론트·백엔드 실행 터미널에서:

```text
Ctrl+C
```

DB까지 중지하려면:

```bash
docker compose stop
```

Docker volume을 지우는 `down -v`는 데이터 삭제 요청이 명확하지 않으면 사용하지 않는다.

---

## 9. 새 환경 인수 검증

### 1단계: API 상태

기본 로컬 설정 기준 예시:

```bash
curl -sS http://127.0.0.1:4100/api/health
```

기대 핵심 값:

```json
{
  "status": "ok",
  "dataSource": "postgres"
}
```

`dataSource: "mock"`이면 PostgreSQL 환경으로 복구된 것이 아니다.

### 2단계: 강좌 카탈로그

```bash
curl -sS http://127.0.0.1:4100/api/course-catalogs
```

기대 조건:

```text
HTTP 200
dataSource = postgres
catalogDataSource = postgres
seed 강좌와 강의가 반환됨
```

### 3단계: 프론트

브라우저에서 Vite가 출력한 주소를 연다. 기본 설정에서는 일반적으로 다음 주소다.

```text
http://localhost:5173
```

확인 흐름:

```text
커리큘럼 후보 표시
커리큘럼 선택
오늘 수업 표시
강의 열기
이해도·집중도 저장
학습 진행과 다음 추천 갱신
새로고침 후 상태 유지
```

### 4단계: 재시작 복구

```text
학습 상태 변경
→ 백엔드 종료
→ pnpm dev 재실행
→ 같은 학생 snapshot 재조회
→ 선택·완료·진도 상태 일치 확인
```

### 5단계: 테스트

```bash
pnpm --filter @ai-homeroom/api test
pnpm --filter @ai-homeroom/api test:db
pnpm build
```

DB 통합 테스트는 반드시 테스트 전용 학생을 사용하고 종료 시 데이터를 정리해야 한다.

---

## 10. 프론트 API 주소 계약

프론트 코드는 기본적으로 상대 경로 `/api`를 사용한다. 브라우저가 직접 DB에 접속하거나 `DATABASE_URL`을 알아서는 안 된다.

```text
브라우저 → /api → Vite proxy → Fastify API → PostgreSQL
```

API 포트를 기본값 `4100`에서 변경할 경우 다음 세 값이 일치하는지 확인한다.

```text
.env.db.local의 API_PORT
Vite 개발 프록시 대상
직접 API 검증에 사용하는 주소
```

프론트용 환경 변수가 실제 코드에 추가돼 있다면 이름만 추적 가능한 예시 문서에 기록하고 실제 주소는 로컬 파일에 둔다. `VITE_` 접두사의 값은 브라우저 번들에 노출될 수 있으므로 비밀번호·토큰·DB 주소를 절대 넣지 않는다.

---

## 11. 새 환경에서 만들 필요가 없는 파일

다음 항목은 실행 복구를 위해 만들지 않는다.

```text
프론트용 DATABASE_URL
브라우저용 DB 비밀번호
DB가 직접 HTTP API를 제공하는 설정
로컬 mock 데이터 복사본
Docker volume을 Git에 넣기 위한 archive
실제 비밀값이 들어간 README
실제 접속 주소가 들어간 Git 추적 문서
```

PostgreSQL은 프론트에 API를 제공하지 않는다. Fastify 백엔드가 DB client를 통해 PostgreSQL에 접속하고 프론트에 HTTP API를 제공한다.

---

## 12. 환경 계약 변경 시 문서 유지 규칙

새 환경 변수를 추가하거나 파일 위치를 변경하면 구현과 같은 작업에서 이 문서를 함께 수정한다.

검사 명령 예시:

```bash
rg -n "process\.env|import\.meta\.env" . \
  -g '!node_modules/**' \
  -g '!dist/**'
```

확인 항목:

```text
코드가 읽는 모든 환경 변수 이름이 문서에 존재하는가
필수·선택 여부와 기본값이 맞는가
환경 파일 위치가 실행기와 일치하는가
Git 제외 규칙이 실제 비밀 파일을 포함하는가
예시 문서에 실제 비밀번호나 토큰이 들어가지 않았는가
새 PC에서 migration+seed만으로 검증 DB를 만들 수 있는가
```

실제 비밀값이 없는 환경 변수 예시 파일을 추후 추가한다면 다음 원칙을 따른다.

```text
예시 파일에는 키 이름과 안전한 placeholder만 기록
실제 파일은 Git 제외
예시와 실제 파일의 필드 이름은 동일
비밀번호처럼 보이는 공용 기본값을 제공하지 않음
```

---

## 13. AI 에이전트용 작업 지시문

새 환경에서 AI 에이전트에게 로컬 파일 생성을 요청할 때 다음 지시문을 사용할 수 있다.

```text
README.md, AGENTS.md, docs/local-development-bootstrap-guide.md,
package.json, apps/api/package.json, apps/api/src/config.ts,
apps/api/scripts/dev-server.mjs, compose.yaml을 먼저 읽어라.

Git 추적 파일과 현재 로컬 파일을 비교하되 실제 비밀값은 출력하지 마라.
환경 변수는 이름, 필수 여부, 기본값 존재 여부만 보고하라.

저장소 루트에 .env.db.local이 없으면 다음 계약으로 생성하라.
- PERSISTENCE_MODE=postgres
- DATABASE_URL은 사용자가 제공하거나 승인한 로컬 PostgreSQL 값으로 작성
- API_HOST와 API_PORT는 현재 개발 실행기의 기본값과 일치시킴

실제 비밀번호, DATABASE_URL, 토큰을 대화·로그·문서·Git diff에 출력하지 마라.
Docker volume이나 기존 DB를 삭제하지 마라.
빈 DB에만 migration과 seed를 적용하고, 기존 데이터가 있으면 먼저 사용자에게 알려라.

pnpm dev 실행 전에 PostgreSQL 컨테이너, 연결, migration 상태를 확인하라.
완료 후 health의 dataSource=postgres, 카탈로그의 catalogDataSource=postgres,
프론트 /api 연결과 재시작 복구를 확인하라.

다른 세션의 미커밋 파일을 수정하거나 함께 커밋하지 마라.
```

에이전트가 `DATABASE_URL` 값을 알 수 없으면 임의의 기존 비밀번호를 추측하지 않는다. 새 컨테이너를 만드는 작업인지, 기존 컨테이너에 연결하는 작업인지 사용자에게 확인한다.

---

## 14. 문제 해결 표

| 증상 | 우선 확인 |
| --- | --- |
| `docker` 명령을 찾을 수 없음 | Docker Desktop 실행, WSL Integration |
| PostgreSQL 컨테이너가 없음 | `compose.yaml`로 생성했는지 확인 |
| PostgreSQL 컨테이너가 정지됨 | `docker compose up -d`, `docker compose ps` |
| `.env.db.local` 누락 오류 | 저장소 루트에 파일 생성 |
| `DATABASE_URL` 누락 오류 | 필드 이름과 빈 값 여부 확인 |
| DB 인증 실패 | 컨테이너 사용자·비밀번호·DB 이름과 URL 일치 확인 |
| 연결 거절 | 게시 포트, 컨테이너 상태, DB host 확인 |
| 마이그레이션 누락 오류 | 환경 로드 후 `db:migrate` 실행 |
| API가 `dataSource: mock` 반환 | memory 명령 사용 여부, `PERSISTENCE_MODE` 확인 |
| 프론트는 열리지만 API 실패 | 백엔드 실행, Vite proxy, API 포트 확인 |
| pnpm이 `node_modules` 재설치를 요구 | Windows·WSL 설치 환경 혼용 여부 확인 |
| 서버 재시작 후 상태 소실 | memory 모드 여부와 DB write 성공 여부 확인 |

---

## 15. 최소 복구 체크리스트

- [ ] Git 저장소를 정상 clone했다.
- [ ] README와 AGENTS 지침을 읽었다.
- [ ] WSL 안에서 Node.js와 pnpm이 동작한다.
- [ ] WSL 안에서 Docker CLI가 Docker Desktop과 연결된다.
- [ ] 저장소 의존성을 lockfile 기준으로 설치했다.
- [ ] 저장소 루트에 `.env.db.local`을 생성했다.
- [ ] 실제 비밀 파일이 Git에서 제외되는지 확인했다.
- [ ] PostgreSQL 컨테이너가 running 또는 healthy다.
- [ ] 컨테이너 값과 `DATABASE_URL`이 일치한다.
- [ ] migration을 적용했다.
- [ ] 빈 개발 DB에 seed를 적용했다.
- [ ] `pnpm dev`로 프론트와 PostgreSQL API를 실행했다.
- [ ] health가 `dataSource: postgres`를 반환한다.
- [ ] 카탈로그가 `catalogDataSource: postgres`를 반환한다.
- [ ] 프론트에서 핵심 학습 흐름이 동작한다.
- [ ] 백엔드 재시작 뒤 학습 상태가 복원된다.
- [ ] 실제 접속 정보가 Git diff와 문서에 포함되지 않았다.

---

## 16. 복구 완료 보고 형식

실제 값은 적지 않고 다음 형식으로 결과를 남긴다.

```text
운영체제와 실행 셸:
Node.js 버전:
pnpm 버전:
Docker·Compose 버전:
PostgreSQL 컨테이너 상태:
.env.db.local 생성 여부:
확인한 환경 변수 이름:
migration 결과:
seed 결과:
API health 결과의 dataSource:
카탈로그 결과의 catalogDataSource:
프론트 접속 결과:
재시작 복구 결과:
테스트 결과:
Git status:
남은 제한사항:
```

비밀번호, 전체 접속 문자열, 토큰과 개인정보는 완료 보고에 포함하지 않는다.
