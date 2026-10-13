import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { createPostgresLearningPlanStudentDirectory } from "../src/db/learning-plan-student-directory.js";
import { createPostgresCourseCatalogRepository } from "../src/course-catalog/course-catalog.postgres-repository.js";
import { createPostgresLearningPlanRepository } from "../src/learning-plan/learning-plan.postgres-repository.js";
import { createLearningPlanService } from "../src/learning-plan/learning-plan.service.js";
import { LearningPlanRepositoryError, type LearningPlanConfirmResult } from "../src/learning-plan/learning-plan.repository.js";
import { openLearningPlanTestPool } from "./helpers/learning-plan-http-harness.js";
import { readLearningPlanStateAudit } from "./helpers/learning-plan-state-audit.js";

test("directory의 잘못된 ID는 DB 연결 전에 거절한다", async () => {
  const directory = createPostgresLearningPlanStudentDirectory({ connect() { assert.fail("잘못된 ID로 DB에 접속했습니다."); } } as unknown as Pool);
  for (const id of ["", " leading", "trailing ", "x".repeat(101), null]) {
    await assert.rejects(directory.assertStudentExists(id as string), hasCode("INVALID_CANDIDATE"));
  }
});

test("R3 학생 directory와 제안의 PostgreSQL 확인 경계", { skip: !process.env.TEST_DATABASE_URL }, async (suite) => {
  const pool = await openLearningPlanTestPool();
  const directory = createPostgresLearningPlanStudentDirectory(pool);
  const repository = createPostgresLearningPlanRepository(pool);
  const service = createLearningPlanService(repository, () => new Date("2040-01-01T00:00:00Z"));
  const students = ["a", "b", "inactive", "demo"].map((suffix) => `directory-test-${randomUUID()}-${suffix}`);
  let confirmed: LearningPlanConfirmResult | undefined;
  try {
    for (const [index, id] of students.entries()) await pool.query(
      "INSERT INTO students(id,display_name,status,created_at,updated_at) VALUES($1,'검사 전용 이름',$2,now(),now())",
      [id, index === 2 ? "inactive" : index === 3 ? "demo" : "active"],
    );
    const courses = await createPostgresCourseCatalogRepository(pool).listCourses();
    const selections = courses.map(({ id, primarySubject }) => ({ courseId: id, subjectCode: primarySubject }));

    await suite.test("활성·데모 학생의 ID와 계획 유무를 읽고 unknown·비활성을 차단한다", async () => {
      const before = await readLearningPlanStateAudit(pool, students[0]);
      const targets = await directory.listStudentTargets();
      const own = targets.filter(({ studentId }) => students.includes(studentId));
      assert.deepEqual(own, [students[0], students[1], students[3]].sort().map((studentId) => ({ studentId, hasLearningPlan: false })));
      for (const target of targets) assert.deepEqual(Object.keys(target).sort(), ["hasLearningPlan", "studentId"]);
      await directory.assertStudentExists(students[0]);
      await directory.assertStudentExists(students[3]);
      assert.equal((await pool.query("SELECT status FROM students WHERE id=$1", [students[3]])).rows[0].status, "demo");
      await assert.rejects(directory.assertStudentExists(students[2]), hasCode("NOT_FOUND"));
      const missing = `unknown-${randomUUID()}`;
      await assert.rejects(directory.assertStudentExists(missing), hasCode("NOT_FOUND"));
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM students WHERE id=$1", [missing])).rows[0].count, 0);
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[0]), before);
    });

    await suite.test("실제 생성 제안은 학습 상태를 바꾸지 않고 다른 학생은 확정하지 못한다", async () => {
      const beforeA = await readLearningPlanStateAudit(pool, students[0]);
      const beforeB = await readLearningPlanStateAudit(pool, students[1]);
      const result = await service.create({ studentId: students[0], selections, startDate: "2040-01-01",
        deadlineDate: "2040-12-31", availableSecondsPerDay: 3600 });
      assert.equal(result.kind, "proposed");
      if (result.kind !== "proposed") assert.fail("실제 카탈로그의 생성 제안이 없습니다.");
      assert.equal(result.candidate.items.length, 126);
      assert.equal(result.candidate.assignments.reduce((sum, row) => sum + row.durationSeconds, 0), 419939);
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[0]), beforeA);
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[1]), beforeB);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_proposals WHERE student_id=$1", [students[0]])).rows[0].count, 1);
      assert.equal((await directory.listStudentTargets()).find(({ studentId }) => studentId === students[0])?.hasLearningPlan, false);
      await assert.rejects(repository.confirmProposal({ studentId: students[1], proposalId: result.proposal.proposalId,
        expectedBasis: result.proposal.expectedBasis }), hasCode("NOT_FOUND"));
      confirmed = await repository.confirmProposal({ studentId: students[0], proposalId: result.proposal.proposalId, expectedBasis: result.proposal.expectedBasis });
      const saved = await readLearningPlanStateAudit(pool, students[0]);
      const replay = await repository.confirmProposal({ studentId: students[0], proposalId: result.proposal.proposalId, expectedBasis: result.proposal.expectedBasis });
      assert.equal(replay.replayed, true);
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[0]), saved);
      assert.equal((await directory.listStudentTargets()).find(({ studentId }) => studentId === students[0])?.hasLearningPlan, true);
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[1]), beforeB);
    });

    await suite.test("재편성 제안은 실제 진도를 보존하고 기록 변경 후 오래된 확정은 차단한다", async () => {
      assert.ok(confirmed);
      const before = await readLearningPlanStateAudit(pool, students[0]);
      const current = await repository.readBasis({ studentId: students[0], selections });
      const pending = await service.rebalance({ studentId: students[0], planId: confirmed.planId,
        expectedBasis: current.basis, fromDate: "2040-01-01", availableSecondsPerDay: 4000 });
      assert.equal(pending.kind, "proposed");
      if (pending.kind !== "proposed") assert.fail("재편성 제안이 없습니다.");
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[0]), before);
      const item = confirmed.version.candidate.items[0];
      const progress = { studentId: students[0], planId: confirmed.planId, itemKey: item.itemKey,
        idempotencyKey: "directory-boundary-progress", positionSeconds: 100, spentSeconds: 120 };
      await repository.recordProgress(progress);
      const afterProgress = await readLearningPlanStateAudit(pool, students[0]);
      await repository.recordProgress(progress);
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[0]), afterProgress);
      await assert.rejects(repository.confirmProposal({ studentId: students[0], proposalId: pending.proposal.proposalId,
        expectedBasis: pending.proposal.expectedBasis }), hasCode("BASIS_CONFLICT"));
      assert.deepEqual(await readLearningPlanStateAudit(pool, students[0]), afterProgress);
    });

    await suite.test("확정 중 실패는 학습 상태 전체를 롤백하고 동일 제안 재확정으로 복구한다", async () => {
      assert.ok(confirmed);
      const current = await repository.readBasis({ studentId: students[0], selections });
      const pending = await service.rebalance({ studentId: students[0], planId: confirmed.planId,
        expectedBasis: current.basis, fromDate: "2040-01-01", availableSecondsPerDay: 4000 });
      assert.equal(pending.kind, "proposed");
      if (pending.kind !== "proposed") assert.fail("재편성 제안이 없습니다.");
      const before = await readLearningPlanStateAudit(pool, students[0]);
      const name = `test_directory_fail_${randomUUID().replaceAll("-", "")}`;
      assert.match(confirmed.planId, /^[a-f0-9-]+$/);
      await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.plan_id='${confirmed.planId}' THEN RAISE EXCEPTION '학생 경계 검증용 실패'; END IF; RETURN NEW; END $$`);
      try {
        await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON learning_plan_assignments FOR EACH ROW EXECUTE FUNCTION ${name}()`);
        await assert.rejects(repository.confirmProposal({ studentId: students[0], proposalId: pending.proposal.proposalId, expectedBasis: pending.proposal.expectedBasis }));
        assert.deepEqual(await readLearningPlanStateAudit(pool, students[0]), before);
        assert.equal((await pool.query("SELECT status FROM learning_plan_proposals WHERE id=$1", [pending.proposal.proposalId])).rows[0].status, "pending");
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON learning_plan_assignments`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
      const recovered = await repository.confirmProposal({ studentId: students[0], proposalId: pending.proposal.proposalId, expectedBasis: pending.proposal.expectedBasis });
      assert.equal(recovered.basis.planRevision, 2);
      const actual = await repository.readPlan({ studentId: students[0] });
      assert.equal(actual?.progress.find(({ itemKey }) => itemKey === confirmed!.version.candidate.items[0].itemKey)?.positionSeconds, 100);
      assert.equal(actual?.dailyUsage[0].spentSeconds, 120);
    });
  } finally {
    // 이 실행이 생성한 학생만 정리하며 기존 학생과 카탈로그는 변경하지 않는다.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const planIds = (await client.query("SELECT id FROM learning_plans WHERE student_id=ANY($1::varchar[])", [students])).rows.map(({ id }) => id);
      await client.query("DELETE FROM learning_plan_proposals WHERE student_id=ANY($1::varchar[])", [students]);
      await client.query("UPDATE learning_plans SET current_version_id=NULL WHERE student_id=ANY($1::varchar[])", [students]);
      for (const table of ["learning_plan_progress_events", "learning_plan_completion_keys", "learning_plan_feedbacks", "learning_plan_completions",
        "learning_plan_assignments", "learning_plan_items", "learning_plan_versions"]) await client.query(`DELETE FROM ${table} WHERE plan_id=ANY($1::varchar[])`, [planIds]);
      await client.query("DELETE FROM learning_plans WHERE student_id=ANY($1::varchar[])", [students]);
      await client.query("DELETE FROM students WHERE id=ANY($1::varchar[])", [students]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); await pool.end(); }
  }
});

function hasCode(code: LearningPlanRepositoryError["code"]) {
  return (error: unknown) => error instanceof LearningPlanRepositoryError && error.code === code;
}
