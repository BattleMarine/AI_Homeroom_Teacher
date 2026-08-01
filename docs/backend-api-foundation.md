# 백엔드 API 기반 설계

## 목적

현재 채팅형 데모를 실제 서비스 구조로 전환하기 위해, 프론트엔드와 백엔드를 API 경계로 분리합니다.

첫 단계의 백엔드는 데이터베이스나 실제 LLM을 연결하지 않습니다. 기존 데모 흐름과 같은 형태의 mock 데이터를 반환해 프론트엔드가 API 계약을 기준으로 전환할 수 있게 합니다.

현재 mock 상태의 기준은 프론트가 아니라 API 서버입니다. 프론트는 API 응답을 렌더링하고, 커리큘럼 선택·수업 편성·강의별 기록·다음 추천 판단은 서버의 mock 도메인 서비스가 처리합니다.

## 구성

```text
루트 웹 앱
  사용자 화면, 채팅 UI, API 클라이언트

apps/api
  HTTP API, mock 데이터, 이후 인증·DB·LLM 오케스트레이터
```

웹 앱은 상대 경로인 `/api`만 호출합니다. 개발 환경에서는 Vite 프록시가 이 요청을 API 서버로 전달합니다.

도메인, 포트, 외부 API 주소, API 키는 이 문서에 기록하지 않습니다. 로컬 환경별 값은 Git 추적에서 제외되는 `docs/secrets/`에서만 관리합니다.

각 엔드포인트의 실제 호출 문법, 요청·응답 예시, 상태 코드는 [backend-api-guide.md](./backend-api-guide.md)에서 관리합니다. API 계약을 변경할 때는 구현과 이 가이드를 같은 작업에서 함께 갱신합니다.

## 초기 API

| 메서드 | 경로 | 역할 |
| --- | --- | --- |
| `GET` | `/api/health` | API 서버 상태와 mock 모드 확인 |
| `GET` | `/api/course-catalogs` | 파일 기반 강좌 카탈로그의 강좌 목록 반환 |
| `GET` | `/api/course-catalogs/:courseId` | 강좌 정보와 원본 강의 목록 반환 |
| `POST` | `/api/curriculum-recommendations` | 카탈로그·완료 이력·시간 조건을 기반으로 규칙형 학습 경로와 일별 세션 추천 |
| `GET` | `/api/curriculums` | 커리큘럼 목록과 현재 선택 상태 반환 |
| `POST` | `/api/student-context/curriculum` | 커리큘럼 선택 후 학생 mock 상태 초기화 |
| `GET` | `/api/student-context` | 현재 학생 mock 상태 반환 |
| `GET` | `/api/today-session` | 학생 상태 기반 오늘 수업 mock 편성 반환 |
| `GET` | `/api/today-session/progress` | 현재 수업 진행 보고와 다음 추천 항목 반환 |
| `GET` | `/api/curriculum-map` | 학생 상태 기반 커리큘럼 맵 반환 |
| `GET` | `/api/lesson-items/:lessonItemId` | 강의·보강·연습 항목의 상세와 mock 재생 메타데이터 반환 |
| `GET` | `/api/lesson-items/:lessonItemId/playback` | 재생 가능한 강의의 백엔드 소유 mock 미디어 반환 |
| `POST` | `/api/conversations/:conversationId/messages` | 학생 메시지에 대한 mock AI 담임 응답 반환 |
| `POST` | `/api/session-adjustments/:adjustmentId/confirm` | AI 담임이 제안한 수업 조율안을 확인 후 확정 |
| `POST` | `/api/lesson-feedback` | 강의별 이해도·집중도 기록과 진행 보고·다음 추천 반환 |

## 책임 경계

```text
웹 앱
  화면 표시, 사용자 입력, API 응답 렌더링

API 서버
  요청 검증, 학생별 mock 상태, 진도 mock 규칙, 이후 인증·DB·진도 엔진·LLM 호출
```

프론트엔드는 `src/api/teacher-api.ts`를 통해 오늘 수업 안내, 커리큘럼 맵, 채팅 메시지, 강의별 체크 기록을 요청합니다. API 요청이 실패하면 화면은 연결 상태와 재시도만 표시하며, 진도 판단을 프론트 mock으로 대체하지 않습니다.

AI 담임 메시지 API는 백엔드의 `TeacherLlmService`를 통해 응답을 생성합니다. 현재는 mock 구현을 사용하며, 실제 LLM 연결은 `docs/teacher-llm-api.md`의 계약과 원칙을 따릅니다.

현재 API는 커리큘럼 선택, 학생 상태, 오늘 수업, 강의 상세, 강의별 피드백과 다음 추천을 서버 mock 상태로 처리합니다. 재생 가능한 강의는 상세 응답의 `playback.mediaUrl`을 통해 백엔드 소유 PNG 기반 mock 미디어를 반환합니다. 학생 요구사항의 복합 조율안 제안·사용자 확인과 대화 카드 구조화는 다음 API 확장 단계에서 서버의 진도 엔진으로 이전합니다.

## 서버 상태 기반 mock 사용법

인증 전 단계이므로 `studentId`는 임시 식별자입니다. 쿼리 또는 요청 본문에서 생략하면 `000`를 사용합니다. 동일한 `studentId`를 사용하면 커리큘럼 선택과 강의별 피드백이 다음 요청에도 유지됩니다.

```text
GET /api/curriculums?studentId=000
POST /api/student-context/curriculum
GET /api/today-session?studentId=000
GET /api/lesson-items/{lessonItemId}?studentId=000
POST /api/lesson-feedback
GET /api/today-session/progress?studentId=000
GET /api/curriculum-map?studentId=000
```

커리큘럼 선택 요청 예시입니다.

```json
{
  "studentId": "000",
  "curriculumId": "compressed-log"
}
```

강의별 체크 요청은 `studentId`를 함께 보냅니다.

```json
{
  "studentId": "000",
  "lessonId": "compressed-graph-review",
  "understandingLevel": 3,
  "focusLevel": 4
}
```

`POST /api/lesson-feedback` 응답의 `progress.nextRecommendedLesson`과 `progress.teacherReport`를 사용하면 프론트가 다음 강의 자동 재생 안내와 오늘의 학습 진행 카드를 별도 계산 없이 표시할 수 있습니다.

### mock 상태 제한

```text
현재 상태는 API 프로세스 메모리에만 저장된다.
API 서버를 다시 시작하면 모든 studentId의 상태가 초기값으로 돌아간다.
다른 API 서버 프로세스나 다른 머신과 상태를 공유하지 않는다.
DB 도입 시 같은 API 계약을 유지한 채 메모리 저장소만 교체한다.
```

## 이후 전환 순서

1. 현재 규칙 기반 진도 엔진을 API 내부 모듈 또는 공유 패키지로 이동
2. DB에 커리큘럼, 진도, 학습 기록, 대화를 저장
3. AI 담임 LLM이 내부 도구를 호출하도록 연결

## 환경 변수 원칙

API 서버와 웹 개발 프록시는 환경 변수로만 주소 정보를 받습니다.

```text
API_HOST
API_PORT
API_PROXY_TARGET
```

값은 커밋하지 않으며, 로컬 설정 방법은 `docs/secrets/`의 추적 제외 문서를 참고합니다.

### 프론트 개발 프록시

웹 앱은 상대 경로 `/api`를 호출하므로, 개발 서버가 API 프록시 대상을 반드시 알아야 합니다.
로컬의 `.env.local`은 Git에서 제외되며 Vite가 자동으로 읽습니다.

```text
API_PROXY_TARGET=로컬 API 서버 주소
```

`API_PROXY_TARGET`가 없으면 Vite는 시작 시 명확한 오류를 표시합니다. 이 값이 빠진 채 프론트 서버가 실행되어 `/api/*`가 404가 되는 상태를 막기 위한 정책입니다.
로컬 환경 값을 바꾸거나 `.env.local`을 만든 뒤에는 프론트 개발 서버를 반드시 재시작해야 합니다.
