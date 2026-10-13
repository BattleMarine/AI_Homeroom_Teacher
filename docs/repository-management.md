# 저장소 관리

## 추적 대상

소스·테스트·package/lockfile, compose, DB schema·migration·seed, 비밀값 없는 환경 예시, 활성 개발 문서를 추적한다. 현재 요구사항은 README와 AGENTS를 기준으로 한다.

## 제외 대상

- 실제 환경 파일, API 키·토큰·비밀번호·접속 문자열·개인정보.
- node_modules, 빌드·테스트 산출물, 로그·캐시·브라우저 프로필.
- DB 데이터·volume·dump·백업.
- `docs/secrets/`, 개별 `docs/claims/`, `docs/archive/`.

claims에서는 협업 규칙인 README만 추적한다. 공유 문서에는 실제 로컬 주소·포트 대신 필드 이름과 placeholder를 적는다. 구체적인 로컬 값은 제외된 환경 파일에서 관리한다.

## 아카이브

오래되거나 방향이 다른 문서는 `docs/archive/<정리일-주제>/`에 원래 상대 경로를 보존해 이동한다. 동명 파일을 덮어쓰지 않는다. 필요하면 재작성 전 원본과 이동 이유도 같은 폴더에 보관한다.

아카이브는 로컬 과거 기록이며 현재 개발 우선순위와 완료 기준에서 제외한다. clone에 포함되지 않는다. 이미 Git에 추적된 문서는 ignore만 추가해도 원격에서 사라지지 않으므로, 기존 경로의 삭제를 커밋·푸시해야 원격 기본 경로에서도 제거된다. 과거 Git 이력은 유지된다.

## 변경 확인

```bash
git status --short
git diff --stat
git diff --check
git check-ignore docs/archive/example.md docs/claims/example.md .env.db.local
```

커밋은 요청받았을 때 자기 작업 경로만 명시해 스테이징하고 `git diff --cached`로 확인한다. 다른 세션 변경과 비밀값이 섞이면 중단해 분리한다. 전체 add와 승인 없는 병합·데이터 삭제는 하지 않는다.
