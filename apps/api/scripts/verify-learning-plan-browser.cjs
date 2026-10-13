const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { chromium } = require(process.env.R3_PLAYWRIGHT_MODULE);

// Windows의 새 Edge 프로필을 사용한다. 키와 DB 주소는 WSL의 환경 파일에서만 읽는다.
const budget = Number(process.env.VERIFY_LLM_PROVIDER_BUDGET ?? "40");
const recordOnly = process.argv.includes("--record-only");
const finalPhase = process.argv.includes("--final");
assert.ok(Number.isSafeInteger(budget) && budget >= 6 && budget <= 40);
const manager = spawn("wsl.exe", ["-d", "Ubuntu", "--cd", "/mnt/d/Projects/AI_Homeroom_Teacher/apps/api", "bash", "-ic",
  "VERIFY_LLM_ALLOW_PROVIDER=1 node --env-file=../../.env.learning-plan-test.local --env-file=../../.env.llm.local --import tsx scripts/learning-plan-browser-session.ts"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let serial = 0;
const pending = new Map();
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
const lines = createInterface({ input: manager.stdout });
let managerFailed = false;
manager.stderr.on("data", () => { /* 서버·환경 원문을 공개 로그로 복사하지 않는다. */ });
lines.on("line", line => {
  try {
    const message = JSON.parse(line);
    if (message.ready) resolveReady(message);
    else if (message.fatal) { fixtureCleaned = message.cleaned; rejectReady(new Error("검증 세션 준비 실패")); }
    else if (pending.has(message.id)) { const handler = pending.get(message.id); pending.delete(message.id); clearTimeout(handler.timer); message.error ? handler.reject(new Error(message.error)) : handler.resolve(message.result); }
  } catch { /* 셸 초기화 출력은 버린다. */ }
});
manager.on("error", () => { managerFailed = true; rejectReady(new Error("검증 세션 시작 실패")); });
manager.on("exit", () => {
  rejectReady(new Error("검증 세션 종료"));
  for (const handler of pending.values()) { clearTimeout(handler.timer); handler.reject(new Error("검증 세션 종료")); } pending.clear();
});
function command(command, input) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("검증 명령 시간 초과")); }, 30000);
    pending.set(id, { resolve, reject, timer }); manager.stdin.write(JSON.stringify({ id, command, input }) + "\n");
  });
}
const passed = [];
let stage = "준비", browser, context, current, provider = null, fixtureCleaned = false, restarted = false;
(async () => {
  const environment = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("검증 준비 제한 시간")), 30000).unref())]);
  stage = "Edge 시작";
  browser = await chromium.launch({ executablePath: process.env.R3_BROWSER_EXE, headless: true });
  context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("response", async response => {
    if (response.url().endsWith("/api/llm-chat/current") && response.status() === 200) {
      try { current = await response.json(); } catch { /* 강제 통신 실패는 UI 복구 검사에서 처리한다. */ }
    }
  });
  stage = "프론트 화면 열기";
  for (let n = 0; ; n++) {
    try { await page.goto(environment.origin + "/?view=llm"); break; }
    catch (error) { if (n >= 10) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  stage = "학생 목록 연결";
  await select(0);
  assert.equal((await command("stats")).attempts, 0);
  if (process.argv.includes("--prepare-only")) { passed.push("실제 브라우저·학생 결속·전용 DB·임시 프록시 준비(외부 호출0)"); return; }
  const today = seoulDate(), deadline = addDays(today, 240);

  stage = "일반 자연어 최초 생성";
  if (process.argv.includes("--remaining") || recordOnly || finalPhase) {
    await command("prepare", { startDate: addDays(today, -2), deadlineDate: deadline, advanced: finalPhase }); await refresh(); await command("check");
    passed.push(finalPhase ? "직접 API 준비: 앞 실행에서 실모델/브라우저로 통과한91강·실제35분·오늘85분 상태" : "직접 API 준비: 앞 실행에서 실제 모델/브라우저로 통과한91강 생성 상태");
  } else {
    const created = await proposal(`수학과 영어 강좌 전체를 ${addDays(today, -2)}부터 ${deadline}까지 계획해줘. 평소 하루 총 100분이고 계획은 제안만 해줘.`);
    assert.equal(created.candidate.items.length, 91);
    await command("checkCandidate", created.candidate);
    await lastCard().getByRole("button", { name: "지금은 보류", exact: true }).click();
    assert.equal((await command("audit")).counts.learning_plans, 0);
    await lastCard().getByRole("button", { name: "변경안 다시 검토", exact: true }).click();
    await confirm(); await command("check");
    passed.push("내부ID 없는 생성·실제91강·보류와 확인 전 SQL 불변·화면 명시 확정");
  }
  const plan = await command("read");
  const firstAssignment = plan.assignments[0];
  const firstKey = finalPhase ? plan.progress.find(item => item.positionSeconds === 2100)?.itemKey : firstAssignment.itemKey;
  const first = plan.version.candidate.items.find(item => item.itemKey === firstKey);
  assert.ok(first);
  assert.ok(first.durationSeconds > 2100);

  if (!finalPhase) {
  stage = "오래된 카드와 기록 응답 유실 재시도";
  const stale = recordOnly ? null : await proposal("오늘만 총 50분으로 줄이고 평소 100분은 유지해서 기존 기한까지 전체 재편성해줘.");
  await page.locator("#llm-record-item").selectOption(first.itemKey);
  await page.locator("#llm-record-position").fill("2100");
  await page.locator("#llm-record-spent").fill("2100");
  let lost = false;
  let resolveLost;
  const lossFinished = new Promise(resolve => { resolveLost = resolve; });
  await page.route("**/api/llm-chat/progress", async route => {
    try {
      if (lost) return await route.continue(); lost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed"); resolveLost(true);
    } catch { resolveLost(false); }
  });
  await page.getByRole("button", { name: "진도·완료 기록 저장", exact: true }).click();
  assert.equal(await Promise.race([lossFinished, new Promise(resolve => setTimeout(() => resolve(false), 20000))]), true);
  await idle();
  await page.getByRole("button", { name: "같은 기록 재시도", exact: true }).waitFor();
  const afterLost = await command("audit");
  assert.equal(afterLost.counts.learning_plan_progress_events, 1);
  await recordAction("progress", () => page.getByRole("button", { name: "같은 기록 재시도", exact: true }).click());
  await page.unroute("**/api/llm-chat/progress");
  assert.equal((await command("audit")).counts.learning_plan_progress_events, 1);
  assert.equal((await command("read")).dailyUsage.find(day => day.studyDate === today).spentSeconds, 2100);
  if (stale) {
    assert.equal((await command("stale", stale)).code, "BASIS_CONFLICT");
    await lastCard().getByText("현재 계획을 확인한 뒤 대화로 새 변경안을 요청해주세요.", { exact: true }).waitFor();
  }
  passed.push(recordOnly ? "직접 API 준비·실제 부분 수강·응답 유실 뒤 동일 기록 재시도·중복시간 없음(외부0)" : "실제 부분 수강·응답 유실 뒤 동일 기록 재시도·중복시간 없음·카드 stale 및 서버409");
  if (recordOnly) return;

  stage = "오늘 총시간";
  const total = await proposal("오늘 공부시간은 이미 쓴 시간을 포함해 총 50분이야. 평소 하루 100분은 유지하고 같은 기한까지 남은 전체 진도를 재편성해줘.");
  assert.equal(total.candidate.normalizedDays.find(day => day.date === today).capacitySeconds, 3000);
  assert.equal(total.candidate.conditions.availableSecondsPerDay, 6000);
  assert.ok(total.candidate.assignments.filter(item => item.date === today).reduce((sum, item) => sum + item.durationSeconds, 0) <= 900);
  await confirm(); await command("check");
  passed.push("오늘 총50분·실제35분 차감·잔여15분·평소100분 유지");

  stage = "오늘 추가시간";
  const additional = await proposal("지금부터 오늘 공부할 시간을 50분 더 확보했어. 이미 공부한 시간에 추가하는 50분이고 평소 시간은 유지해서 다시 전체 재편성해줘.");
  assert.equal(additional.candidate.normalizedDays.find(day => day.date === today).capacitySeconds, 5100);
  await confirm(); await command("check");
  passed.push("추가50분 서버 계산·오늘 총85분·시간예외 유지");
  }

  stage = "일반 자연어 과목 추가";
  const added = await proposal("국어도 추가해줘. 기존 수학과 영어, 실제 진행 기록을 보존해서 같은 기한과 시간 조건으로 전체 계획에 통합해줘.");
  assert.equal(added.candidate.items.length, 126);
  assert.equal(added.candidate.items.reduce((sum, item) => sum + item.durationSeconds, 0), 419939);
  await confirm(); await command("check");
  passed.push("내부ID 없는 국어 추가·실제126강419939초·기존 과목/진도 보존");

  stage = "수동 완료와 첫 피드백";
  await page.locator("#llm-record-item").selectOption(first.itemKey);
  await page.getByLabel("강의 전체를 실제로 끝까지 수강했습니다", { exact: true }).check();
  await page.locator("#llm-record-spent").fill(String(first.durationSeconds - 2100));
  await recordAction("progress", () => page.getByRole("button", { name: "진도·완료 기록 저장", exact: true }).click());
  await page.locator("#llm-feedback-item").selectOption(first.itemKey);
  await page.locator("#llm-feedback-understanding").selectOption("4");
  await page.locator("#llm-feedback-focus").selectOption("4");
  await page.locator("#llm-feedback-comment").fill("가상 학습 검증 피드백");
  await recordAction("feedback", () => page.getByRole("button", { name: "첫 피드백 저장", exact: true }).click());
  const completed = await command("read");
  assert.equal(completed.completions.length, 1);
  assert.equal((await command("audit")).counts.learning_plan_feedbacks, 1);
  passed.push("수동 전체 완료·첫 피드백·예정과 실제 분리");

  stage = "제목과 날짜로 명시 이동 충돌";
  await refresh();
  const target = current.learningView.assignments.find(item => item.date > today && !item.completed);
  assert.ok(target && target.lessonTitle);
  const beforeMove = await command("audit");
  const move = await turn(`${target.courseTitle}의 '${target.lessonTitle}' 강의 중 ${target.date}에 예정된 구간만 ${addDays(today, -1)}의 순서 1로 이동해줘. 다른 구간은 바꾸지 말고 전체 재편성도 하지 마. 충돌하면 이유를 알려줘.`);
  assert.equal(move.proposalCards.length, 0);
  assert.ok(move.toolResults.some(result => result.tool === "propose_adjust_plan" && result.kind !== "proposed"));
  assert.equal((await command("audit")).digest, beforeMove.digest);
  passed.push("내부구간ID 없는 제목·날짜 이동·서버 충돌·요청 밖 SQL 불변");

  stage = "이월 전체 재편성";
  const carry = completed.progress.filter(item => item.carryoverSinceDate);
  const rebalance = await proposal(`밀린 진도를 오늘 ${today}부터 기존 마감일까지 남은 기간에 다시 나눠줘. 완료와 피드백, 평소 시간 및 오늘 예외는 유지해줘.`);
  assert.ok(!rebalance.candidate.assignments.some(item => item.itemKey === first.itemKey));
  await confirm(); await command("check");
  const finalPlan = await command("read");
  assert.deepEqual(finalPlan.completions, completed.completions);
  for (const item of carry) assert.equal(finalPlan.progress.find(p => p.itemKey === item.itemKey).carryoverSinceDate, item.carryoverSinceDate);
  passed.push("이월 재편성·실제 완료/피드백·최초 이월일 보존");

  stage = "학생 전환·모호한 요청";
  const primary = await command("audit");
  const isolated = await command("audit", { student: 1 });
  await select(1);
  assert.equal(await page.getByRole("region", { name: "학습 계획 변경안", exact: true }).count(), 0);
  assert.equal(await page.locator(".llm-message").count(), 0);
  const ambiguous = await turn("학습 계획을 만들어줘.");
  assert.equal(ambiguous.proposalCards.length, 0);
  assert.equal((await command("audit", { student: 1 })).digest, isolated.digest);
  assert.equal((await command("audit")).digest, primary.digest);
  passed.push("학생 전환 대화/카드 초기화·모호한 입력 질문·학생 SQL 격리");

  stage = "조회 실패·새로고침·실제 서버 재시작";
  await select(0);
  await page.route("**/api/llm-chat/current", route => route.abort("failed"), { times: 1 });
  await page.getByRole("button", { name: "계획 다시 조회", exact: true }).click();
  await page.getByText(/마지막 정상 조회 결과를 유지합니다/).waitFor();
  assert.ok((await page.getByRole("region", { name: "서버 학습 계획", exact: true }).textContent()).includes("실제 완료 1개"));
  await refresh(); await page.reload(); await select(0);
  assert.equal((await command("audit")).digest, primary.digest);
  const restart = await command("restart"); restarted = restart.differentPid; provider = restart.providerBeforeRestart;
  assert.equal(restarted, true);
  await page.getByRole("button", { name: "계획 다시 조회", exact: true }).click();
  await page.getByRole("button", { name: "같은 학생 다시 연결", exact: true }).waitFor();
  await page.getByRole("button", { name: "같은 학생 다시 연결", exact: true }).click();
  await idle(); await command("check");
  assert.equal((await command("audit")).digest, primary.digest);
  passed.push("오류 뒤 마지막 정상 상태·조회 재시도·새로고침·실제 OS 프로세스 재시작 및 재결속");

  function lastCard() { return page.getByRole("region", { name: "학습 계획 변경안", exact: true }).last(); }
  async function idle() { await page.waitForFunction(() => !document.querySelector("#llm-input").disabled); }
  async function select(index) {
    await page.waitForFunction(() => document.querySelector("#llm-student")?.options.length >= 3 && !document.querySelector("#llm-student").disabled);
    current = undefined; await page.getByLabel("학생 선택 (로컬 개발용)", { exact: true }).selectOption(environment.students[index]); await idle();
  }
  async function refresh() {
    const response = page.waitForResponse(response => response.url().endsWith("/api/llm-chat/current") && response.status() === 200);
    await page.getByRole("button", { name: "계획 다시 조회", exact: true }).click(); current = await (await response).json(); await idle();
  }
  async function turn(content) {
    const stats = await command("stats"); assert.ok(stats.attempts + 6 <= budget, "실제 제공사 잔여 호출 한도 부족");
    const response = page.waitForResponse(response => response.url().endsWith("/api/llm-chat/messages"), { timeout: 70000 });
    await page.getByLabel("메시지", { exact: true }).fill(content);
    await page.locator(".llm-chat-composer").getByRole("button").click();
    const actual = await response; assert.equal(actual.status(), 200, "실제 LLM 요청 실패"); const reply = await actual.json(); await idle();
    console.log(JSON.stringify({ stage, provider: await command("stats") })); return reply;
  }
  async function proposal(content) {
    const before = await command("audit"); const reply = await turn(content);
    assert.equal(reply.proposalCards.length, 1, "구조화 제안 카드 없음");
    assert.equal((await command("audit")).digest, before.digest, "확인 전 학습 SQL 변경");
    await lastCard().getByRole("button", { name: "변경안을 확인하고 적용", exact: true }).waitFor(); return reply.proposalCards[0];
  }
  async function confirm() {
    const response = page.waitForResponse(response => response.url().endsWith("/api/llm-chat/confirm"));
    await lastCard().getByRole("button", { name: "변경안을 확인하고 적용", exact: true }).click();
    assert.equal((await response).status(), 200); await idle(); await refresh();
  }
  async function recordAction(endpoint, action) {
    const response = page.waitForResponse(response => response.url().endsWith("/api/llm-chat/" + endpoint));
    await action(); assert.equal((await response).status(), 200); await idle(); await refresh();
  }
})().catch(error => { console.log(JSON.stringify({ failedStage: stage, errorType: error.name,
  diagnostic: ["ERR_CONNECTION_REFUSED", "ERR_CONNECTION_RESET", "ERR_EMPTY_RESPONSE", "ERR_TIMED_OUT"].find(code => error.message.includes(code)), passed: false })); process.exitCode = 1; }).finally(async () => {
  try { await context?.unrouteAll({ behavior: "ignoreErrors" }); await browser?.close(); } finally {
    try { if (!managerFailed && manager.exitCode === null) { const result = await command("close"); provider ??= result.provider; fixtureCleaned = result.cleaned; } }
    catch { process.exitCode = 1; }
    finally { manager.stdin.end(); }
  }
  console.log(JSON.stringify({ passed, provider, osProcessRestart: restarted, fixtureCleaned }, null, 2));
});
function seoulDate() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(); return ["year", "month", "day"].map(type => parts.find(p => p.type === type).value).join("-"); }
function addDays(date, days) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
