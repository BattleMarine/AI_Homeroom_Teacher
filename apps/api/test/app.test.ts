import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("강의별 체크 API가 유효한 기록과 AI 담임 안내를 반환한다", async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/lesson-feedback",
    payload: {
      lessonId: "stable-log-graph-asymptote-lecture",
      understandingLevel: 3,
      focusLevel: 3,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    dataSource: "mock",
    responseType: "mock",
    lessonId: "stable-log-graph-asymptote-lecture",
    recorded: true,
    teacherNote: "강의별 응답을 기록했고, 다음 수업 조율에 반영하겠습니다.",
  });
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
