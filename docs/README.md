# 문서 인덱스

이 폴더는 AI 담임 서비스 데모의 프로젝트 구조, 구현 범위, 화면 흐름, 데이터 개념을 정리하기 위한 문서 공간입니다.

현재 단계의 목표는 구현된 데모가 다음 질문에 계속 맞춰져 있는지 확인하는 것입니다.

```text
AI 담임이 사전 정의된 커리큘럼을 기반으로 오늘 수업을 편성하고,
학생의 요구사항과 학습 결과에 따라 다음 수업을 조율하는 경험을
어떤 구조로 구현할 것인가?
```

## 문서 목록

| 문서 | 목적 |
| --- | --- |
| [project-structure.md](./project-structure.md) | 전체 폴더/파일 트리와 각 폴더의 책임을 정의합니다. |
| [demo-flow.md](./demo-flow.md) | 데모에서 보여줄 화면 흐름과 사용자 행동 흐름을 정리합니다. |
| [screen-spec.md](./screen-spec.md) | 정적 화면 구현 전 화면별 표시 항목, 사용자 행동, 완료 기준을 정의합니다. |
| [domain-model.md](./domain-model.md) | 커리큘럼, 학생 상태, 오늘 수업, 강의별 학습 기록 등 핵심 데이터 개념을 정리합니다. |
| [orchestration-rules.md](./orchestration-rules.md) | 규칙 기반 오늘 수업 생성, 요구사항 반영, 다음 수업 조율 기준을 정의합니다. |
| [curriculum-adjustment-design.md](./curriculum-adjustment-design.md) | AI 담임이 내부 조율 도구로 복합 요청을 반영하고, 편성안을 먼저 제안하는 방향을 정의합니다. |
| [implementation-roadmap.md](./implementation-roadmap.md) | 구현 순서와 각 단계에서 만들 파일 범위를 정리합니다. |
| [repository-management.md](./repository-management.md) | GitHub 관리 시 제외해야 할 민감 정보, 로그, 임시 산출물 기준을 정리합니다. |
| [backend-api-foundation.md](./backend-api-foundation.md) | 프론트엔드와 분리된 mock API 서버의 책임, 초기 엔드포인트, 환경 변수 원칙을 정리합니다. |
| [backend-development-brief.md](./backend-development-brief.md) | 백엔드 개발 세션이 알아야 할 제품 목표, 책임 경계, 구현 단계, 품질·보안 기준을 정리합니다. |
| [prompts/backend-development-session.md](./prompts/backend-development-session.md) | 별도 백엔드 개발 세션을 시작할 때 사용할 작업 프롬프트를 제공합니다. |
| [claims/README.md](./claims/README.md) | 프론트엔드와 백엔드 사이의 문제를 클레임 문서로 기록하고 응답하는 협업 규칙을 정리합니다. |
| [claims/lesson-feedback-proxy-issue.md](./claims/lesson-feedback-proxy-issue.md) | 강의별 체크 API 전달 실패의 재현 결과와 프론트·백엔드 확인 요청을 기록합니다. |

## 문서 작성 기준

- 문서는 모두 한국어로 작성합니다.
- 사용자에게 보이는 UI 문구도 한국어로 설계합니다.
- 초기 데모에서는 로그인, 결제, 관리자 페이지, RAG, 벡터 DB, 실제 영상 스트리밍을 다루지 않습니다.
- 핵심 로직은 먼저 mock data와 규칙 기반 조율로 구현합니다.
- LLM은 초기에는 필수가 아니며, AI 담임 코멘트와 요구사항 해석을 대체 가능한 모듈로 분리합니다.

## 현재 구현 상태 요약

```text
정적 화면 구현 완료
mock data 연결 완료
오늘 수업 생성 로직 구현 완료
강의별 간단 체크 반영 완료
내부 다음 수업 조율 및 읽기 전용 진행 보고 구현 완료
학생 요구사항 반영 구현 완료
AI 담임 mock 코멘트 개선 완료
localStorage 기반 데모 상태 저장 완료
채팅 앱 기반 인터랙션 플로우 UI 구현 완료
개발용 단계 강제 이동 컨트롤 구현 완료
AI 담임 답변 안에 카드가 첨부되는 UI 구현 완료
채팅 흐름에 맞춘 컴팩트 첨부 카드 UI 구현 완료
채팅 메시지 누적 및 AI 준비 중 점 애니메이션 구현 완료
오늘 수업·커리큘럼 맵·채팅 메시지·강의별 체크 mock API 연결 완료
LLM API 연결 미구현
```

## 현재 주요 폴더

```text
docs/
public/
src/
  app/
  components/
  features/
    curriculum/
    learning-check/
    progress-orchestrator/
    teacher-response/
  mock/
  types/
```

구현이 진행되면서 일부 초기 설계용 폴더는 아직 사용하지 않을 수 있습니다.
데모 마감 전 기준 문서는 README와 실제 `src/` 구현 상태를 함께 확인합니다.
