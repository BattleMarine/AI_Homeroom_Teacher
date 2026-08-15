import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { createDatabaseClient } from "../src/db/client.js";
import { createPostgresCourseCatalogRepository } from "../src/course-catalog/course-catalog.postgres-repository.js";
import { createPostgresProgressStateRepository } from "../src/progress/progress.postgres-repository.js";
import { createPostgresProgressService } from "../src/progress/progress.postgres-service.js";
import { createMockProgressService } from "../src/progress/progress.mock-service.js";
import { createPostgresStudentCurriculumRepository } from "../src/student-curriculum/student-curriculum.postgres-repository.js";

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

databaseTest("학생별 커리큘럼은 후보 선택, 버전 보존, 잘못된 강의 연결 롤백을 처리한다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const repository = createPostgresStudentCurriculumRepository(database.pool);
  const studentId = "db-curriculum-student";
  const otherStudentId = "db-curriculum-other-student";
  const curriculumId = "db-curriculum-a";
  const otherCurriculumId = "db-curriculum-b";
  const isolatedCurriculumId = "db-curriculum-isolated";
  const lesson = await database.pool.query<{ id: string }>(
    "SELECT id FROM lessons WHERE playback_target_id IS NOT NULL ORDER BY sequence ASC LIMIT 1",
  );
  assert.ok(lesson.rows[0]);

  const cleanupCurriculum = async (id: string) => {
    await database.pool.query(
      "DELETE FROM curriculum_items WHERE curriculum_step_id IN (SELECT id FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = $1))",
      [id],
    );
    await database.pool.query(
      "DELETE FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = $1)",
      [id],
    );
    await database.pool.query("UPDATE student_curricula SET current_version_id = NULL WHERE id = $1", [id]);
    await database.pool.query("DELETE FROM curriculum_versions WHERE student_curriculum_id = $1", [id]);
    await database.pool.query("DELETE FROM student_curricula WHERE id = $1", [id]);
  };

  await database.pool.query("DELETE FROM student_learning_states WHERE student_id IN ($1, $2)", [studentId, otherStudentId]);
  for (const id of [curriculumId, otherCurriculumId, isolatedCurriculumId]) {
    await cleanupCurriculum(id);
  }
  await database.pool.query("DELETE FROM students WHERE id IN ($1, $2)", [studentId, otherStudentId]);

  context.after(async () => {
    await database.pool.query("DELETE FROM student_learning_states WHERE student_id IN ($1, $2)", [studentId, otherStudentId]);
    for (const id of [curriculumId, otherCurriculumId, isolatedCurriculumId]) {
      await cleanupCurriculum(id);
    }
    await database.pool.query("DELETE FROM students WHERE id IN ($1, $2)", [studentId, otherStudentId]);
    await database.close();
  });

  const initialVersion = {
    changeReason: "initial" as const,
    steps: [{
      sourceId: "step-1",
      title: "로그의 뜻",
      goal: "로그의 뜻을 정리합니다.",
      conceptTags: ["로그"],
      estimatedMinutes: 20,
      items: [{
        sourceId: "item-1",
        kind: "lecture" as const,
        lessonId: lesson.rows[0].id,
        title: "로그의 뜻 강의",
        description: null,
        conceptTags: ["로그"],
        estimatedMinutes: 20,
        required: true,
        reason: "초기 학습",
      }],
    }],
  };
  const initialState = { currentStepId: "step-1", completedStepIds: [], weakConcepts: [] };
  const presentation = { paceLabel: "검증형", description: "저장소 검증용 후보입니다.", recommendedFor: ["테스트"], teacherComment: "저장소 동작을 확인합니다." };
  await repository.seedCandidate({ id: curriculumId, studentId, subjectCode: "math-logarithm", title: "후보 A", presentation, state: initialState, version: initialVersion });
  await repository.seedCandidate({ id: otherCurriculumId, studentId, subjectCode: "math-logarithm", title: "후보 B", presentation, state: initialState, version: initialVersion });

  const selected = await repository.selectCandidate(studentId, curriculumId);
  assert.equal(selected?.status, "active");
  const selectedOther = await repository.selectCandidate(studentId, otherCurriculumId);
  assert.equal(selectedOther?.status, "active");
  const selectedCount = await database.pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM student_curricula WHERE student_id = $1 AND subject_code = 'math-logarithm' AND status = 'active'",
    [studentId],
  );
  assert.equal(selectedCount.rows[0].count, "1");

  const invalidSave = repository.saveNewVersion({
    studentId,
    curriculumId: otherCurriculumId,
    expectedRevision: selectedOther!.revision,
    state: initialState,
    version: { ...initialVersion, changeReason: "remediation", steps: [{ ...initialVersion.steps[0], items: [{ ...initialVersion.steps[0].items[0], lessonId: "missing-lesson" }] }] },
  });
  await assert.rejects(invalidSave);
  const afterRollback = await repository.getById(studentId, otherCurriculumId);
  assert.equal(afterRollback?.currentVersion?.versionNumber, 1);
  assert.equal(afterRollback?.revision, selectedOther!.revision);

  const saved = await repository.saveNewVersion({
    studentId,
    curriculumId: otherCurriculumId,
    expectedRevision: afterRollback!.revision,
    state: { ...initialState, currentStepId: "step-2" },
    version: {
      ...initialVersion,
      changeReason: "remediation",
      changeSummary: "그래프 보강 단계 추가",
      steps: [{
        ...initialVersion.steps[0],
        sourceId: "step:2",
        items: [{ ...initialVersion.steps[0].items[0], sourceId: "item:2" }],
      }],
    },
  });
  assert.equal(saved?.kind, "saved");
  if (saved?.kind !== "saved") throw new Error("새 커리큘럼 버전을 저장하지 못했습니다.");
  assert.equal(saved.curriculum.currentVersion?.versionNumber, 2);
  assert.equal(saved.curriculum.revision, afterRollback!.revision + 1);
  assert.equal(saved.curriculum.currentVersion?.steps[0].sourceId, "step:2");
  assert.equal(saved.curriculum.currentVersion?.steps[0].items[0].sourceId, "item:2");
  const versions = await database.pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM curriculum_versions WHERE student_curriculum_id = $1",
    [otherCurriculumId],
  );
  assert.equal(versions.rows[0].count, "2");

  await repository.seedCandidate({ id: isolatedCurriculumId, studentId: otherStudentId, subjectCode: "math-logarithm", title: "다른 학생 후보", presentation, state: initialState, version: initialVersion });
  const isolated = await repository.getById(otherStudentId, isolatedCurriculumId);
  assert.equal(isolated?.studentId, otherStudentId);
  await cleanupCurriculum(isolatedCurriculumId);
});

databaseTest("커리큘럼 읽기 모델은 선택 전 안내하고 선택·실행 상태를 원자적으로 저장한다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const repository = createPostgresStudentCurriculumRepository(database.pool);
  const studentId = "db-read-model-student";
  const curriculumA = "db-read-model-a";
  const curriculumB = "db-read-model-b";
  const lesson = await database.pool.query<{ id: string }>("SELECT id FROM lessons ORDER BY sequence ASC LIMIT 1");
  assert.ok(lesson.rows[0]);
  const initialState = { currentStepId: "step-1", completedStepIds: [], weakConcepts: [] };
  const presentation = { paceLabel: "읽기 모델", description: "DB 원본 표시 정보", recommendedFor: ["검증"], teacherComment: "선택을 기다립니다." };
  const version = {
    changeReason: "initial" as const,
    steps: [{
      sourceId: "step-1", title: "로그의 뜻", goal: "로그의 뜻을 정리합니다.", conceptTags: ["로그"], estimatedMinutes: 20,
      items: [{
        sourceId: "item-1", kind: "lecture" as const, lessonId: lesson.rows[0].id, title: "로그의 뜻 강의",
        description: null, conceptTags: ["로그"], estimatedMinutes: 20, required: true, reason: "초기 학습",
      }],
    }],
  };
  const cleanupCurriculum = async (curriculumId: string) => {
    await database.pool.query("DELETE FROM curriculum_items WHERE curriculum_step_id IN (SELECT id FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = $1))", [curriculumId]);
    await database.pool.query("DELETE FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = $1)", [curriculumId]);
    await database.pool.query("UPDATE student_curricula SET current_version_id = NULL WHERE id = $1", [curriculumId]);
    await database.pool.query("DELETE FROM curriculum_versions WHERE student_curriculum_id = $1", [curriculumId]);
    await database.pool.query("DELETE FROM student_curricula WHERE id = $1", [curriculumId]);
  };
  context.after(async () => {
    await cleanupCurriculum(curriculumA);
    await cleanupCurriculum(curriculumB);
    await database.pool.query("DELETE FROM student_learning_states WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
    await database.close();
  });

  await repository.seedCandidate({ id: curriculumA, studentId, subjectCode: "math-logarithm", title: "읽기 모델 A", presentation, state: initialState, version });
  await repository.seedCandidate({ id: curriculumB, studentId, subjectCode: "math-logarithm", title: "읽기 모델 B", presentation, state: initialState, version });
  const app = buildApp({
    courseCatalogRepository: createPostgresCourseCatalogRepository(database.pool),
    progressService: createPostgresProgressService(createPostgresProgressStateRepository(database.pool)),
    studentCurriculumRepository: repository,
  });
  context.after(() => app.close());

  const beforeSelection = await app.inject({ method: "GET", url: `/api/learning-snapshot?studentId=${studentId}` });
  assert.equal(beforeSelection.statusCode, 409);
  assert.equal(beforeSelection.json().code, "CURRICULUM_SELECTION_REQUIRED");
  const list = await app.inject({ method: "GET", url: `/api/curriculums?studentId=${studentId}` });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().curriculums[0].description, presentation.description);

  const progressRepository = createPostgresProgressStateRepository(database.pool);
  const initialProgress = createMockProgressService().exportState(studentId);
  if (!progressRepository.selectCurriculum) throw new Error("원자적 커리큘럼 선택 저장소가 필요합니다.");
  const selected = await progressRepository.selectCurriculum(studentId, curriculumB, initialProgress, (state) => ({
    state: {
      ...state,
      revision: state.revision + 1,
      context: { ...state.context, selectedCurriculumId: curriculumB as never },
    },
    result: true,
  }));
  assert.equal(selected, true);
  const readModelResponse = await app.inject({ method: "GET", url: `/api/curriculum-read-model?studentId=${studentId}` });
  assert.equal(readModelResponse.statusCode, 200);
  assert.equal(readModelResponse.json().readModel.curriculum.id, curriculumB);
  assert.equal(readModelResponse.json().readModel.executionState.state.context.selectedCurriculumId, curriculumB);
  assert.equal(
    readModelResponse.json().readModel.curriculum.revision,
    readModelResponse.json().readModel.executionState.revision,
  );
});
