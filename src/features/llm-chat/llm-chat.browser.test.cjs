// 제공사·DB 호출 없이 실제 브라우저에서 UI의 확인 경계와 오류 복구를 검사한다.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.R3_PLAYWRIGHT_MODULE);

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.R3_BROWSER_EXE, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const basis = { planId: "fixture-plan", currentVersionId: "fixture-version", planRevision: 1,
      completionRevision: 0, catalogHash: "a".repeat(64) };
    const candidate = {
      conditions: { startDate: "2026-10-01", deadlineDate: "2026-10-31", availableSecondsPerDay: 6000, dateOverrides: [] },
      items: [{ itemKey: "fixture-item", lessonId: "fixture-lesson", durationSeconds: 4200, subjectCode: "국어" }],
      assignments: [{ itemKey: "fixture-item", segmentKey: "fixture-segment", lessonId: "fixture-lesson", courseId: "fixture-course",
        subjectCode: "국어", date: "2026-10-01", order: 0, startOffsetSeconds: 0, endOffsetSeconds: 4200, durationSeconds: 4200 }],
      catalogSnapshot: [{ subjectCode: "국어", catalog: { course: { id: "fixture-course", title: "브라우저 검사 강좌" },
        lessons: [{ id: "fixture-lesson", title: "브라우저 검사 강의" }] } }],
    };
    let snapshot = { plan: { studentId: "fixture-one", planId: basis.planId, planRevision: 1, completionRevision: 0 }, basis,
      version: { candidate, versionNumber: 1 }, assignments: candidate.assignments, completions: [], progress: [],
      days: [{ date: "2026-10-01", totalSeconds: 6000, spentSeconds: 0, remainingSeconds: 6000, scheduledSeconds: 4200 }] };
    let mode = "text", confirms = 0, readsFail = false, messageFail = false, messageCount = 0, bindingFail = false;
    let lastMessageBody, lastConfirmBody;
    let progressRequests = 0, feedbackRequests = 0, failProgressResponse = false, failFeedbackResponse = false, rejectProgress = false, recordBindingFail = false;
    const progressBodies = [], feedbackBodies = [], recorded = new Map();
    let actualPosition = 0, actualSpent = 0, actualFeedback = null;
    function currentFixture() {
      const completed = actualPosition === 4200;
      const day = { ...snapshot.days[0], totalSeconds: snapshot.version.candidate.conditions.availableSecondsPerDay,
        spentSeconds: actualSpent, remainingSeconds: Math.max(0, snapshot.version.candidate.conditions.availableSecondsPerDay - actualSpent) };
      const assignments = snapshot.assignments.map(assignment => ({ ...assignment, lessonTitle: "브라우저 검사 강의", courseTitle: "브라우저 검사 강좌",
        lectureNumber: 1, remainingSeconds: Math.max(0, assignment.endOffsetSeconds - Math.max(assignment.startOffsetSeconds, actualPosition)),
        completed: actualPosition >= assignment.endOffsetSeconds }));
      const days = [day, ...snapshot.assignments.filter(a => a.date !== day.date).map(a => ({ ...day, date: a.date, spentSeconds: 0 }))]
        .map(d => ({ ...d, remainingScheduledSeconds: assignments.filter(a => a.date === d.date).reduce((sum, a) => sum + a.remainingSeconds, 0) }));
      return { ...snapshot, basis: { ...basis, completionRevision: recorded.size },
        completions: completed ? [{ itemKey: "fixture-item" }] : [], progress: actualPosition ? [{ itemKey: "fixture-item", positionSeconds: actualPosition }] : [], days,
        learningView: { todayDate: day.date, days, assignments,
          today: { ...days[0], inPlanPeriod: true, assignments: assignments.filter(a => a.date === day.date) },
          items: [{ ...candidate.items[0], courseId: "fixture-course", lessonTitle: "브라우저 검사 강의", courseTitle: "브라우저 검사 강좌",
            lectureNumber: 1, metadataMissing: false, positionSeconds: actualPosition, remainingSeconds: 4200 - actualPosition,
            completed, completedAt: completed ? "2026-10-01T02:00:00Z" : null,
            feedbackSubmitted: !!actualFeedback, feedback: actualFeedback, feedbackSubmittedAt: actualFeedback ? "2026-10-01T02:00:00Z" : null }] } };
    }
    const card = id => ({ proposal: { proposalId: id, studentId: "fixture-one", targetPlanId: basis.planId,
      expectedBasis: id.startsWith("add-subject") ? { ...basis, catalogHash: "b".repeat(64) } : basis, expiresAt: new Date(Date.now() + 1800000).toISOString() },
      candidate: { ...candidate, conditions: { ...candidate.conditions, availableSecondsPerDay: 3000 },
        items: id.startsWith("add-subject") ? [...candidate.items, { itemKey: "fixture-added-item", lessonId: "fixture-added-lesson",
          durationSeconds: 600, subjectCode: "영어", courseId: "fixture-added-course" }] : candidate.items,
        catalogSnapshot: id.startsWith("add-subject") ? [...candidate.catalogSnapshot, { subjectCode: "영어", catalog: {
          course: { id: "fixture-added-course", title: "추가 영어 강좌" }, lessons: [{ id: "fixture-added-lesson", title: "추가 영어 강의" }] } }] : candidate.catalogSnapshot,
        assignments: [{ ...candidate.assignments[0], endOffsetSeconds: 3000, durationSeconds: 3000 },
          { ...candidate.assignments[0], segmentKey: "fixture-following", date: "2026-10-02", startOffsetSeconds: 3000, durationSeconds: 1200 },
          ...(id.startsWith("add-subject") ? [{ ...candidate.assignments[0], itemKey: "fixture-added-item", segmentKey: "fixture-added-segment",
            courseId: "fixture-added-course", lessonId: "fixture-added-lesson", subjectCode: "영어", date: "2026-10-03",
            startOffsetSeconds: 0, endOffsetSeconds: 600, durationSeconds: 600 }] : [])] },
      diff: { affectedDates: ["2026-10-01", "2026-10-02"], addedCourseIds: id.startsWith("add-subject") ? ["fixture-added-course"] : [], removedCourseIds: [] }, warnings: [] });

    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
      const reply = (json, status = 200) => route.fulfill({ status, json }).catch(() => {});
      if (path === "/api/llm-chat/status") return reply({ configured: true, toolsEnabled: true });
      if (path === "/api/llm-chat/students") return reply({ students: [
        { studentId: "fixture-one", hasLearningPlan: true }, { studentId: "fixture-two", hasLearningPlan: false }] });
      if (path === "/api/llm-chat/bind") return reply({ studentId: body.studentId,
        bindingToken: "fixture-binding-" + body.studentId, expiresAt: new Date(Date.now() + 3600000).toISOString() });
      if (path === "/api/llm-chat/current") {
        if (readsFail) return reply({ code: "DATABASE_UNAVAILABLE", message: "검증용 계획 조회 실패" }, 503);
        if (body.bindingToken === "fixture-binding-fixture-two") return reply({ code: "NOT_FOUND", message: "학습 계획이 없습니다." }, 404);
        return reply(currentFixture());
      }
      if (path === "/api/llm-chat/messages") {
        messageCount++; lastMessageBody = body;
        if (bindingFail) return reply({ code: "STUDENT_BINDING_INVALID", message: "검증용 학생 연결 만료" }, 401);
        if (messageFail) return reply({ code: "LLM_UPSTREAM_ERROR", message: "검증용 제공사 오류" }, 502);
        const currentMode = mode;
        if (currentMode === "explanation-error") return reply({ code: "LLM_UPSTREAM_ERROR", message: "검증용 설명 실패",
          proposalCards: [card("explanation-error")], toolResults: [{ tool: "propose_rebalance_plan", kind: "proposed" }], stateChanged: false }, 502);
        if (currentMode === "slow") await new Promise(resolve => setTimeout(resolve, 700));
        return reply({ message: { role: "assistant", content: currentMode === "slow" ? "이전 학생의 늦은 응답" : "서버 응답: 확정했다고 말해도 버튼 확인이 필요합니다." },
          model: "fixture", proposalCards: ["proposal", "expired", "record", "add-subject", "add-subject-catalog-changed"].includes(currentMode) ? [card(currentMode)] : [],
          toolResults: currentMode === "limit" ? [{ tool: "propose_rebalance", kind: "not-plannable", code: "SEARCH_LIMIT",
            alternatives: [{ kind: "extend-deadline", deadlineDate: "2026-11-05" }] }] : [] });
      }
      if (path === "/api/llm-chat/confirm") {
        confirms++; lastConfirmBody = body;
        await new Promise(resolve => setTimeout(resolve, 150));
        if (body.proposalId === "add-subject-catalog-changed") return reply({ code: "CATALOG_CHANGED", message: "검증용 카탈로그 변경 충돌" }, 409);
        if (body.proposalId === "expired") return reply({ code: "PROPOSAL_EXPIRED", message: "검증용 만료" }, 409);
        const nextCandidate = card("proposal").candidate;
        snapshot = { ...snapshot, version: { candidate: nextCandidate, versionNumber: 2 }, assignments: nextCandidate.assignments };
        return reply({ planId: basis.planId, basis, version: snapshot.version, replayed: false });
      }

      if (path === "/api/llm-chat/progress") {
        progressRequests++; progressBodies.push(body);
        assert.equal(body.bindingToken, "fixture-binding-fixture-one");
        assert.equal(body.studentId, undefined); assert.equal(body.planId, undefined); assert.equal(body.studyDate, undefined);
        if (recordBindingFail) return reply({ code: "STUDENT_BINDING_INVALID", message: "검증용 기록 연결 만료" }, 401);
        if (rejectProgress) return reply({ code: "INVALID_PROGRESS", message: "검증용 입력 거절" }, 422);
        const old = recorded.get(body.idempotencyKey);
        if (old) { assert.deepEqual(old, body); return reply({ progress: { positionSeconds: actualPosition }, completion: null, replayed: true }); }
        recorded.set(body.idempotencyKey, body);
        actualPosition = body.positionSeconds; actualSpent += body.spentSeconds;
        if (failProgressResponse) { failProgressResponse = false; return reply({ code: "RESPONSE_UNAVAILABLE", message: "검증용 기록 응답 실패" }, 502); }
        return reply({ progress: { positionSeconds: actualPosition }, completion: actualPosition === 4200 ? { itemKey: body.itemKey } : null, replayed: false });
      }
      if (path === "/api/llm-chat/feedback") {
        feedbackRequests++; feedbackBodies.push(body);
        assert.equal(actualPosition, 4200);
        assert.equal(body.studentId, undefined); assert.equal(body.planId, undefined);
        const old = recorded.get(body.idempotencyKey);
        if (old) { assert.deepEqual(old, body); return reply({ completion: { payload: actualFeedback }, replayed: true }); }
        recorded.set(body.idempotencyKey, body); actualFeedback = body.feedback;
        if (failFeedbackResponse) { failFeedbackResponse = false; return reply({ code: "RESPONSE_UNAVAILABLE", message: "검증용 피드백 응답 실패" }, 502); }
        return reply({ completion: { payload: actualFeedback }, replayed: false });
      }
      throw new Error("예상하지 못한 API 호출: " + path);
    });
    await page.goto(process.env.R3_VERIFY_URL + "?view=llm");
    const send = page.getByRole("button", { name: "보내기", exact: true });
    const selector = page.getByLabel("학생 선택 (로컬 개발용)", { exact: true });
    const draft = page.getByLabel("메시지", { exact: true });
    await selector.locator("option[value='fixture-one']").waitFor({ state: "attached" });
    assert.equal(await send.isDisabled(), true);
    await selector.selectOption("fixture-one");
    await page.getByText("서버 계획 버전 1", { exact: false }).waitFor();
    async function submit(text) {
      await draft.fill(text);
      await page.locator(".llm-chat-composer button").click();
      await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    }
    await submit("설명만 해줘");
    assert.equal(confirms, 0);
    messageFail = true;
    await submit("실패해도 남길 입력");
    assert.equal(await draft.inputValue(), "실패해도 남길 입력");
    assert.equal(await page.locator(".llm-message.assistant").count(), 1);
    messageFail = false;
    await page.getByRole("button", { name: "다시 보내기", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    assert.equal(lastMessageBody.messages.length, 3);
    mode = "proposal";
    await submit("변경안 보여줘");
    const proposal = page.getByRole("region", { name: "학습 계획 변경안", exact: true }).first();
    await proposal.locator(".llm-comparison").getByText("100분", { exact: true }).waitFor();
    await proposal.locator(".llm-comparison").getByText("50분", { exact: true }).waitFor();
    if (process.env.R3_SCREENSHOT_PREFIX) await page.screenshot({ path: process.env.R3_SCREENSHOT_PREFIX + "-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.R3_SCREENSHOT_PREFIX) await page.screenshot({ path: process.env.R3_SCREENSHOT_PREFIX + "-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.equal(confirms, 0);
    await proposal.getByRole("button", { name: "지금은 보류" }).click();
    assert.equal(confirms, 0);
    await proposal.getByRole("button", { name: "변경안 다시 검토" }).click();
    await proposal.getByRole("button", { name: "변경안을 확인하고 적용" }).evaluate(button => { button.click(); button.click(); });
    await page.getByText("서버 계획 버전 2", { exact: false }).waitFor();
    assert.equal(confirms, 1);
    assert.deepEqual(lastConfirmBody, { bindingToken: "fixture-binding-fixture-one", proposalId: "proposal", expectedBasis: basis });
    // 추가 선택 집합의 해시가 현재 집합과 달라도 제안 확인·보류·재조회가 가능해야 한다.
    mode = "add-subject";
    await submit("영어 과목도 추가해줘");
    const addedProposal = page.getByRole("region", { name: "학습 계획 변경안", exact: true }).last();
    assert.equal(await addedProposal.getByRole("button", { name: "변경안을 확인하고 적용" }).isEnabled(), true);
    await addedProposal.getByRole("button", { name: "지금은 보류" }).click();
    await page.getByRole("button", { name: "계획 다시 조회", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    await addedProposal.getByRole("button", { name: "변경안 다시 검토" }).click();
    assert.equal(await addedProposal.getByRole("button", { name: "변경안을 확인하고 적용" }).isEnabled(), true);
    await addedProposal.getByRole("button", { name: "변경안을 확인하고 적용" }).click();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    assert.deepEqual(lastConfirmBody.expectedBasis, { ...basis, catalogHash: "b".repeat(64) });
    assert.equal(lastConfirmBody.proposalId, "add-subject");
    assert.equal(confirms, 2);
    // 카탈로그 실제 변경은 화면 추측이 아니라 서버 409 결과로 확정을 차단한다.
    mode = "add-subject-catalog-changed";
    await submit("추가 과목 제안의 서버 카탈로그 충돌 확인");
    const catalogConflict = page.getByRole("region", { name: "학습 계획 변경안", exact: true }).last();
    await catalogConflict.getByRole("button", { name: "변경안을 확인하고 적용" }).click();
    await page.getByText(/검증용 카탈로그 변경 충돌/).waitFor();
    assert.equal(await catalogConflict.getByRole("button", { name: "변경안을 확인하고 적용" }).count(), 0);
    assert.deepEqual(lastConfirmBody.expectedBasis, { ...basis, catalogHash: "b".repeat(64) });
    readsFail = true;
    await page.getByRole("button", { name: "계획 다시 조회", exact: true }).click();
    await page.getByText(/검증용 계획 조회 실패/).waitFor();
    assert.equal(await page.getByText("서버 계획 버전 2", { exact: false }).count(), 1);
    readsFail = false;
    await page.getByRole("button", { name: "계획 다시 조회", exact: true }).click();
    await page.getByText(/검증용 계획 조회 실패/).waitFor({ state: "hidden" });
    mode = "expired";
    await submit("만료안 검증");
    await page.getByRole("button", { name: "변경안을 확인하고 적용" }).click();
    await page.getByText(/오래되거나 만료된 변경안/).waitFor();
    assert.equal(await page.getByRole("button", { name: "변경안을 확인하고 적용" }).count(), 0);
    mode = "limit";
    await submit("계산 한계 검증");
    await page.getByRole("heading", { name: "계산 범위의 한계" }).waitFor();
    await page.getByText(/불가능하다는 확정 판정은 아닙니다/).waitFor();
    bindingFail = true;
    await submit("연결 만료에도 입력 보존");
    assert.equal(await draft.inputValue(), "연결 만료에도 입력 보존");
    assert.equal(await page.locator(".llm-chat-composer button").isDisabled(), true);
    bindingFail = false;
    await page.getByRole("button", { name: "같은 학생 다시 연결" }).click();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    assert.equal(await draft.inputValue(), "연결 만료에도 입력 보존");
    mode = "explanation-error";
    const previousMessages = await page.locator(".llm-message.assistant").count();
    await submit("설명 실패안 검증");
    await page.getByText(/AI 설명은 실패했지만 서버 변경안은 보존됐습니다/).waitFor();
    assert.equal(await page.locator(".llm-message.assistant").count(), previousMessages);
    assert.equal(await draft.inputValue(), "설명 실패안 검증");
    assert.equal(await page.getByRole("button", { name: "변경안을 확인하고 적용" }).count(), 1);
    assert.equal(confirms, 4);

    mode = "record";
    await submit("학습하기 전에 변경안도 보여줘");
    assert.equal(await page.getByRole("button", { name: "변경안을 확인하고 적용" }).count(), 2);
    const recordItem = page.getByLabel("기록할 강의", { exact: true });
    const position = page.getByLabel("영상 처음부터 실제 도달 위치 (초)", { exact: true });
    const spent = page.getByLabel("이번 기록의 실제 사용시간 (초)", { exact: true });
    const saveProgress = page.getByRole("button", { name: "진도·완료 기록 저장", exact: true });
    const feedbackItem = page.getByLabel("피드백할 완료 강의", { exact: true });
    assert.equal(await position.inputValue(), "");
    assert.equal(await spent.inputValue(), "");
    assert.equal(await feedbackItem.locator("option").count(), 1);
    assert.equal(progressRequests, 0);
    await recordItem.selectOption("fixture-item");
    await position.fill("2100"); await spent.fill("1200");
    failProgressResponse = true;
    await saveProgress.evaluate(button => { button.click(); button.click(); });
    await page.getByText(/검증용 기록 응답 실패/).waitFor();
    assert.equal(progressRequests, 1);
    assert.equal(await position.inputValue(), "2100"); assert.equal(await spent.inputValue(), "1200");
    assert.equal(await saveProgress.isDisabled(), true);
    for (const button of await page.getByRole("button", { name: "변경안을 확인하고 적용" }).all()) assert.equal(await button.isDisabled(), true);
    recordBindingFail = true;
    await page.getByRole("button", { name: "같은 기록 재시도", exact: true }).click();
    await page.getByText(/검증용 기록 연결 만료/).waitFor();
    assert.equal(await page.getByRole("button", { name: "같은 기록 재시도", exact: true }).isDisabled(), true);
    assert.equal(await position.inputValue(), "2100"); assert.equal(await spent.inputValue(), "1200");
    recordBindingFail = false;
    await page.getByRole("button", { name: "같은 학생 다시 연결", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    await page.getByRole("button", { name: "같은 기록 재시도", exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.getByRole("status").filter({ hasText: "학습 기록을 저장했습니다" }).waitFor();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    assert.equal(progressRequests, 3); assert.deepEqual(progressBodies[0], progressBodies[1]); assert.deepEqual(progressBodies[0], progressBodies[2]);
    assert.equal(actualSpent, 1200); assert.equal(await position.inputValue(), ""); assert.equal(await spent.inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "변경안을 확인하고 적용" }).count(), 0);
    const today = page.getByRole("region", { name: "오늘 학습 분량", exact: true });
    assert.match(await today.innerText(), /실제 사용 20분/);
    await page.locator(".llm-actual-items summary").click();
    assert.match(await page.locator(".llm-actual-items").innerText(), /실제 위치 35분.*실제 잔여 35분/);

    // 명시적인 입력 거절만 종료하고 수정 내용은 새 키의 별도 기록으로 전송한다.
    await position.fill("3000"); await spent.fill("600"); rejectProgress = true;
    await saveProgress.click();
    await page.getByText(/검증용 입력 거절/).waitFor();
    const rejectedKey = progressBodies.at(-1).idempotencyKey;
    await page.getByRole("button", { name: "거절된 기록을 종료하고 새 기록으로 수정", exact: true }).click();
    rejectProgress = false; await position.fill("3100"); await spent.fill("650");
    await saveProgress.click();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    assert.notEqual(progressBodies.at(-1).idempotencyKey, rejectedKey);
    assert.equal(actualPosition, 3100); assert.equal(actualSpent, 1850);

    // 기록 성공 후 조회 실패는 기록 재전송 없이 조회만 재시도한다.
    await page.getByLabel("강의 전체를 실제로 끝까지 수강했습니다", { exact: true }).check();
    await spent.fill("350"); readsFail = true;
    await saveProgress.click();
    await page.getByText(/검증용 계획 조회 실패/).waitFor();
    assert.equal(actualPosition, 4200); assert.equal(await page.getByRole("button", { name: "같은 기록 재시도", exact: true }).count(), 0);
    const completedRequestCount = progressRequests;
    readsFail = false;
    await page.getByRole("button", { name: "계획 다시 조회", exact: true }).click();
    await feedbackItem.locator("option[value='fixture-item']").waitFor({ state: "attached" });
    assert.equal(progressRequests, completedRequestCount);
    await feedbackItem.selectOption("fixture-item");
    await page.getByLabel("이해도 (1~5)", { exact: true }).selectOption("4");
    await page.getByLabel("집중도 (1~5)", { exact: true }).selectOption("3");
    await page.getByLabel("피드백 메모 (선택)", { exact: true }).fill("직접 입력한 첫 피드백");
    failFeedbackResponse = true;
    await page.getByRole("button", { name: "첫 피드백 저장", exact: true }).click();
    await page.getByText(/검증용 피드백 응답 실패/).waitFor();
    assert.equal(await page.getByLabel("피드백 메모 (선택)", { exact: true }).inputValue(), "직접 입력한 첫 피드백");
    await page.getByRole("button", { name: "같은 기록 재시도", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#llm-input").disabled);
    assert.deepEqual(feedbackBodies[0], feedbackBodies[1]);
    assert.equal(await page.getByRole("button", { name: "첫 피드백 저장", exact: true }).isDisabled(), true);
    assert.match(await page.locator(".llm-actual-items").innerText(), /첫 피드백 저장됨: 이해도 4 · 집중도 3/);
    assert.equal(actualSpent, 2200);
    await page.reload();
    await selector.locator("option[value='fixture-one']").waitFor({ state: "attached" });
    assert.equal(await page.locator(".llm-message").count(), 0);
    assert.equal(await selector.inputValue(), "");
    await selector.selectOption("fixture-one");
    await page.getByText("서버 계획 버전 2", { exact: false }).waitFor();
    assert.match(await page.getByRole("region", { name: "오늘 학습 분량", exact: true }).innerText(), /실제 사용 36\.67분/);
    await page.locator(".llm-actual-items summary").click();
    assert.match(await page.locator(".llm-actual-items").innerText(), /강의 전체 완료/);
    await page.getByLabel("피드백 메모 (선택)", { exact: true }).fill("다른 학생에게 넘어가면 안 되는 기록 초안");
    mode = "slow";
    await draft.fill("학생 변경 중 늦은 요청");
    await page.locator(".llm-chat-composer button").click();
    await page.waitForFunction(() => document.querySelector("#llm-input").disabled);
    await selector.selectOption("fixture-two");
    await page.getByText(/등록된 전체 계획이 없습니다/).waitFor();
    await page.waitForTimeout(900);
    assert.equal(await page.locator(".llm-message").count(), 0);
    assert.equal(await page.locator(".llm-proposal-card").count(), 0);
    assert.equal(await draft.inputValue(), "");
    assert.equal(await page.getByRole("region", { name: "수동 학습 기록", exact: true }).count(), 0);
    await selector.selectOption("fixture-one");
    await page.getByText("서버 계획 버전 2", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("피드백 메모 (선택)", { exact: true }).inputValue(), "");
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: "통과", scenarios: ["학생 선택", "텍스트 자동확정 차단", "전송 실패·초안 보존·재시도",
      "서버 카드·보류", "중복 확정 클릭 방지·정확한 기준 전달", "확정 후 재조회", "조회 실패·마지막 계획 보존",
      "409 만료 안내", "탐색 한계", "학생 연결 만료·재연결·초안 보존", "설명 실패 시 서버 제안 보존",
      "학생 변경·늦은 응답 격리", "브라우저 저장 없음", "모바일 가로 넘침 없음", "예정·실제 위치·사용시간 구분",
      "부분 수강 응답 실패 후 동일 키·내용 재시도", "진도 기록 후 제안 stale", "명시 거절 후 새 키의 별도 수정 기록",
      "기록 성공·조회 실패 분리", "수동 전체 완료", "첫 피드백 재시도·중복 방지", "새로고침 후 서버 기록 복구",
      "기록 연결 만료·재결속 후 동일 요청 보존", "학생별 기록 초안 격리", "과목 추가 해시 차이 허용·보류 후 재조회",
      "추가 선택 basis 원문 확정 전달", "서버 카탈로그 변경 409 차단"],
      messageRequests: messageCount, confirmRequests: confirms, progressRequests, feedbackRequests, providerRequests: 0 }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
