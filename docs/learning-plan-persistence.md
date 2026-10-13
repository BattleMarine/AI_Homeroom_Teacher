# 전체 학습 계획 저장 계약

전체 계획·예정 구간·실제 진도·소비 시간·피드백의 PostgreSQL 저장 기준이다. 편성 엔진·HTTP·실제 서버 재시작 또는 로드맵 전체 완료를 의미하지 않는다. 실행·안전 지침은 [DB 운영](./database-operations.md), 편성 정책은 [학습 계획 로드맵](./learning-plan-roadmap.md)을 따른다.

## 저장 범위

`apps/api/src/learning-plan/learning-plan.repository.ts`가 저장 DTO·메서드·예상 오류·단일 30분 TTL의 기준이다. 호출자는 도메인 검증을 끝낸 후보를 전달한다. 저장층은 미결 조건을 기본값으로 채우거나 최초 생성·부분 조정·재편성을 대신 계산하지 않는다.

`0007_learning_plans.sql`은 기존 과목별 저장과 분리된 전체 계획을 도입한다. `0008_learning_plan_segments_and_progress.sql`은 0007을 수정하지 않고 구간·실제 진도·일별 소비·별도 피드백을 추가한다. 기존 학생·카탈로그·과목별 커리큘럼·피드백은 변경하지 않는다. 적용 여부는 각 환경의 migration 이력으로 확인한다. 테스트 실행기는 개발 DB에 migration을 자동 적용하지 않는다.

| 테이블 | 책임 |
| --- | --- |
| `learning_plans` | 학생당 전체 계획 1개, 현재 버전 포인터, 계획·실행 revision |
| `learning_plan_versions` | 당시 조건·카탈로그·포함/제외 근거·날짜별 초 한도·배치·변경 이유의 불변 snapshot |
| `learning_plan_items` | 안정적 itemKey·원본 항목 snapshot·실제 위치·최초 이월 DATE |
| `learning_plan_assignments` | 버전별 segmentKey·예정 DATE·순서·시작/종료 위치·예정 초 |
| `learning_plan_completions` | 실제 종료의 최초 시각·당시 실행 revision. 신규 payload는 null |
| `learning_plan_feedbacks` | 최초 제출된 피드백·제출 시각·실행 revision, 제출 후 불변 |
| `learning_plan_completion_keys` | 수락한 피드백 재시도 key의 항목 귀속 |
| `learning_plan_progress_events` | 실제 위치·소비 초·DB 서울 날짜·요청/최초 결과·멱등 key |
| `learning_plan_proposals` | 서버 후보·최초 basis·DB 생성/만료 시각·상태·확정 결과 |

계획·버전·항목의 composite FK로 교차 귀속을 차단한다. 구간 PK는 `(version_id,segment_key)`이며 동일 itemKey/lessonId를 날짜별로 나눌 수 있다. 구간 길이는 종료 위치−시작 위치와 같아야 한다. 원본 강의 길이와 실제 위치는 별도다. repository는 버전·완료·피드백·event를 수정/삭제하지 않는다. 직접 SQL 운영 권한의 인증·권한 분리는 이번 범위가 아니다.

## 원자성·조회·재시도

- 기존 학생이 필요하며 unknown 학생은 `NOT_FOUND`다. 조회·제안 저장은 학생이나 현재 계획을 암묵 생성하지 않는다. 최초 기준은 plan/version 부재와 revision 0을 포함한다.
- basis는 planId/currentVersionId, planRevision, completionRevision, 요청한 선택 카탈로그의 canonical hash다. completionRevision은 호환 필드명이며 실제 진도 event와 첫 별도 피드백도 증가시키는 **실행 revision**이다. 선택 hash와 과거 버전 hash를 구분한다.
- `readBasis`와 `readPlan`은 일관된 읽기 전용 snapshot이다. 제안·확정·진도·피드백은 학생 단위 transaction lock을 공유한다. 제안 저장과 확정에서 basis·실제 카탈로그·진도/소비 snapshot을 재검사한다. 카탈로그 행 추가/변경도 막도록 두 카탈로그 테이블을 보수적으로 SHARE 잠금한다.
- 확정은 서버 저장 후보만 사용하며 새 버전·항목·구간·최초 이월 기준일·현재 포인터·계획 revision·확정 결과를 한 트랜잭션으로 저장한다. 실패는 전체 롤백한다. 저장 중 만료는 후보 저장을 되돌리고 `expired`만 남긴다.
- 정확한 확정 재시도는 학생·제안·최초 basis를 검사한 뒤 당시 결과를 반환한다. 이후 revision 변화나 시간 경과를 이유로 정확한 재시도를 재적용하거나 충돌 처리하지 않는다.
- `readPlan(versionId)`의 일정/조건과 progressSnapshot은 당시 불변 snapshot이다. progress·dailyUsage·historicalItems·completions는 별도 현재 실제 기록이며 제외한 과목도 포함한다. 과거 lessonId를 새 itemKey에 합치지 않는다. DATE는 SQL `to_char`로 키를 복원한다.
- 신규 후보는 실제 `progressSnapshot:{progress:[{itemKey,positionSeconds}],dailyUsage:[{studyDate,spentSeconds}]}`를 그대로 포함한다. 항목 순서는 무관하지만 누락·중복·허위 값은 거부한다. 구간은 실제 위치부터 원본 끝까지 연속이어야 하고 누락·중복·이미 수강한 구간 재배정을 거부한다.
- normalizedDays.capacitySeconds는 **하루 총한도**다. 순수 구간 검증기에 dailyUsage를 별도로 전달해 한 번만 차감한다. 이미 소비한 시간이 한도보다 크면 추가 배정은 0이며 과거 소비를 줄이지 않는다.
- 이월 후보는 기존 현재 버전의 과거 미완료 구간 중 최초 날짜와 대조한다. 제안만으로 실제 이월을 만들지 않는다. 확정 후 최초 날짜를 바꾸거나 null로 초기화하지 않으며, 제외한 항목의 진도·이월도 보존한다. 우선 배치 계산은 도메인 책임이다.
- 실제 카탈로그 참조·초·커버리지·순서는 순수 구간 검증기로 방어한다. 재등록의 이어가기/새로 시작 및 완료 승계는 미결이며 저장층에서 임의 결정하지 않는다.

## 실제 진도와 첫 피드백

`recordProgress`는 학생·계획·현재 itemKey와 안정적 idempotencyKey, positionSeconds, spentSeconds를 받는다. 위치는 원본 범위 안의 단조 증가 정수 초이고 같은 위치에서도 양수 소비 초를 기록할 수 있다. spentSeconds는 0~86400 정수 초이며 위치 차이로 추정하지 않는다. 위치와 소비가 모두 변하지 않는 event는 거부한다. 날짜는 DB 시각의 Asia/Seoul 날짜로 부여하며 호출자가 지정하지 않는다.

위치·event·일별 집계 근거·최초 실제 완료·선택적 종료 피드백·실행 revision을 원자적으로 저장한다. event 하나는 revision을 한 번 올리고 과거 제안의 basis를 무효화한다. 종료 위치에 도달했을 때만 최초 완료 시각을 생성하며 예정 구간 종료를 실제 완료로 간주하지 않는다.

- 진행 key는 `(planId,progress,key)`, 피드백 key는 `(planId,feedback,key)`로 namespace가 분리된다. 같은 문자열을 두 종류에 사용할 수 있다.
- 정확한 진행 key 재시도는 당시 event·날짜·결과를 반환하고 시간을 다시 더하지 않는다. 같은 key의 변경된 내용은 충돌한다. **같은 값에 새 진행 key를 붙이면 새 event**이므로 소비 시간이 추가된다. 호출자는 재시도에 동일 key를 유지해야 한다.
- 실제 종료 시 피드백을 생략하면 payload는 null이다. `{}`는 제출된 피드백이며 null과 다르다. 종료 event에 첫 피드백을 동봉할 수도 있다.
- `recordCompletion`은 명칭과 달리 **실제 종료 후 첫 피드백 제출만** 담당한다. 강제 완료·위치 변경·소비 시간 추정을 하지 않는다. 첫 별도 제출은 실행 revision을 한 번 올리며 실제 완료 시각은 보존한다.
- 같은 항목·canonical 피드백은 새 key도 alias로 보존하고 최초 결과를 반환한다. 다른 대상에 key 재사용 또는 다른 피드백 덮어쓰기는 충돌한다. 수정 API는 없다.

## 0007 데이터 이행

0008은 기존 whole 배치를 시작 0/종료 원본 길이/segmentKey=itemKey로 이행한다. 항목 원본은 최초 버전의 item snapshot에서 복구하며 출처가 없으면 migration 전체를 실패시킨다. 현재 카탈로그로 과거 메타데이터를 꾸미지 않는다.

기존 완료 항목은 실제 위치를 원본 끝으로 옮기고 제출된 피드백을 별도 테이블에 복사한다. 최초 완료 시각·기존 key·버전 JSON은 변경하지 않는다. 기록되지 않은 소비 시간을 추정해 event를 만들지 않는다. 조회 시 과거 whole 후보만 구간 view로 정규화하고 legacyNormalized를 표시하며 당시 미기록 progressSnapshot은 null로 반환한다. 원본 JSON을 다시 저장하지 않는다.

## 전용 DB 검증

### R3 로컬 학생 대상 조회

`apps/api/src/db/learning-plan-student-directory.ts`는 기존 학습 repository와 분리된 읽기 전용 directory다. `listStudentTargets()`는 활성 학생의 `{studentId,hasLearningPlan}`만 ID 순서로 반환하며 이름·학습 내용은 노출하지 않는다. hasLearningPlan은 현재 버전 포인터의 존재를 뜻한다. 제안만 생성된 학생은 false다. `assertStudentExists(studentId)`는 같은 활성 학생 집합을 검사하며 미존재·비활성은 NOT_FOUND, 잘못된 ID 형식은 INVALID_CANDIDATE다. 학생이나 계획을 암묵 생성하지 않는다.

이는 로컬 개발 selector용이며 인증 구현이 아니다. 학생 대상을 서버 대화 binding에 결속하고 목록·이름·실제 학생 ID를 LLM에 보내지 않는 책임은 백엔드에 있다. 신규 migration·학생 등록·영구 대화 저장은 추가하지 않는다.

`test/helpers/learning-plan-state-audit.ts`의 `readLearningPlanStateAudit(pool,studentId)`는 제안 행을 제외한 계획·버전·구간·실제 진도·피드백·event·key를 읽기 전용 일관 snapshot으로 반환한다. 통합 검증에서 대화의 제안 생성 전후 학습 상태 불변을 SQL로 대조할 수 있다. 검사 결과 자체를 모델 입력으로 전달하지 않는다.

### 실행

저장소 루트의 Git 제외 `.env.learning-plan-test.local`을 사용한다. 이전 환경 파일은 덮어쓰지 않는다. 테스트는 TEST_DATABASE_URL과 명시 허용을 요구하고 `test_learning_plan_` 전용 이름·migration 이력을 확인한다. 개발 DB URL을 테스트에 넣지 않는다.

API 폴더에서:

```bash
# 새 환경 파일이 없을 때만 새 DB를 생성한다. 기존 DB의 reset/drop/seed는 없다.
node --import tsx scripts/prepare-learning-plan-test-db.ts --allow-create-test-database
node --env-file=../../.env.learning-plan-test.local --import tsx src/db/migrate.ts
node --env-file=../../.env.learning-plan-test.local --import tsx --test test/learning-plan.repository.test.ts
# 위 저장 검증과 동시에 실행하지 않는다.
node --env-file=../../.env.learning-plan-test.local --import tsx --test test/learning-plan-student-directory.test.ts
```

같은 전용 DB 검사 명령을 저장소 루트에서 `pnpm --filter @ai-homeroom/api test:db:learning-plan`으로 실행할 수 있다. 기존 `test:db`와 비DB 기본 `test`는 별도 검사이며 이 테스트를 대신하지 않는다.

준비 fixture는 카탈로그만 적재하고 mock 재생 대상을 만들지 않는다. 테스트는 실제 카탈로그의 전체 강의를 사용하되 배치는 저장 경계 검사용 입력으로 만든다. 이것을 제품 편성 엔진의 결과로 간주하지 않는다. 무작위 테스트 학생만 정리하고 카탈로그 변경/실패 주입 trigger를 복구한다. 해당 DB에서 다른 검증을 동시에 실행하지 않는다.

저장 경계 검사는 기존18개에 구간·35분 실제 진도·동시 event 재시도·역행/범위·재수강 소비·피드백 null/첫 제출·하루 총한도의 단일 차감·과목 제외 후 이력·이월 보존/롤백·feedback 저장 실패/복구·0007 실데이터 이행/실패 롤백을 추가했다. 검사 후 자기 학생 행과 임시 schema/trigger/function을 정리하고 전체 카탈로그를 원본과 대조한다. 별도 연결의 복구는 확인하지만 실제 HTTP 서버 프로세스 재시작은 통합 검증 책임이다. URL 없는 skip은 DB 통과가 아니다.
