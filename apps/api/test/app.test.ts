import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

const calculusCourseId = "ebsi-2026-suneungwanseong-namchiyeol-math-calculus-all";

test("파일 강좌 카탈로그 API가 미적분 강좌와 강의 목록을 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const listResponse = await app.inject({ method: "GET", url: "/api/course-catalogs" });

  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().catalogDataSource, "file");
  assert.equal(listResponse.json().courses[0].id, calculusCourseId);

  const detailResponse = await app.inject({
    method: "GET",
    url: `/api/course-catalogs/${calculusCourseId}`,
  });

  assert.equal(detailResponse.statusCode, 200);
  assert.equal(detailResponse.json().courseCatalog.course.lessonCount, 52);
  assert.equal(detailResponse.json().courseCatalog.lessons[0].lessonType, "orientation");
});

test("규칙 기반 추천 API가 순서를 보존하고 목표 일수 위험을 계산한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/curriculum-recommendations",
    payload: {
      courseId: calculusCourseId,
      subjectArea: "미적분",
      unitNames: ["수열의 극한"],
      completedLessonIds: ["ebsi-namchiyeol-2026-math-calculus-028"],
      weakUnitNames: ["수열의 극한"],
      availableMinutesPerDay: 60,
      targetDays: 2,
    },
  });

  assert.equal(response.statusCode, 200);
  const recommendation = response.json().recommendation;
  assert.equal(recommendation.algorithm, "rule-based-v1");
  assert.equal(recommendation.scope.subjectArea, "미적분");
  assert.equal(recommendation.feasibility.targetAchievable, false);
  assert.equal(recommendation.sessions[0].lessonIds.includes("ebsi-namchiyeol-2026-math-calculus-028"), false);
  assert.equal(recommendation.steps.some((step: { weakUnit: boolean }) => step.weakUnit), true);
  assert.equal(recommendation.reasonCodes.includes("catalog_sequence_preserved"), true);
  assert.equal(recommendation.reasonCodes.includes("target_days_at_risk"), true);
});

test("커리큘럼 도구는 추천 유형과 무관하게 같은 기준 계획을 반환하고 적용 상태를 보관한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const sharedInput = {
    studentId: "tool-test",
    courseId: calculusCourseId,
    subjectArea: "미적분",
    unitNames: ["수열의 극한"],
    availableMinutesPerDay: 60,
    targetDays: 3,
  };
  const stableResponse = await app.inject({
    method: "POST",
    url: "/api/curriculum-tools/execute",
    payload: { tool: "create_curriculum_plan", input: { ...sharedInput, planProfile: "stable" } },
  });
  const compressedResponse = await app.inject({
    method: "POST",
    url: "/api/curriculum-tools/execute",
    payload: { tool: "compress_curriculum_plan", input: { ...sharedInput, planProfile: "compressed" } },
  });

  assert.equal(stableResponse.statusCode, 200);
  assert.equal(compressedResponse.statusCode, 200);
  assert.equal(stableResponse.json().result.appliedPlanProfile, "baseline");
  assert.equal(compressedResponse.json().result.appliedPlanProfile, "baseline");
  assert.deepEqual(
    stableResponse.json().result.recommendation.sessions,
    compressedResponse.json().result.recommendation.sessions,
  );

  const applyResponse = await app.inject({
    method: "POST",
    url: "/api/curriculum-tools/execute",
    payload: { tool: "apply_curriculum_plan", input: sharedInput },
  });
  assert.equal(applyResponse.statusCode, 200);
  assert.equal(applyResponse.json().result.applied, true);

  const currentPlanResponse = await app.inject({
    method: "GET",
    url: "/api/curriculum-plans/current?studentId=tool-test",
  });
  assert.equal(currentPlanResponse.statusCode, 200);
  assert.equal(currentPlanResponse.json().plan.planId, "curriculum-plan:tool-test");
});

test("mock LLM은 커리큘럼 요청에 맞는 도구를 요청하고 실행 결과를 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/conversations/tool-conversation/messages",
    payload: { studentId: "tool-chat", message: "커리큘럼을 압축해 주세요." },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().requestedTools[0], "compress_curriculum_plan");
  assert.equal(response.json().toolCalls[0].name, "compress_curriculum_plan");
  assert.equal(response.json().toolCalls[0].result.appliedPlanProfile, "baseline");
});
test("추천 API가 조건에 맞는 강의가 없으면 422를 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/curriculum-recommendations",
    payload: {
      courseId: calculusCourseId,
      subjectArea: "없는 과목",
    },
  });

  assert.equal(response.statusCode, 422);
});

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
  assert.equal(selectionResponse.json().session.id, "curriculum-test:log-graph");

  const stableSelectionResponse = await app.inject({
    method: "POST",
    url: "/api/student-context/curriculum",
    payload: { studentId: "stable-curriculum-test", curriculumId: "stable-log" },
  });
  assert.deepEqual(
    selectionResponse.json().session.items.map((item: { id: string }) => item.id),
    stableSelectionResponse.json().session.items.map((item: { id: string }) => item.id),
  );

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
  assert.equal(responseBody.progress.nextRecommendedItem.id, "stable-log-graph-review-asymptote");
  assert.equal(responseBody.progress.progressPercent, 17);

  const progressResponse = await app.inject({
    method: "GET",
    url: "/api/today-session/progress?studentId=feedback-test",
  });

  assert.equal(progressResponse.statusCode, 200);
  assert.equal(progressResponse.json().progress.completedItemCount, 1);
  assert.equal(progressResponse.json().progress.nextRecommendedItem.id, "stable-log-graph-review-asymptote");
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
test("강의 상세와 mock 재생 API가 메타데이터와 PNG 바이너리를 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const detailResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/stable-log-graph-asymptote-lecture?studentId=playback-test",
  });

  assert.equal(detailResponse.statusCode, 200);
  const playback = detailResponse.json().lessonItem.playback;
  assert.deepEqual(playback, {
    kind: "mock-video",
    targetId: "mock-video:stable-log-graph-asymptote-lecture",
    mediaType: "image",
    contentType: "image/png",
    mediaUrl: "/api/lesson-items/stable-log-graph-asymptote-lecture/playback?studentId=playback-test",
    durationSeconds: 540,
  });
  assert.equal(playback.assetKey, undefined);

  const playbackResponse = await app.inject({
    method: "GET",
    url: playback.mediaUrl,
  });

  assert.equal(playbackResponse.statusCode, 200);
  assert.equal(playbackResponse.headers["content-type"], "image/png");
  assert.ok(playbackResponse.rawPayload.length > 0);
});

test("재생 불가·다른 학생 상태·경로 조작 요청은 mock 미디어를 반환하지 않는다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const reviewDetailResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/stable-log-graph-review-asymptote?studentId=playback-errors",
  });
  assert.equal(reviewDetailResponse.statusCode, 200);
  assert.equal(reviewDetailResponse.json().lessonItem.playback, null);

  const reviewPlaybackResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/stable-log-graph-review-asymptote/playback?studentId=playback-errors",
  });
  assert.equal(reviewPlaybackResponse.statusCode, 404);

  const selectionResponse = await app.inject({
    method: "POST",
    url: "/api/student-context/curriculum",
    payload: { studentId: "compressed-playback", curriculumId: "compressed-log" },
  });
  assert.equal(selectionResponse.statusCode, 200);

  const baselinePlaybackResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/stable-log-graph-asymptote-lecture/playback?studentId=compressed-playback",
  });
  assert.equal(baselinePlaybackResponse.statusCode, 200);

  const traversalResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/%2e%2e/playback?studentId=playback-errors",
  });
  assert.equal(traversalResponse.statusCode, 404);

  const malformedLessonIdResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/stable_log_graph/playback?studentId=playback-errors",
  });
  assert.equal(malformedLessonIdResponse.statusCode, 400);

  const invalidStudentResponse = await app.inject({
    method: "GET",
    url: "/api/lesson-items/stable-log-graph-asymptote-lecture/playback?studentId=",
  });
  assert.equal(invalidStudentResponse.statusCode, 400);
});

test("추천 학습 항목은 실행 방식과 재생 가능 여부를 함께 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());
  const studentId = "recommended-item-action-test";

  const getProgress = async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/today-session/progress?studentId=${studentId}`,
    });
    assert.equal(response.statusCode, 200);
    return response.json().progress;
  };

  const recordFeedback = async (lessonId: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/lesson-feedback",
      payload: { studentId, lessonId, understandingLevel: 3, focusLevel: 3 },
    });
    assert.equal(response.statusCode, 200);
  };

  assert.deepEqual((await getProgress()).nextRecommendedItem, {
    id: "stable-log-graph-review-asymptote",
    kind: "review",
    title: "점근선 보강 카드",
    action: "open-review",
    playbackAvailable: false,
  });

  await recordFeedback("stable-log-graph-review-asymptote");
  assert.equal((await getProgress()).nextRecommendedItem.action, "start-practice");

  await recordFeedback("stable-log-graph-practice-shift");
  assert.equal((await getProgress()).nextRecommendedItem.action, "start-check");

  await recordFeedback("stable-log-graph-check");
  const lectureRecommendation = (await getProgress()).nextRecommendedItem;
  assert.equal(lectureRecommendation.action, "play-lesson");
  assert.equal(lectureRecommendation.playbackAvailable, true);

  const lessonResponse = await app.inject({
    method: "GET",
    url: `/api/lesson-items/${lectureRecommendation.id}?studentId=${studentId}`,
  });
  assert.equal(lessonResponse.statusCode, 200);
  assert.notEqual(lessonResponse.json().lessonItem.playback, null);
});