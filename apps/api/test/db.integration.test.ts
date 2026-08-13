import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { createDatabaseClient } from "../src/db/client.js";
import { createPostgresCourseCatalogRepository } from "../src/course-catalog/course-catalog.postgres-repository.js";
import { createPostgresProgressStateRepository } from "../src/progress/progress.postgres-repository.js";
import { createPostgresProgressService } from "../src/progress/progress.postgres-service.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseTest = databaseUrl ? test : test.skip;

databaseTest("PostgreSQL 저장소는 카탈로그와 학생 학습 상태를 서버 재시작 뒤에도 복구한다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const studentId = "db-integration-restart";
  const createApp = () => buildApp({
    courseCatalogRepository: createPostgresCourseCatalogRepository(database.pool),
    progressService: createPostgresProgressService(createPostgresProgressStateRepository(database.pool)),
  });

  await database.pool.query("DELETE FROM session_adjustment_proposals WHERE student_id = $1", [studentId]);
  await database.pool.query("DELETE FROM lesson_feedback_events WHERE student_id = $1", [studentId]);
  await database.pool.query("DELETE FROM student_learning_states WHERE student_id = $1", [studentId]);
  await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
  context.after(async () => {
    await database.pool.query("DELETE FROM session_adjustment_proposals WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM lesson_feedback_events WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM student_learning_states WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
    await database.close();
  });

  const firstApp = createApp();
  context.after(() => firstApp.close());
  const catalogResponse = await firstApp.inject({ method: "GET", url: "/api/course-catalogs" });
  assert.equal(catalogResponse.statusCode, 200);
  assert.equal(catalogResponse.json().courses[0].lessonCount, 52);

  const selectionResponse = await firstApp.inject({
    method: "POST",
    url: "/api/student-context/curriculum",
    payload: { studentId, curriculumId: "compressed-log" },
  });
  assert.equal(selectionResponse.statusCode, 200);
  assert.equal(selectionResponse.json().snapshot.revision, 1);

  const feedbackResponse = await firstApp.inject({
    method: "POST",
    url: "/api/lesson-feedback",
    payload: { studentId, lessonId: "stable-log-graph-asymptote-lecture", understandingLevel: 2, focusLevel: 3 },
  });
  assert.equal(feedbackResponse.statusCode, 200);
  assert.equal(feedbackResponse.json().snapshot.revision, 2);
  await firstApp.close();

  const restartedApp = createApp();
  context.after(() => restartedApp.close());
  const restoredResponse = await restartedApp.inject({ method: "GET", url: `/api/learning-snapshot?studentId=${studentId}` });
  assert.equal(restoredResponse.statusCode, 200);
  assert.equal(restoredResponse.json().snapshot.revision, 2);
  assert.equal(restoredResponse.json().snapshot.studentContext.selectedCurriculumId, "compressed-log");
  assert.equal(restoredResponse.json().snapshot.studentContext.completedLessonItemIds.includes("stable-log-graph-asymptote-lecture"), true);
});

databaseTest("PostgreSQL 조율안 확정은 revision 충돌과 중복 확정을 트랜잭션으로 막는다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const studentId = "db-integration-adjustment";
  const app = buildApp({
    courseCatalogRepository: createPostgresCourseCatalogRepository(database.pool),
    progressService: createPostgresProgressService(createPostgresProgressStateRepository(database.pool)),
  });
  context.after(async () => {
    await app.close();
    await database.pool.query("DELETE FROM session_adjustment_proposals WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM lesson_feedback_events WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM student_learning_states WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
    await database.close();
  });

  const proposalResponse = await app.inject({
    method: "POST",
    url: "/api/conversations/db-adjustment/messages",
    payload: { studentId, message: "오늘 시간이 부족해요." },
  });
  const proposal = proposalResponse.json().attachment.data;
  assert.equal(proposal.baseRevision, 0);

  const firstConfirmation = await app.inject({
    method: "POST",
    url: `/api/session-adjustments/${proposal.adjustmentId}/confirm`,
    payload: { studentId, expectedRevision: 0 },
  });
  assert.equal(firstConfirmation.statusCode, 200);
  assert.equal(firstConfirmation.json().snapshot.revision, 1);

  const repeatedConfirmation = await app.inject({
    method: "POST",
    url: `/api/session-adjustments/${proposal.adjustmentId}/confirm`,
    payload: { studentId, expectedRevision: 1 },
  });
  assert.equal(repeatedConfirmation.statusCode, 404);

  const staleProposalResponse = await app.inject({
    method: "POST",
    url: "/api/conversations/db-adjustment-stale/messages",
    payload: { studentId, message: "오늘 시간이 부족해요." },
  });
  const staleProposal = staleProposalResponse.json().attachment.data;
  await app.inject({
    method: "POST",
    url: "/api/lesson-feedback",
    payload: { studentId, lessonId: "stable-log-graph-asymptote-lecture", understandingLevel: 3, focusLevel: 3 },
  });
  const staleConfirmation = await app.inject({
    method: "POST",
    url: `/api/session-adjustments/${staleProposal.adjustmentId}/confirm`,
    payload: { studentId, expectedRevision: staleProposal.baseRevision },
  });
  assert.equal(staleConfirmation.statusCode, 409);
  assert.equal(staleConfirmation.json().snapshot.revision, 2);
});
