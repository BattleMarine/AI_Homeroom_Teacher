# 문서 인덱스

이 폴더는 AI 담임 서비스 데모를 실제 구현하기 전에, 프로젝트 구조와 구현 범위를 먼저 정리하기 위한 문서 공간입니다.

현재 단계의 목표는 앱을 바로 만들기보다 다음 질문에 답할 수 있는 기준을 세우는 것입니다.

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
| [domain-model.md](./domain-model.md) | 커리큘럼, 학생 상태, 오늘 수업, 학습 후 체크 등 핵심 데이터 개념을 정리합니다. |
| [orchestration-rules.md](./orchestration-rules.md) | 규칙 기반 오늘 수업 생성, 요구사항 반영, 다음 수업 조율 기준을 정의합니다. |
| [implementation-roadmap.md](./implementation-roadmap.md) | 구현 순서와 각 단계에서 만들 파일 범위를 정리합니다. |
| [repository-management.md](./repository-management.md) | GitHub 관리 시 제외해야 할 민감 정보, 로그, 임시 산출물 기준을 정리합니다. |

## 문서 작성 기준

- 문서는 모두 한국어로 작성합니다.
- 사용자에게 보이는 UI 문구도 한국어로 설계합니다.
- 초기 데모에서는 로그인, 결제, 관리자 페이지, RAG, 벡터 DB, 실제 영상 스트리밍을 다루지 않습니다.
- 핵심 로직은 먼저 mock data와 규칙 기반 조율로 구현합니다.
- LLM은 초기에는 필수가 아니며, AI 담임 코멘트와 요구사항 해석을 대체 가능한 모듈로 분리합니다.

## 현재 준비한 폴더

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
  storage/
  types/
  utils/
```

위 폴더는 아직 구현 파일을 포함하지 않는 설계용 골격입니다.
