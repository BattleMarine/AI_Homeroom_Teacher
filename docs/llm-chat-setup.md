# 아주LLM 대화와 학습 도구 연결

범위: R3의 실제 모델 도구 호출과 R4의 최소 대화·수동 기록 화면. 기존 학습 계획 서비스를 조회·제안·기록에 재사용하며 계획 변경은 별도 확인 동작으로만 확정한다. 메인 화면 재설계·재등록 정책·복습 콘텐츠·스트리밍·대화 영구 저장은 제외한다. 구현과 실제 검증 상태는 아래에서 구분한다.

## 로컬 설정과 실행

1. 루트 `.env.llm.example`을 `.env.llm.local`로 복사한다. 이 로컬 파일은 Git 제외 대상이다.
2. 아주LLM에서 발급받은 키를 `MINDLOGIC_API_KEY`, 사용 가능한 모델 ID를 `LLM_MODEL`에 로컬에서 입력한다. 채팅·Git·프론트 환경변수(`VITE_*`)에는 키를 넣지 않는다.
3. `pnpm dev`를 실행하고 화면 상단의 **실제 LLM 대화**로 이동한다(`/?view=llm`). 설정 변경 후에는 백엔드를 재시작한다.

개발 실행기는 PostgreSQL·메모리 모드 모두 선택적인 `.env.llm.local`을 읽는다. 기존 셸 환경변수가 우선한다. 직접 `server.ts` 또는 빌드된 서버를 실행할 때는 같은 환경변수를 별도로 전달한다. `.env.db.local`이나 프론트 프록시 설정을 변경하지 않는다.

모델은 임의로 기본값을 정하지 않는다. 키 준비 후 `GET /v1/gateway/models/?type=llm`으로 계정의 모델 목록을 확인하고 Chat Completions 지원 모델을 선택한다. 기본 제공사 주소는 아주LLM Gateway이며 `LLM_BASE_URL`로 HTTPS 주소만 설정할 수 있다. 키는 선택한 주소로 전송되므로 신뢰하는 게이트웨이만 설정한다.

## 대화 계약

- `GET /api/llm-chat/status`: `configured`, `toolsEnabled`, `historyStorage:"client-memory"`, `studentSelection:"local-development-only"`. configured는 설정 존재 여부이며 키 유효성·연결 성공 판정이 아니다. 도구는 PostgreSQL 서비스·카탈로그·학생 조회가 주입될 때 활성화한다.
- `GET /api/llm-chat/students`: `{students:[{studentId,hasLearningPlan}]}`. 활성(`active`)·데모(`demo`) 학생을 읽으며 이름·개인정보를 반환하거나 학생을 생성하지 않는다. 기본 seed 학생 `000`도 선택할 수 있고 비활성 학생은 제외한다. 이 목록은 모델에게 전달하지 않는다.
- `POST /api/llm-chat/bind`: `{studentId}` → `{bindingToken,studentId,expiresAt}`. 서버의 서명 토큰에 대상을 결속한다. 유효기간은 1시간이며 서버 재시작 시 무효다. 로컬 개발용 대상 선택으로 인증·학생 소유권 검증을 구현한 것은 아니다.
- `POST /api/llm-chat/current`: `{bindingToken}` → 기존 전체 계획 조회 응답과 `learningView`. 계획 없음은 404다. `learningView`는 서버의 같은 조회 snapshot으로 만든 `todayDate/items/assignments/days/today`이며 강좌·강의 제목, 실제 위치·잔여, 전체 완료·첫 피드백, 예정 구간 잔여를 표시한다. `items.completed`는 실제 강의 전체 완료 기록, `assignments.completed`는 해당 예정 구간의 실제 수강 커버 여부다. `days.remainingScheduledSeconds`는 예정 중 미수강 잔여이며 원본 `scheduledSeconds`와 구분한다. 기간 밖 오늘에도 실제 사용시간을 유지하고 `inPlanPeriod:false`로 표시한다. 프론트는 이 값을 재계산하지 않는다.
- `POST /api/llm-chat/messages`: `{bindingToken,messages:[{role:"user"|"assistant",content:string}]}`. 사용자부터 교대로 시작해 사용자로 끝나는 최대 31개 메시지, 전체 60,000자, 사용자 메시지당 4,000자, AI 메시지당 16,000자까지 허용한다. 한도를 넘으면 새 대화가 필요하며 이전 기록을 몰래 자르지 않는다.
- 응답: `{message:{role:"assistant",content:string},model,proposalCards,toolResults,stateChanged:false,providerUsage}`. 카드는 서버 도구 실행이 저장한 기존 `proposed` 결과(`proposal,candidate,diff,warnings`)다. 모델 설명문에서 카드·제안 ID·basis를 추출하지 않는다. 프론트는 모델 설명을 텍스트로 렌더링한다.
- `POST /api/llm-chat/confirm`: `{bindingToken,proposalId,expectedBasis}` → 기존 학습 계획 확정 결과. 별도 사용자 클릭 경로이며 모델 도구로 제공하지 않는다. 카드의 `proposal.expectedBasis`를 그대로 보내고 기존 학생·revision·유효 상태·중복·원자성 검증을 적용한다.
- `POST /api/llm-chat/progress`: `{bindingToken,itemKey,idempotencyKey,positionSeconds,spentSeconds,feedback?}` → 기존 `{event,progress,completion,completionRevision,replayed}`. 영상 처음부터의 실제 누적 위치와 이번 기록의 실제 사용시간을 분리한다. 서버가 학생·현재 계획·한국 날짜를 결정하며 `studentId/planId/studyDate` 추가 인수는 거절한다. 예정 구간을 실제 수강으로 바꾸지 않는다.
- `POST /api/llm-chat/feedback`: `{bindingToken,itemKey,idempotencyKey,feedback}` → 기존 `{completion,replayed}`. 실제 완료 강의의 첫 피드백만 기록한다. `understandingLevel/focusLevel`은 각각 1~5 필수이고 `weakConcepts/comment`는 선택이다. 이 두 기록 API도 모델 도구가 아니다.
- 백엔드는 서버 지침·도구 정의를 추가해 아주LLM의 `/chat/completions/`를 비스트리밍 호출한다. 클라이언트가 모델·시스템 지침·도구를 지정할 수 없다. 모델 도구 인수의 추가 필드는 거절하며 학생·계획·basis는 서버가 주입한다.
- 대화는 현재 화면과 해당 요청의 메모리만 사용한다. 새로고침·화면 이동 후 복구되지 않으며 DB·localStorage에 저장하지 않는다. 학생 전환 시 대화·대기 카드를 초기화하고 이전 요청의 늦은 응답을 무시한다. 저장된 학습 계획은 서버에서 다시 조회한다.
- 실패 시 기존 메시지와 작성 입력을 보존한다. 자동 재시도는 하지 않는다. 타임아웃 후 사용자가 재시도하면 제공사에서 중복 과금될 수 있다.
- 수동 기록은 첫 전송의 `idempotencyKey`와 본문을 메모리에 고정하고 오류·응답 유실·재연결 후 그대로 재시도한다. 결과가 불명확한 동안 새 기록·제안 확정을 막는다. 400/422 입력 거절을 명시적으로 종료한 경우만 수정한 새 기록을 새 키로 보낸다. 저장 성공 뒤 현재 조회 실패는 저장 실패와 구분하고 조회만 재시도한다. 기록 성공 또는 계획 버전·revision 변경 후 이전 제안은 새 제안이 필요하다고 표시한다. 추가·교체 제안의 카탈로그 해시는 현재 선택과 달라질 수 있어 화면에서 같다고 강제하지 않으며 원본 `expectedBasis`를 확정 API로 보내 서버가 검증한다. 새로고침 후 기록은 서버에서 복구하지만 전송 결과가 불명확한 요청의 메모리 초안은 복구하지 않는다.

### 모델 도구와 제안 경계

| 도구 | 책임 |
| --- | --- |
| `list_courses`, `get_course_catalog` | 실제 강좌·강의 식별자·순서·시간 조회 |
| `read_current_plan` | 결속 학생의 현재 계획·진도·당일 사용시간 조회 |
| `propose_create_plan` | 강좌·기한·하루 시간 조건을 받은 최초 전체 계획 제안 |
| `propose_adjust_plan` | 명시한 예정 구간 이동·교환과 충돌 검사 |
| `propose_rebalance_plan` | 남은 진도와 조건·과목 선택 변경의 전체 재편성 제안 |

과목 선택은 `keep/add/remove/replace`를 구분하며 `add`는 서버가 기존 목록과 합친다. 오늘 총시간·추가시간은 `todayTime.total/additional`, 평소 시간은 `availableSecondsPerDay`로 전달한다. 실제 진행 시간 조회와 추가시간 덧셈은 기존 백엔드가 수행한다. 강좌·기한·시간이나 삭제 범위가 모호하면 모델은 질문해야 한다. SQL·확정·진도·피드백 기록 도구는 없다.

제안 저장과 현재 계획 변경은 다르다. 제안 후 설명 생성이 실패해도 이미 저장한 `proposalCards/toolResults`와 `stateChanged:false`를 안전 오류 응답에 보존한다. 프론트는 대기 제안과 오류를 함께 표시하며 자동 확정하지 않는다. 보류는 현재 상태를 바꾸지 않고, 오래된 카드의 확정은 409로 안내하고 재제안한다.

## 실패와 보호

키·모델 미설정은 503, 입력 오류는 400, 자체 동시/빈도 제한과 제공사 한도는 429, 제공사 인증·크레딧·연결·불완전 응답은 502, 제공사 대기 시간 초과는 504로 알린다. 제공사 원문 오류·키·대화 본문을 서버 로그에 남기거나 원문 오류를 사용자에게 전달하지 않는다. mock으로 대체하지 않는다.

한 요청 전체 대기는 60초, 프론트 대기는 70초다. 요청당 모델 호출 최대 6회·도구 실행 최대 8회·제안 시도 최대 1회이며 도구 결과를 포함한 내부 대화는 500,000자까지다. 서버 프로세스 전체 동시 2건·분당 20건 제한이며 재시작 시 초기화된다. 출력 예산은 내부 추론을 포함한 최대 16,000토큰이다. 잘린 응답·잘못된 도구/인수·빈 텍스트·16,000자 초과 설명은 명시적으로 실패 처리한다. 자동 재시도·모델 교체·mock 대체는 없으며 프론트 취소가 제공사 과금 취소를 보장하지 않는다.

60초 경계는 모델·도구 처리의 응답 대기 상한이다. 기존 repository의 DB 쿼리 자체를 강제 취소하지 않는다. 제한 시간 뒤 늦게 끝난 작업이 대기 제안 행을 남길 수 있으며, 아직 확보하지 못한 카드를 응답에 꾸며 넣지 않는다. 확정 도구는 없으므로 이 작업으로 현재 계획·진도는 바뀌지 않는다. 별도 결속·현재 조회·확정 API의 DB 대기 취소 계약도 추가하지 않았다.

`GET /api/llm-chat/runtime-stats`는 프로세스 누적 `{attempts,completed,failed,usage:{필드:{total,reports}}}`를 반환한다. 실패 요청도 attempts에 포함한다. prompt/completion/total/cached/reasoning 토큰과 크레딧은 제공사가 반환한 값만 합산하며 누락을 0원·0토큰으로 해석하지 않는다. 재시작 시 통계는 초기화되므로 검증기는 종료 전 값을 기록한다. 게이트웨이 내부의 업스트림 재시도 여부는 이 통계만으로 관찰할 수 없다.

**현재 인증 없는 로컬 개발용이다. 공개 배포하지 않는다.** 다사용자 공개 전에는 인증·학생 소유권·사용자별 비용 한도·로그 정책이 필요하다. 대화 검증에는 전용 DB의 가상 학생만 사용하며 실제 학생 개인정보·키·접속정보·원문 대화를 로그나 검증 보고서에 남기지 않는다.

## 검증 및 다음 단계

- `pnpm build`, `pnpm build:api`, `pnpm --filter @ai-homeroom/api test`.
- 대화 테스트는 외부 HTTP 응답만 테스트용으로 대체하며 실제 키 검증·모델 품질·과금 검증을 뜻하지 않는다.
- 실제 도구 호출 검증은 별도 `verify:learning-plan:llm` 명령으로 실행한다. `.env.learning-plan-test.local`과 `.env.llm.local`, 명시적인 `VERIFY_LLM_ALLOW_PROVIDER=1`이 필요하며 외부 과금이 발생한다. 기본 테스트·빌드에는 포함하지 않는다.
- 실제 검증 스크립트는 현재 실제 카탈로그를 SQL로 조회하고 가상 학생만 생성한다. 모델 요청 40회 이내로 생성·시간 범위·명시 교환·이월 재편성·국어 추가·질문을 검사한다. 제안 전후 SQL 불변, 별도 확정, 독립 구간·시간·순서 검사, 실제 서버 OS 프로세스 재시작을 대조하고 자신이 만든 학생·학습 행만 정리한다.
- 여러 실행을 이어갈 때 `VERIFY_LLM_PROVIDER_BUDGET`에 남은 요청 수(6~40)를 지정한다. `VERIFY_LLM_PHASE=remaining`은 앞 5사례의 상태를 실제 구조화 API로 준비하고 이월·추가·질문만 실제 모델로 검사한다. 출력에서 직접 API 준비와 실모델 검증을 구분하며 이전 실행의 계수도 합산한다.
- R4 실제 브라우저 검증은 Windows Node에서 `apps/api/scripts/verify-learning-plan-browser.cjs`를 실행한다. `R3_PLAYWRIGHT_MODULE`은 설치된 Playwright 모듈 경로, `R3_BROWSER_EXE`는 설치된 Edge 실행 파일 경로다. 기존 WSL Node·환경 파일을 사용해 본인의 임시 API/Vite와 전용 DB 가상학생만 만들고 종료 시 정리한다. `--prepare-only`는 외부 호출 없이 준비만 확인한다. 실제 실행 전 전송 대상·데이터와 남은 호출 한도를 승인받고 `VERIFY_LLM_PROVIDER_BUDGET`으로 지정한다. 한도 확인은 매 사용자 메시지 전 최대 6회 여유를 요구하며 자동 모델 재시도는 하지 않는다. 내부 ID 없는 자연어·화면 확인·수동 기록 응답 유실·독립 SQL·실제 API 프로세스 재시작을 연결한다. 원문 대화·접속 주소·토큰은 보고서에 출력하지 않는다.
- 이 검증의 `--record-only`는 직접 제품 API로 준비한 계획에서 실제 브라우저·DB의 수동 기록 유실/재시도만 확인하며 모델 호출은 없다. `--remaining`은 이미 실모델·브라우저로 통과한 최초 생성 상태, `--final`은 최초 생성·실제35분·오늘85분 상태만 직접 API로 준비하고 남은 사례를 실제 모델로 실행한다. 직접 준비를 자연어/브라우저 재검증으로 세지 않으며 전체 실행의 실패 횟수와 사용량 수집 누락도 합산·명시한다. 비정상 종료로 정리 보고가 없으면 별도 READ ONLY 감사 후 해당 검사 소유 행만 정리한다.

2026-09-30 준비 검증: WSL에서 프론트·API 빌드 및 기본 테스트 73개(대화 경계 테스트 8개 포함)가 통과했다. 별도 임시 서버와 프론트 프록시를 통한 실제 HTTP에서 상태 조회 200·설정 누락 503을 확인했다. 사용자의 키·모델 미준비 요청에 따라 외부 모델은 호출하지 않았다. 브라우저 자동화는 샌드박스 실행 오류로 미실행이며 실제 화면 조작과 외부 대화는 후속 검증이다.

R3의 실제 제공사·도구·DB 통합 검증은 사용자 명시 승인 후 31회로 대표 8사례와 실제 서버 재시작 복구를 통과했다. R4는 별도 승인한 40회 중 34회로 내부 ID 없는 자연어와 실제 Edge→모델→도구→화면 확인→독립 SQL을 검증했다. 수동 기록·동일 키 재시도·학생 격리·조회 오류·새로고침·실제 API 프로세스 재시작 복구도 통과했다. 전체를 한 실행에서 반복한 것이 아니라 선행 통과 상태만 직접 제품 API로 준비한 후속 검증을 합산했다. 실패 이력·사용량 누락·단계별 근거는 [로드맵](./learning-plan-roadmap.md)에 기록한다. 독립 검토와 사용자 최종 판단은 별도다.

공식 근거: [개요](https://docs.mindlogic.ai/docs/general/api-gateway/getting-started/overview), [채팅 API와 도구 정의](https://docs.mindlogic.ai/docs/general/api-gateway/reference/chat-completions), [모델](https://docs.mindlogic.ai/docs/general/gateway/getting-started/models).
