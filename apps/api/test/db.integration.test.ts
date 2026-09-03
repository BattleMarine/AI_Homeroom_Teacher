import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { createDatabaseClient } from "../src/db/client.js";
import { createPostgresCourseCatalogRepository } from "../src/course-catalog/course-catalog.postgres-repository.js";
import { createPostgresProgressStateRepository } from "../src/progress/progress.postgres-repository.js";
import { createPostgresProgressService } from "../src/progress/progress.postgres-service.js";
import { createMockProgressService } from "../src/progress/progress.mock-service.js";
import { createPostgresStudentCurriculumRepository } from "../src/student-curriculum/student-curriculum.postgres-repository.js";
import { createPostgresSubjectEnrollmentProposalRepository } from "../src/subject-enrollment/subject-enrollment.postgres-repository.js";
import type { Pool } from "pg";

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
  assert.equal(catalogResponse.json().courses.some((course: { id: string; lessonCount: number; totalDurationSeconds: number }) =>
    course.id === "ebsi-2027-suneungwanseong-choeseohee-korean-language-media-all" &&
    course.lessonCount === 36 &&
    course.totalDurationSeconds === 154921), true);
  assert.equal(catalogResponse.json().courses.some((course: { id: string; lessonCount: number; totalDurationSeconds: number }) =>
    course.id === "ebsi-2027-suneungwanseong-kimjehee-english-all" &&
    course.lessonCount === 41 &&
    course.totalDurationSeconds === 119217), true);

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

databaseTest("PostgreSQL API 핵심 학습 흐름은 학생별로 격리되고 재시작 뒤에도 복구된다", async () => {
  const runId = randomUUID().slice(0, 12);
  const testPrefix = `e2e-${runId}`;
  const studentA = `${testPrefix}-a`;
  const studentB = `${testPrefix}-b`;
  const curriculumA = `${testPrefix}-curriculum-a`;
  const curriculumB = `${testPrefix}-curriculum-b`;
  const stepId = `${testPrefix}:step:1`;
  const lectureItemId = `${testPrefix}:lecture:1`;
  const reviewItemId = `${testPrefix}:review:1`;
  const database = createDatabaseClient(databaseUrl!);
  let activeDatabase = database;
  let firstApp: ReturnType<typeof buildApp> | undefined;
  let restartedApp: ReturnType<typeof buildApp> | undefined;
  let cleaned = false;

  const cleanup = async (pool: Pool) => {
    await pool.query("DELETE FROM session_adjustment_proposals WHERE student_id = ANY($1::text[])", [[studentA, studentB]]);
    await pool.query("DELETE FROM lesson_feedback_events WHERE student_id = ANY($1::text[])", [[studentA, studentB]]);
    await pool.query("DELETE FROM student_learning_states WHERE student_id = ANY($1::text[])", [[studentA, studentB]]);
    await pool.query(
      "DELETE FROM curriculum_items WHERE curriculum_step_id IN (SELECT id FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = ANY($1::text[])))",
      [[curriculumA, curriculumB]],
    );
    await pool.query(
      "DELETE FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = ANY($1::text[]))",
      [[curriculumA, curriculumB]],
    );
    await pool.query("UPDATE student_curricula SET current_version_id = NULL WHERE id = ANY($1::text[])", [[curriculumA, curriculumB]]);
    await pool.query("DELETE FROM curriculum_versions WHERE student_curriculum_id = ANY($1::text[])", [[curriculumA, curriculumB]]);
    await pool.query("DELETE FROM student_curricula WHERE id = ANY($1::text[])", [[curriculumA, curriculumB]]);
    await pool.query("DELETE FROM students WHERE id = ANY($1::text[])", [[studentA, studentB]]);
  };

  const createPostgresApp = (pool: Pool) => {
    const curriculumRepository = createPostgresStudentCurriculumRepository(pool);
    return buildApp({
      courseCatalogRepository: createPostgresCourseCatalogRepository(pool),
      progressService: createPostgresProgressService(createPostgresProgressStateRepository(pool), curriculumRepository),
      studentCurriculumRepository: curriculumRepository,
    });
  };

  try {
    await cleanup(database.pool);
    const lesson = await database.pool.query<{ id: string }>(
      "SELECT id FROM lessons WHERE playback_target_id IS NOT NULL ORDER BY sequence ASC LIMIT 1",
    );
    assert.ok(lesson.rows[0]);

    const version = {
      changeReason: "initial" as const,
      steps: [{
        sourceId: stepId,
        title: "E2E 로그 기초",
        goal: "PostgreSQL 기반 핵심 학습 흐름을 확인합니다.",
        conceptTags: ["E2E 로그 개념"],
        estimatedMinutes: 30,
        items: [
          {
            sourceId: lectureItemId,
            kind: "lecture" as const,
            lessonId: lesson.rows[0].id,
            title: "E2E 강의",
            description: "재생 가능한 E2E 강의입니다.",
            conceptTags: ["E2E 로그 개념"],
            estimatedMinutes: 20,
            required: true,
            reason: "핵심 개념 학습",
          },
          {
            sourceId: reviewItemId,
            kind: "review" as const,
            lessonId: null,
            title: "E2E 복습",
            description: "강의 뒤 복습합니다.",
            conceptTags: ["E2E 로그 개념"],
            estimatedMinutes: 10,
            required: true,
            reason: "학습 내용 정리",
          },
        ],
      }],
    };
    const initialState = { currentStepId: stepId, completedStepIds: [], weakConcepts: [] };
    const presentation = {
      paceLabel: "E2E 검증형",
      description: "PostgreSQL API 통합 검증용 커리큘럼입니다.",
      recommendedFor: ["통합 검증"],
      teacherComment: "상태 복구와 학생 격리를 확인합니다.",
    };
    const curriculumRepository = createPostgresStudentCurriculumRepository(database.pool);
    await curriculumRepository.seedCandidate({ id: curriculumA, studentId: studentA, subjectCode: "math-logarithm", title: "학생 A E2E 커리큘럼", presentation, state: initialState, version });
    await curriculumRepository.seedCandidate({ id: curriculumB, studentId: studentB, subjectCode: "math-logarithm", title: "학생 B E2E 커리큘럼", presentation, state: initialState, version });

    firstApp = createPostgresApp(database.pool);
    const health = await firstApp.inject({ method: "GET", url: "/api/health" });
    const catalog = await firstApp.inject({ method: "GET", url: "/api/course-catalogs" });
    assert.equal(health.json().dataSource, "postgres");
    assert.equal(catalog.json().catalogDataSource, "postgres");

    const selectionA = await firstApp.inject({
      method: "POST",
      url: "/api/student-context/curriculum",
      payload: { studentId: studentA, curriculumId: curriculumA },
    });
    const selectionB = await firstApp.inject({
      method: "POST",
      url: "/api/student-context/curriculum",
      payload: { studentId: studentB, curriculumId: curriculumB },
    });
    assert.equal(selectionA.statusCode, 200);
    assert.equal(selectionA.json().dataSource, "postgres");
    assert.equal(selectionA.json().snapshot.revision, 1);
    assert.equal(selectionA.json().snapshot.todaySession.items[0].id, lectureItemId);
    assert.equal(selectionB.json().snapshot.revision, 1);
    const expectedStudentB = selectionB.json().snapshot;

    const playback = await firstApp.inject({
      method: "GET",
      url: `/api/lesson-items/${encodeURIComponent(lectureItemId)}/playback?studentId=${studentA}`,
    });
    const reviewPlayback = await firstApp.inject({
      method: "GET",
      url: `/api/lesson-items/${encodeURIComponent(reviewItemId)}/playback?studentId=${studentA}`,
    });
    assert.equal(playback.statusCode, 200);
    assert.equal(reviewPlayback.statusCode, 404);
    assert.equal(reviewPlayback.json().code, "PLAYBACK_NOT_AVAILABLE");

    const feedback = await firstApp.inject({
      method: "POST",
      url: "/api/lesson-feedback",
      payload: { studentId: studentA, lessonId: lectureItemId, understandingLevel: 1, focusLevel: 1 },
    });
    assert.equal(feedback.statusCode, 200);
    assert.equal(feedback.json().dataSource, "postgres");
    assert.equal(feedback.json().snapshot.revision, 2);
    assert.equal(feedback.json().snapshot.studentContext.completedLessonItemIds.includes(lectureItemId), true);
    assert.equal(feedback.json().snapshot.studentContext.weakConcepts.includes("E2E 로그 개념"), true);
    assert.equal(feedback.json().snapshot.progress.nextRecommendedItem.id, reviewItemId);
    assert.equal(feedback.json().snapshot.progress.nextRecommendedItem.action, "open-review");
    const databaseState = await database.pool.query<{ revision: number; event_count: string }>(
      `SELECT states.revision, count(events.id)::text AS event_count
       FROM student_learning_states states
       LEFT JOIN lesson_feedback_events events ON events.student_id = states.student_id AND events.subject_code = states.subject_code
       WHERE states.student_id = $1 AND states.subject_code = 'math-logarithm'
       GROUP BY states.revision`,
      [studentA],
    );
    assert.equal(databaseState.rows[0].revision, 2);
    assert.equal(databaseState.rows[0].event_count, "1");

    const proposalResponse = await firstApp.inject({
      method: "POST",
      url: `/api/conversations/${testPrefix}-adjustment/messages`,
      payload: { studentId: studentA, message: "오늘 시간이 부족해요." },
    });
    const proposal = proposalResponse.json().attachment.data;
    assert.equal(proposalResponse.json().dataSource, "postgres");
    assert.equal(proposal.baseRevision, 2);
    const unchangedAfterProposal = await firstApp.inject({ method: "GET", url: `/api/learning-snapshot?studentId=${studentA}` });
    assert.equal(unchangedAfterProposal.json().snapshot.revision, 2);

    const crossStudentConfirmation = await firstApp.inject({
      method: "POST",
      url: `/api/session-adjustments/${proposal.adjustmentId}/confirm`,
      payload: { studentId: studentB, expectedRevision: 1 },
    });
    assert.equal(crossStudentConfirmation.statusCode, 404);
    const unchangedStudentB = await firstApp.inject({ method: "GET", url: `/api/learning-snapshot?studentId=${studentB}` });
    assert.equal(unchangedStudentB.statusCode, 200);
    assert.deepEqual(unchangedStudentB.json().snapshot, expectedStudentB);

    const confirmation = await firstApp.inject({
      method: "POST",
      url: `/api/session-adjustments/${proposal.adjustmentId}/confirm`,
      payload: { studentId: studentA, expectedRevision: 2 },
    });
    assert.equal(confirmation.statusCode, 200);
    assert.equal(confirmation.json().snapshot.revision, 3);
    assert.equal(confirmation.json().snapshot.studentContext.maxSessionMinutes < 45, true);
    const repeatedConfirmation = await firstApp.inject({
      method: "POST",
      url: `/api/session-adjustments/${proposal.adjustmentId}/confirm`,
      payload: { studentId: studentA, expectedRevision: 3 },
    });
    assert.equal(repeatedConfirmation.statusCode, 404);

    const staleProposalResponse = await firstApp.inject({
      method: "POST",
      url: `/api/conversations/${testPrefix}-stale-adjustment/messages`,
      payload: { studentId: studentA, message: "오늘 시간이 부족해요." },
    });
    const staleProposal = staleProposalResponse.json().attachment.data;
    assert.equal(staleProposal.baseRevision, 3);
    const secondFeedback = await firstApp.inject({
      method: "POST",
      url: "/api/lesson-feedback",
      payload: { studentId: studentA, lessonId: lectureItemId, understandingLevel: 3, focusLevel: 3 },
    });
    assert.equal(secondFeedback.json().snapshot.revision, 4);
    const staleConfirmation = await firstApp.inject({
      method: "POST",
      url: `/api/session-adjustments/${staleProposal.adjustmentId}/confirm`,
      payload: { studentId: studentA, expectedRevision: 3 },
    });
    assert.equal(staleConfirmation.statusCode, 409);
    assert.equal(staleConfirmation.json().snapshot.revision, 4);

    const expectedSnapshot = secondFeedback.json().snapshot;
    await firstApp.close();
    firstApp = undefined;
    await database.close();

    const restartedDatabase = createDatabaseClient(databaseUrl!);
    activeDatabase = restartedDatabase;
    restartedApp = createPostgresApp(restartedDatabase.pool);
    const restored = await restartedApp.inject({ method: "GET", url: `/api/learning-snapshot?studentId=${studentA}` });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().dataSource, "postgres");
    assert.deepEqual(restored.json().snapshot, expectedSnapshot);

    await cleanup(restartedDatabase.pool);
    const remainingTestStudents = await restartedDatabase.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM students WHERE id = ANY($1::text[])",
      [[studentA, studentB]],
    );
    assert.equal(remainingTestStudents.rows[0].count, "0");
    cleaned = true;
  } finally {
    await firstApp?.close();
    await restartedApp?.close();
    if (!cleaned) await cleanup(activeDatabase.pool);
    await activeDatabase.close();
  }
});

databaseTest("과목 등록 저장소는 첫 버전과 실행 상태를 원자적으로 만든다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const repository = createPostgresStudentCurriculumRepository(database.pool);
  const studentId = `db-enrollment-${randomUUID()}`;
  const curriculumId = `db-enrollment-curriculum-${randomUUID()}`;
  const subjectCode = "english-reading";
  const lesson = await database.pool.query<{ id: string }>(
    "SELECT id FROM lessons WHERE course_id = 'ebsi-2027-suneungwanseong-kimjehee-english-all' AND lesson_type <> 'orientation' ORDER BY sequence ASC LIMIT 1",
  );
  assert.ok(lesson.rows[0]);

  const cleanup = async () => {
    await database.pool.query("DELETE FROM student_learning_states WHERE student_id = $1 AND subject_code = $2", [studentId, subjectCode]);
    await database.pool.query(
      "DELETE FROM curriculum_items WHERE curriculum_step_id IN (SELECT id FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = $1))",
      [curriculumId],
    );
    await database.pool.query("DELETE FROM curriculum_steps WHERE curriculum_version_id IN (SELECT id FROM curriculum_versions WHERE student_curriculum_id = $1)", [curriculumId]);
    await database.pool.query("UPDATE student_curricula SET current_version_id = NULL WHERE id = $1", [curriculumId]);
    await database.pool.query("DELETE FROM curriculum_versions WHERE student_curriculum_id = $1", [curriculumId]);
    await database.pool.query("DELETE FROM student_curricula WHERE id = $1", [curriculumId]);
    await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
  };
  context.after(async () => { await cleanup(); await database.close(); });

  const input = {
    id: curriculumId,
    studentId,
    subjectCode,
    title: "영어 등록 검증 커리큘럼",
    presentation: { paceLabel: "기본 등록안", description: "등록 검증", recommendedFor: ["검증"], teacherComment: "첫 수업을 시작합니다." },
    state: { currentStepId: "step-001", currentItemId: "item-001", completedItemIds: [], reinforcementConcepts: [], maxSessionMinutes: 45 },
    version: {
      changeReason: "initial" as const,
      steps: [{
        sourceId: "step-001", title: "영어 첫 강의", goal: null, conceptTags: ["영어"], estimatedMinutes: 10,
        items: [{ sourceId: "item-001", kind: "lecture" as const, lessonId: lesson.rows[0].id, title: "영어 첫 강의", description: null, conceptTags: ["영어"], estimatedMinutes: 10, required: true, reason: "초기 등록" }],
      }],
    },
  };
  const created = await repository.enrollSubject!(input);
  assert.equal(created.kind, "created");
  if (created.kind !== "created") throw new Error("과목 등록을 만들지 못했습니다.");
  assert.equal(created.curriculum.status, "active");
  assert.equal(created.curriculum.currentVersion?.versionNumber, 1);
  const readModel = await repository.getActiveReadModel(studentId, subjectCode);
  assert.equal(readModel.kind, "active");
  if (readModel.kind !== "active") throw new Error("활성 읽기 모델을 찾지 못했습니다.");
  assert.equal(readModel.executionState?.revision, 1);
  assert.equal((readModel.executionState?.state.context as { currentItemId?: string } | undefined)?.currentItemId, "item-001");
  assert.deepEqual(await repository.enrollSubject!(input), { kind: "already-enrolled" });
});

databaseTest("과목 등록 확정 API는 제안 확인 뒤 새 과목 snapshot을 반환한다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const studentId = `db-enrollment-api-${randomUUID()}`;
  const studentCurriculumRepository = createPostgresStudentCurriculumRepository(database.pool);
  const app = buildApp({
    courseCatalogRepository: createPostgresCourseCatalogRepository(database.pool),
    studentCurriculumRepository,
    subjectEnrollmentProposalRepository: createPostgresSubjectEnrollmentProposalRepository(database.pool),
    progressServiceResolver: (subjectCode) => createPostgresProgressService(
      createPostgresProgressStateRepository(database.pool, subjectCode),
      studentCurriculumRepository,
      subjectCode,
    ),
  });
  const cleanup = async () => {
    await database.pool.query("DELETE FROM subject_enrollment_proposals WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM student_learning_states WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM curriculum_items WHERE curriculum_step_id IN (SELECT cs.id FROM curriculum_steps cs JOIN curriculum_versions cv ON cv.id = cs.curriculum_version_id JOIN student_curricula sc ON sc.id = cv.student_curriculum_id WHERE sc.student_id = $1)", [studentId]);
    await database.pool.query("DELETE FROM curriculum_steps WHERE curriculum_version_id IN (SELECT cv.id FROM curriculum_versions cv JOIN student_curricula sc ON sc.id = cv.student_curriculum_id WHERE sc.student_id = $1)", [studentId]);
    await database.pool.query("UPDATE student_curricula SET current_version_id = NULL WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM curriculum_versions WHERE student_curriculum_id IN (SELECT id FROM student_curricula WHERE student_id = $1)", [studentId]);
    await database.pool.query("DELETE FROM student_curricula WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
  };
  context.after(async () => { await app.close(); await cleanup(); await database.close(); });

  const proposalResponse = await app.inject({
    method: "POST",
    url: "/api/learning-tools/propose-subject-enrollment",
    payload: { studentId, subjectCode: "english-reading", courseId: "ebsi-2027-suneungwanseong-kimjehee-english-all" },
  });
  assert.equal(proposalResponse.statusCode, 200);
  const proposal = proposalResponse.json().proposal;
  const confirmationResponse = await app.inject({
    method: "POST",
    url: `/api/subject-enrollment-proposals/${proposal.proposalId}/confirm`,
    payload: { studentId, expectedRevision: proposal.baseRevision },
  });
  assert.equal(confirmationResponse.statusCode, 200);
  assert.equal(confirmationResponse.json().dataSource, "postgres");
  assert.equal(confirmationResponse.json().subjectCode, "english-reading");
  assert.equal(confirmationResponse.json().enrollment.currentVersion.steps.length, 40);
  assert.equal(confirmationResponse.json().snapshot.studentContext.selectedCurriculumId, confirmationResponse.json().enrollment.id);
  assert.equal(confirmationResponse.json().snapshot.revision, 1);

  const repeated = await app.inject({
    method: "POST",
    url: `/api/subject-enrollment-proposals/${proposal.proposalId}/confirm`,
    payload: { studentId, expectedRevision: proposal.baseRevision },
  });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().enrollment.id, confirmationResponse.json().enrollment.id);
});

databaseTest("과목 등록 제안은 재시작 뒤에도 확정되고 콘텐츠 강의만 연결한다", async () => {
  const studentId = `db-enrollment-restart-${randomUUID()}`;
  const subjectCode = "english-reading";
  const createEnrollmentApp = (pool: Pool) => {
    const studentCurriculumRepository = createPostgresStudentCurriculumRepository(pool);
    return buildApp({
      courseCatalogRepository: createPostgresCourseCatalogRepository(pool),
      studentCurriculumRepository,
      subjectEnrollmentProposalRepository: createPostgresSubjectEnrollmentProposalRepository(pool),
      progressServiceResolver: (requestedSubjectCode) => createPostgresProgressService(
        createPostgresProgressStateRepository(pool, requestedSubjectCode),
        studentCurriculumRepository,
        requestedSubjectCode,
      ),
    });
  };
  const cleanup = async (pool: Pool) => {
    await pool.query("DELETE FROM subject_enrollment_proposals WHERE student_id = $1", [studentId]);
    await pool.query("DELETE FROM student_learning_states WHERE student_id = $1", [studentId]);
    await pool.query("DELETE FROM curriculum_items WHERE curriculum_step_id IN (SELECT cs.id FROM curriculum_steps cs JOIN curriculum_versions cv ON cv.id = cs.curriculum_version_id JOIN student_curricula sc ON sc.id = cv.student_curriculum_id WHERE sc.student_id = $1)", [studentId]);
    await pool.query("DELETE FROM curriculum_steps WHERE curriculum_version_id IN (SELECT cv.id FROM curriculum_versions cv JOIN student_curricula sc ON sc.id = cv.student_curriculum_id WHERE sc.student_id = $1)", [studentId]);
    await pool.query("UPDATE student_curricula SET current_version_id = NULL WHERE student_id = $1", [studentId]);
    await pool.query("DELETE FROM curriculum_versions WHERE student_curriculum_id IN (SELECT id FROM student_curricula WHERE student_id = $1)", [studentId]);
    await pool.query("DELETE FROM student_curricula WHERE student_id = $1", [studentId]);
    await pool.query("DELETE FROM students WHERE id = $1", [studentId]);
  };

  let database = createDatabaseClient(databaseUrl!);
  let app = createEnrollmentApp(database.pool);
  try {
    const proposalResponse = await app.inject({
      method: "POST",
      url: "/api/learning-tools/propose-subject-enrollment",
      payload: { studentId, subjectCode, courseId: "ebsi-2027-suneungwanseong-kimjehee-english-all" },
    });
    assert.equal(proposalResponse.statusCode, 200);
    const proposal = proposalResponse.json().proposal;
    assert.equal(proposal.proposalId.startsWith("enrollment-proposal:"), true);
    assert.equal((await database.pool.query("SELECT count(*)::text AS count FROM student_curricula WHERE student_id = $1", [studentId])).rows[0].count, "0");
    assert.equal((await database.pool.query("SELECT count(*)::text AS count FROM student_learning_states WHERE student_id = $1", [studentId])).rows[0].count, "0");
    assert.equal((await database.pool.query<{ status: string }>("SELECT status FROM subject_enrollment_proposals WHERE id = $1", [proposal.proposalId])).rows[0].status, "pending");

    await app.close();
    await database.close();
    database = createDatabaseClient(databaseUrl!);
    app = createEnrollmentApp(database.pool);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/subject-enrollment-proposals/${proposal.proposalId}/confirm`,
      payload: { studentId, expectedRevision: proposal.baseRevision },
    });
    assert.equal(confirmed.statusCode, 200);
    const curriculumId = confirmed.json().enrollment.id;
    const linkedItems = await database.pool.query<{ content_count: string; orientation_count: string }>(
      `SELECT count(*)::text AS content_count,
              count(*) FILTER (WHERE l.lesson_type = 'orientation')::text AS orientation_count
       FROM curriculum_items ci
       JOIN curriculum_steps cs ON cs.id = ci.curriculum_step_id
       JOIN curriculum_versions cv ON cv.id = cs.curriculum_version_id
       JOIN lessons l ON l.id = ci.lesson_id
       WHERE cv.student_curriculum_id = $1 AND ci.kind = 'lecture'`,
      [curriculumId],
    );
    assert.deepEqual(linkedItems.rows[0], { content_count: "40", orientation_count: "0" });
    assert.equal((await database.pool.query<{ status: string }>("SELECT status FROM subject_enrollment_proposals WHERE id = $1", [proposal.proposalId])).rows[0].status, "confirmed");

    const repeated = await app.inject({
      method: "POST",
      url: `/api/subject-enrollment-proposals/${proposal.proposalId}/confirm`,
      payload: { studentId, expectedRevision: proposal.baseRevision },
    });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.json().enrollment.id, curriculumId);
  } finally {
    await app.close();
    await cleanup(database.pool);
    await database.close();
  }
});
databaseTest("과목 등록 제안은 만료와 revision 충돌을 거절하고 커리큘럼을 남기지 않는다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const studentId = `db-enrollment-conflict-${randomUUID()}`;
  const studentCurriculumRepository = createPostgresStudentCurriculumRepository(database.pool);
  const app = buildApp({
    courseCatalogRepository: createPostgresCourseCatalogRepository(database.pool),
    studentCurriculumRepository,
    subjectEnrollmentProposalRepository: createPostgresSubjectEnrollmentProposalRepository(database.pool),
    progressServiceResolver: (subjectCode) => createPostgresProgressService(
      createPostgresProgressStateRepository(database.pool, subjectCode),
      studentCurriculumRepository,
      subjectCode,
    ),
  });
  const cleanup = async () => {
    await database.pool.query("DELETE FROM subject_enrollment_proposals WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM student_learning_states WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM student_curricula WHERE student_id = $1", [studentId]);
    await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
  };
  context.after(async () => { await app.close(); await cleanup(); await database.close(); });

  const propose = async () => app.inject({
    method: "POST",
    url: "/api/learning-tools/propose-subject-enrollment",
    payload: { studentId, subjectCode: "english-reading", courseId: "ebsi-2027-suneungwanseong-kimjehee-english-all" },
  });
  const expiredProposalResponse = await propose();
  const expiredProposal = expiredProposalResponse.json().proposal;
  await database.pool.query("UPDATE subject_enrollment_proposals SET expires_at = now() - interval '1 second' WHERE id = $1", [expiredProposal.proposalId]);
  const expired = await app.inject({
    method: "POST",
    url: `/api/subject-enrollment-proposals/${expiredProposal.proposalId}/confirm`,
    payload: { studentId, expectedRevision: expiredProposal.baseRevision },
  });
  assert.equal(expired.statusCode, 409);
  assert.equal(expired.json().code, "PROPOSAL_EXPIRED");

  const conflictProposalResponse = await propose();
  const conflictProposal = conflictProposalResponse.json().proposal;
  await database.pool.query(
    `INSERT INTO student_learning_states (student_id, subject_code, revision, state_json, created_at, updated_at)
     VALUES ($1, 'english-reading', 1, '{}'::jsonb, now(), now())`,
    [studentId],
  );
  const conflict = await app.inject({
    method: "POST",
    url: `/api/subject-enrollment-proposals/${conflictProposal.proposalId}/confirm`,
    payload: { studentId, expectedRevision: conflictProposal.baseRevision },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "REVISION_CONFLICT");
  assert.equal((await database.pool.query("SELECT count(*)::text AS count FROM student_curricula WHERE student_id = $1", [studentId])).rows[0].count, "0");
});
databaseTest("과목 등록 확정은 중간 삽입 실패 시 모든 커리큘럼 행을 롤백한다", async (context) => {
  const database = createDatabaseClient(databaseUrl!);
  const proposalRepository = createPostgresSubjectEnrollmentProposalRepository(database.pool);
  const courseRepository = createPostgresCourseCatalogRepository(database.pool);
  const studentId = `db-enrollment-rollback-${randomUUID()}`;
  const proposalId = `enrollment-proposal-${randomUUID()}`;
  const curriculumId = `enrollment-rollback-${randomUUID()}`;
  const courseCatalog = await courseRepository.getCourseCatalog("ebsi-2027-suneungwanseong-kimjehee-english-all");
  if (!courseCatalog) throw new Error("영어 강좌 카탈로그를 찾지 못했습니다.");
  const lessons = courseCatalog.lessons.filter((lesson) => lesson.lessonType !== "orientation");
  const proposal = {
    proposalId,
    studentId,
    subjectCode: "english-reading",
    baseRevision: 0,
    interpretedRequest: { courseId: courseCatalog.course.id, weeklyMinutes: null },
    before: { enrolled: false },
    after: {
      course: courseCatalog.course,
      contentLessonCount: lessons.length,
      estimatedTotalMinutes: Math.ceil(lessons.reduce((total, lesson) => total + lesson.duration.seconds, 0) / 60),
      firstLesson: { lessonId: lessons[0].id, title: lessons[0].title, estimatedMinutes: Math.ceil(lessons[0].duration.seconds / 60), unitNames: lessons[0].unitNames },
    },
    scheduleImpact: { kind: "not-assessed" as const, message: "검증용" },
    reasonCodes: ["catalog_course_verified"],
    warnings: [],
    requiresConfirmation: true as const,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const enrollment = {
    id: curriculumId,
    studentId,
    subjectCode: "english-reading",
    title: courseCatalog.course.title,
    presentation: { paceLabel: "검증", description: "롤백 검증", recommendedFor: ["검증"], teacherComment: "롤백 검증" },
    state: { currentStepId: "duplicate-step", currentItemId: "item-001", completedItemIds: [], reinforcementConcepts: [], maxSessionMinutes: 45 },
    version: {
      changeReason: "initial" as const,
      steps: lessons.map((lesson, index) => ({
        sourceId: "duplicate-step",
        title: lesson.title,
        goal: null,
        conceptTags: ["영어"],
        estimatedMinutes: Math.ceil(lesson.duration.seconds / 60),
        items: [{
          sourceId: `item-${String(index + 1).padStart(3, "0")}`,
          kind: "lecture" as const,
          lessonId: lesson.id,
          title: lesson.title,
          description: null,
          conceptTags: ["영어"],
          estimatedMinutes: Math.ceil(lesson.duration.seconds / 60),
          required: true,
          reason: "롤백 검증",
        }],
      })),
    },
  };
  context.after(async () => {
    await database.pool.query("DELETE FROM subject_enrollment_proposals WHERE id = $1", [proposalId]);
    await database.pool.query("DELETE FROM students WHERE id = $1", [studentId]);
    await database.close();
  });

  await proposalRepository.create(proposal, { studentId, subjectCode: "english-reading", courseId: courseCatalog.course.id });
  await assert.rejects(
    proposalRepository.confirm({ studentId, proposalId, expectedRevision: 0, enrollment }),
    /duplicate key/,
  );
  assert.equal((await database.pool.query("SELECT count(*)::text AS count FROM student_curricula WHERE id = $1", [curriculumId])).rows[0].count, "0");
  assert.equal((await database.pool.query("SELECT count(*)::text AS count FROM curriculum_versions WHERE student_curriculum_id = $1", [curriculumId])).rows[0].count, "0");
});
