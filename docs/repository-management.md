# 저장소 관리 기준

## 목적

이 프로젝트는 GitHub에서 관리될 예정이므로, 민감 정보와 반복 생성 산출물이 커밋되지 않도록 초기부터 기준을 둡니다.

## 커밋하지 않는 항목

다음 항목은 Git에 포함하지 않습니다.

```text
API 키
토큰
실제 환경 변수 파일
개인 실행 로그
임시 디버그 출력
로컬 세션 데이터
빌드 산출물
테스트 커버리지 산출물
패키지 의존성 폴더
IDE 개인 설정
```

## 환경 변수 관리

실제 키는 `.env` 또는 `.env.local` 같은 로컬 파일에만 둡니다.
예시 파일이 필요하면 `.env.example`처럼 값이 비어 있는 파일만 커밋합니다.

예시:

```env
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
```

## 민감 문서 관리

API 키, 토큰, 계정 정보, 배포 비밀값을 설명하는 문서는 Git에 올리지 않습니다.

`.gitignore`는 다음 패턴을 제외합니다.

```text
API_KEYS.md
SECRETS.md
CREDENTIALS.md
*.secret.md
*.private.md
docs/private/
docs/secrets/
docs/claims/**
!docs/claims/README.md
```

공유가 필요한 문서는 실제 값 없이 구조와 작성 방법만 남깁니다.

`docs/claims/`의 개별 요청·응답 문서는 로컬 세션 간 협업 기록이므로 커밋하지 않습니다. 협업 규칙만 `docs/claims/README.md`로 추적합니다. 개인 메모는 `*.local.md`, 비밀 문서는 `*.secret.md` 또는 `*.private.md` 접미사를 사용합니다.

## 로그 관리

개발 중 생겼다 지워지는 로그는 커밋하지 않습니다.

제외 대상:

```text
logs/
*.log
debug.log
error.log
npm-debug.log*
yarn-error.log*
pnpm-debug.log*
```

중요한 오류 분석 결과를 남겨야 한다면 로그 원문 대신 원인, 재현 방법, 해결 내용을 문서로 정리합니다.

## 현재 추가한 보호 장치

루트에 `.gitignore`를 추가해 다음 범주를 제외했습니다.

```text
의존성
빌드 산출물
테스트/커버리지 산출물
환경 변수와 비밀값
민감 문서
로그
임시 파일
로컬 저장 데이터
IDE/OS 생성 파일
패키지 매니저 캐시
Codex/에이전트 로컬 산출물
```
