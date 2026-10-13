# 개발환경 복구

현재 체크아웃의 실행 기반을 복구하는 안내다. 서버 기동 성공은 README의 새 학습 계획 기능이 구현됐다는 뜻이 아니다.

## 1. 실행 환경

Git·Node.js·pnpm과 PostgreSQL이 필요하다. Docker 사용 시 Docker Desktop과 DB 컨테이너가 모두 실행되어야 한다. WSL에서는 Docker Desktop의 해당 배포판 통합을 확인한다.

Windows와 WSL 중 한 환경에서 의존성을 설치·실행한다. 같은 node_modules를 두 환경에서 공유하지 않는다. 버전은 package 파일·lockfile과 검증된 프로젝트 환경에 맞춘다.

```bash
git status --short --branch
node --version
pnpm --version
docker version
docker compose version
pnpm install --frozen-lockfile
```

설치 실패 시 lockfile을 즉시 변경하지 말고 실행 환경과 도구 버전을 먼저 확인한다.

## 2. 로컬 파일

저장소 루트에 생성하며 실제 값은 출력하거나 Git에 넣지 않는다. 기존 파일이 있으면 덮어쓰지 않는다.

| 파일 | 필드 | 값 결정 |
| --- | --- | --- |
| `.env.db.local` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | DB 생성 시 지정한 값 |
| 위 파일 | `PERSISTENCE_MODE=postgres`, `DATABASE_URL` | API가 접속할 DB |
| 위 파일 | 선택적 `API_HOST`, `API_PORT` | API 실행 주소, 생략 시 실행기 기본값 |
| `.env.local` | `API_PROXY_TARGET` | 실제 API 수신 주소와 일치 |

DB 파일은 `.env.db.example`을 참고한다. 접속 문자열의 형태는 다음과 같고 비밀번호의 특수 문자는 URL 인코딩한다.

```dotenv
DATABASE_URL=postgresql://<사용자>:<URL인코딩된비밀번호>@<DB호스트>:<DB포트>/<DB이름>
```

프론트 프록시 설정의 형태:

```dotenv
API_PROXY_TARGET=http://<API호스트>:<API포트>
```

placeholder는 로컬 값으로 바꾼다. API 기본값은 `apps/api/scripts/dev-server.mjs`, DB 게시 포트는 `compose.yaml`에서 확인한다. 현재 compose의 사용자 지정 포트 환경 변수 지원을 가정하지 않는다.

`API_PROXY_TARGET`이 없으면 현재 Vite 개발 서버는 시작을 거절한다. 변경 뒤 Vite를 재시작한다. DB 비밀값을 `VITE_` 변수로 전달하지 않는다.

## 3. DB 준비

[DB 운영 안내](./database-operations.md)에 따라 컨테이너·마이그레이션·초기 데이터를 준비한다. 기존 데이터와 이전 브랜치의 마이그레이션이 남아 있다면 먼저 호환성을 확인한다. 브랜치를 되돌렸다고 DB도 되돌아가는 것은 아니다.

환경 파일·volume·실제 학습 이력은 Git clone으로 복구되지 않는다. 새 DB는 migration과 seed로 준비하고 기존 DB는 별도 백업·복구 절차가 필요하다.

## 4. 실행

```bash
pnpm dev
```

| 명령 | 대상 |
| --- | --- |
| `pnpm dev` | 프론트 + PostgreSQL API |
| `pnpm dev:front` | 프론트 |
| `pnpm dev:api` | PostgreSQL API |
| `pnpm dev:api-postgresql` | dev:api 별칭 |
| `pnpm dev:api-memory` | 명시적 메모리 모드 |

PostgreSQL 실행기는 `.env.db.local`을 자동 로드하고 연결·필수 마이그레이션·포트를 검사한다. 컨테이너 생성·마이그레이션·seed는 자동 수행하지 않는다. 셸의 기존 환경 변수가 파일보다 우선할 수 있으므로 모드가 다르면 변수 이름과 설정 유무만 확인한다.

프론트 단독 실행은 화면 서버만 실행한다. API 오류를 mock으로 감추지 않는다. 종료는 실행 터미널에서 Ctrl+C를 사용한다.

## 5. 복구 확인

- API의 `GET /api/health`가 응답하고 저장소 모드가 `postgres`인지 확인한다.
- `GET /api/course-catalogs`의 DB 카탈로그 조회를 확인한다.
- 프론트의 상대 경로 `/api`가 동일 API로 전달되는지 확인한다.
- 학습 변경 검증은 전용 데이터로 실행하고 DB 조회·재시작 후 결과를 비교한다.
- `pnpm build`, `pnpm build:api`, API 테스트를 각각 실행한다. DB 테스트는 운영 안내의 안전 조건을 먼저 따른다.
- `git check-ignore .env.db.local .env.local`로 제외 여부를 확인한다.

에이전트는 실제 접속 문자열·비밀번호·쿠키를 읽어 출력하지 않는다. 누락된 연결 정보는 추측하지 않고 사용자에게 확인한다. 보고에는 실행 환경, 파일 생성 여부, 검사 결과와 제한사항만 남긴다.
