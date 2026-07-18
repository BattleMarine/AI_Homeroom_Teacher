import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("AI 담임 LLM API가 mock 응답과 내부 도구 요청을 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/conversations/demo-conversation/messages",
    payload: { message: "오늘 시간이 부족해요." },
  });

  assert.equal(response.statusCode, 200);
  const responseBody = response.json();
  assert.equal(responseBody.dataSource, "mock");
  assert.equal(responseBody.conversationId, "demo-conversation");
  assert.equal(responseBody.responseType, "mock");
  assert.equal(responseBody.requestedTools[0], "adjust_curriculum");
  assert.equal(responseBody.attachment.type, "session-adjustment");
  assert.equal(responseBody.attachment.data.interpretedRequest.maxSessionMinutes, 25);
  assert.equal(responseBody.attachment.data.requiresConfirmation, true);
});

test("복합 학생 요구사항은 제안으로 반환되고 확인 뒤에만 수업에 반영된다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const proposalResponse = await app.inject({
    method: "POST",
    url: "/api/conversations/adjustment-test/messages",
    payload: { studentId: "adjustment-test", message: "오늘 시간이 부족하고 복습 위주로 하고 싶어요." },
  });

  assert.equal(proposalResponse.statusCode, 200);
  const proposal = proposalResponse.json().attachment.data;
  assert.deepEqual(proposal.interpretedRequest.conditionKinds, ["short_time", "review_first"]);
  assert.equal(proposal.before.estimatedMinutes, 44);
  assert.equal(proposal.proposedSession.estimatedMinutes, 20);

  const beforeConfirmationResponse = await app.inject({
    method: "GET",
    url: "/api/today-session?studentId=adjustment-test",
  });
  assert.equal(beforeConfirmationResponse.json().session.estimatedMinutes, 44);

  const confirmationResponse = await app.inject({
    method: "POST",
    url: `/api/session-adjustments/${proposal.adjustmentId}/confirm`,
    payload: { studentId: "adjustment-test" },
  });
  assert.equal(confirmationResponse.statusCode, 200);
  assert.equal(confirmationResponse.json().confirmed, true);
  assert.equal(confirmationResponse.json().session.estimatedMinutes, 20);
});

test("커리큘럼 선택 API가 학생별 mock 상태와 오늘 수업을 갱신한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const listResponse = await app.inject({
    method: "GET",
    url: "/api/curriculums?studentId=curriculum-test",
  });

  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().curriculums.length, 3);

  const selectionResponse = await app.inject({
    method: "POST",
    url: "/api/student-context/curriculum",
    payload: { studentId: "curriculum-test", curriculumId: "compressed-log" },
  });

  assert.equal(selectionResponse.statusCode, 200);
  assert.equal(selectionResponse.json().studentContext.selectedCurriculumId, "compressed-log");
  assert.equal(selectionResponse.json().session.goal, "그래프의 점근선과 이동 압축 정리");

  const mapResponse = await app.inject({
    method: "GET",
    url: "/api/curriculum-map?studentId=curriculum-test",
  });

  assert.equal(mapResponse.statusCode, 200);
  assert.equal(mapResponse.json().curriculumMap.curriculumId, "compressed-log");
});

test("강의 상세와 체크 API가 서버 상태 기반 진행 보고를 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const lessonResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/stable-log-graph-asymptote-lecture?studentId=feedback-test",
  });

  assert.equal(lessonResponse.statusCode, 200);
  assert.equal(lessonResponse.json().lessonItem.playback.kind, "mock-video");

  const response = await app.inject({
    method: "POST",
    url: "/api/lesson-feedback",
    payload: {
      studentId: "feedback-test",
      lessonId: "stable-log-graph-asymptote-lecture",
      understandingLevel: 2,
      focusLevel: 2,
    },
  });

  assert.equal(response.statusCode, 200);
  const responseBody = response.json();
  assert.equal(responseBody.recorded, true);
  assert.equal(responseBody.completedLesson.id, "stable-log-graph-asymptote-lecture");
  assert.equal(responseBody.completedLesson.completed, true);
  assert.deepEqual(responseBody.reasonCodes, ["low_understanding", "weak_concept_review", "low_focus", "reduce_next_session_load"]);
  assert.equal(responseBody.progress.nextRecommendedLesson.id, "stable-log-graph-review-asymptote");
  assert.equal(responseBody.progress.progressPercent, 17);

  const progressResponse = await app.inject({
    method: "GET",
    url: "/api/today-session/progress?studentId=feedback-test",
  });

  assert.equal(progressResponse.statusCode, 200);
  assert.equal(progressResponse.json().progress.completedItemCount, 1);
  assert.equal(progressResponse.json().progress.nextRecommendedLesson.id, "stable-log-graph-review-asymptote");
});

test("강의별 체크 API가 잘못된 요청을 검증 오류로 처리한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/lesson-feedback",
    payload: {
      lessonId: "stable-log-graph-asymptote-lecture",
      understandingLevel: 3,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "FST_ERR_VALIDATION");
});
