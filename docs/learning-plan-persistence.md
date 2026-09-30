# 전체 학습 계획 저장 계약

현재 정책 독립 PostgreSQL 저장 기반의 기준이다. 편성 엔진·HTTP 연결·날짜/시간 정책의 구현 완료를 의미하지 않는다. 기존 실행·안전 지침은 [DB 운영](./database-operations.md)을 따른다.

## 저장 범위

`apps/api/src/learning-plan/learning-plan.repository.ts`가 저장 DTO·메서드·예상 오류·단일 30분 TTL의 기준이다. 호출자는 도메인 검증을 끝낸 후보를 전달한다. 저장층은 미결 조건을 기본값으로 채우거나 최초 생성·부분 조정·재편성을 대신 계산하지 않는다.

신규 `0007_learning_plans.sql`은 이전 환경의 `0004~0006` 이력과 이름이 충돌하지 않는다. 기존 학생·카탈로그·과목별 커리큘럼·피드백을 변경하지 않는다.

| 테이블 | 책임 |
| --- | --- |
| `learning_plans` | 학생당 전체 계획 1개, 현재 버전 포인터, 계획·완료 revision |
| `learning_plan_versions` | 당시 조건·카탈로그·포함/제외 근거·날짜별 초 한도·배치·변경 이유의 불변 snapshot |
| `learning_plan_items` | opaque itemKey의 계획·실제 강의·과목 귀속 |
| `learning_plan_assignments` | 버전별 예정 DATE·순서·실제 초 |
| `learning_plan_completions` | 최초 완료·피드백·DB 시각·완료 revision |
| `learning_plan_completion_keys` | 계획 내 수락한 모든 재시도 key의 최초 완료 귀속 |
| `learning_plan_proposals` | 서버 후보·최초 basis·DB 생성/만료 시각·상태·확정 결과 |

계획·버전·항목의 composite FK로 교차 귀속을 차단한다. repository는 버전·완료를 수정/삭제하지 않는다. 직접 SQL 운영 권한에 대한 별도 인증·권한 분리는 이번 구현 범위가 아니다.

## 원자성·조회·재시도

- 기존 학생이 필요하며 unknown 학생은 `NOT_FOUND`다. 조회·제안 저장은 학생이나 현재 계획을 암묵 생성하지 않는다. 최초 기준은 plan/version 부재와 revision 0을 포함한다.
- basis는 planId/currentVersionId, planRevision, completionRevision, 요청한 선택 카탈로그의 canonical hash다. 새 과목 후보의 선택 hash와 과거 버전의 hash를 구분한다.
- `readBasis`와 `readPlan`은 일관된 읽기 전용 snapshot이다. 저장·확정·완료는 학생 단위 transaction lock을 공유한다. 제안 저장과 확정에서 basis와 실제 카탈로그를 재검사한다. 카탈로그 행 추가/변경도 막도록 두 카탈로그 테이블을 보수적으로 SHARE 잠금한다.
- 확정은 서버 저장 후보만 사용하며 새 버전·항목·배치·현재 포인터·계획 revision·확정 결과를 한 트랜잭션으로 저장한다. 실패는 전체 롤백한다. 저장 중 만료는 후보 저장을 되돌리고 `expired`만 남긴다.
- 정확한 확정 재시도는 학생·제안·최초 basis를 검사한 뒤 당시 결과를 반환한다. 이후 revision 변화나 시간 경과를 이유로 정확한 재시도를 재적용하거나 충돌 처리하지 않는다.
- 최초 완료만 completionRevision을 올린다. 같은 itemKey·같은 canonical payload는 새 key라도 최초 결과를 반환하고 수락한 alias를 보존한다. 같은 key의 다른 대상/payload 또는 같은 item의 다른 payload는 `IDEMPOTENCY_CONFLICT`다. 수정 API는 없다.
- `readPlan(versionId)`의 일정/조건은 당시 snapshot이며 완료 배열은 별도 현재 실제 기록이다. 과거 lessonId를 새 itemKey에 합치지 않는다. DATE는 SQL `to_char`로 YYYY-MM-DD 키를 복원하며 시간대 변환하지 않는다.
- 구조·참조·초·커버리지·순서 방어 검증은 기존 순수 검증기를 사용한다. itemKey 승계·재등록/제거 정책, 시작/마감 포함·오늘 남은 시간·균형 편성 의미는 저장층에서 결정하지 않는다.

## 전용 DB 검증

저장소 루트의 Git 제외 `.env.learning-plan-test.local`을 사용한다. 이전 환경 파일은 덮어쓰지 않는다. 테스트는 TEST_DATABASE_URL과 명시 허용을 요구하고 `test_learning_plan_` 전용 이름·migration 이력을 확인한다. 개발 DB URL을 테스트에 넣지 않는다.

API 폴더에서:

```bash
# 새 환경 파일이 없을 때만 새 DB를 생성한다. 기존 DB의 reset/drop/seed는 없다.
node --import tsx scripts/prepare-learning-plan-test-db.ts --allow-create-test-database
node --env-file=../../.env.learning-plan-test.local --import tsx src/db/migrate.ts
node --env-file=../../.env.learning-plan-test.local --import tsx --test test/learning-plan.repository.test.ts
```

같은 전용 DB 검사 명령을 저장소 루트에서 `pnpm --filter @ai-homeroom/api test:db:learning-plan`으로 실행할 수 있다. 기존 `test:db`와 비DB 기본 `test`는 별도 검사이며 이 테스트를 대신하지 않는다.

준비 fixture는 카탈로그만 적재하고 mock 재생 대상을 만들지 않는다. 테스트는 실제 카탈로그의 전체 강의를 사용하되 배치는 저장 경계 검사용 입력으로 만든다. 이것을 제품 편성 엔진의 결과로 간주하지 않는다. 무작위 테스트 학생만 정리하고 카탈로그 변경/실패 주입 trigger를 복구한다. 해당 DB에서 다른 검증을 동시에 실행하지 않는다.

현재 검사 범위는 확인 전 불변, 중복/동시 확정, 양쪽 revision·카탈로그 충돌, DB 만료, 최초 완료·alias key, 학생 격리·composite FK, 중간 실패 롤백, 독립 SQL 대조와 별도 DB 연결의 저장 복구다. 실제 HTTP 서버 프로세스 재시작은 HTTP 조립 후 통합 검증으로 남는다. URL 없는 skip은 DB 통과가 아니다.
