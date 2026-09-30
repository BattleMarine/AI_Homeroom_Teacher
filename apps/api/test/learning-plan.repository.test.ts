import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createFileCourseCatalogRepository } from "../src/course-catalog/course-catalog.file-repository.js";
import { createPostgresCourseCatalogRepository } from "../src/course-catalog/course-catalog.postgres-repository.js";
import { canonicalLearningPlanJson, learningPlanCatalogHash } from "../src/learning-plan/learning-plan.catalog-basis.js";
import { createPostgresLearningPlanRepository } from "../src/learning-plan/learning-plan.postgres-repository.js";
import { learningPlanProposalTtlSeconds, LearningPlanRepositoryError, type LearningPlanCandidate,
  type LearningPlanReadBasisResult, type LearningPlanRepositoryErrorCode } from "../src/learning-plan/learning-plan.repository.js";

test("canonical JSON은 객체 순서에 독립적이고 비JSON 값을 거부한다", () => {
  assert.equal(canonicalLearningPlanJson({ b: [1, { z: null, a: true }], a: "가" }),
    canonicalLearningPlanJson({ a: "가", b: [1, { a: true, z: null }] }));
  assert.throws(() => canonicalLearningPlanJson({ missing: undefined }));
  assert.throws(() => canonicalLearningPlanJson({ seconds: Infinity }));
  assert.throws(() => canonicalLearningPlanJson(new Date()));
  assert.throws(() => canonicalLearningPlanJson(new Array(2)));
});

const connection = process.env.TEST_DATABASE_URL;
test("전체 일정 PostgreSQL 저장 기반", { skip: !connection }, async (suite) => {
  // 일반 DATABASE_URL만 설정된 개발 셸에서는 실행하지 않는다.
  assert.equal(process.env.VERIFY_TOOLS_ALLOW_TEST_DATABASE, "1", "명시적인 테스트 DB 허용이 필요합니다.");
  const url = new URL(connection!);
  assert.match(url.pathname, /^\/test_learning_plan_[a-f0-9]{32}$/);
  const pool = new Pool({ connectionString: connection });
  const repository = createPostgresLearningPlanRepository(pool);
  const students: string[] = [];
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, url.pathname.slice(1));
    assert.deepEqual((await pool.query("SELECT id FROM app_schema_migrations ORDER BY id")).rows.map(({ id }) => id), [
      "0000_initial_schema.sql", "0001_student_curricula.sql", "0002_curriculum_read_model.sql",
      "0003_subject_enrollment_proposals.sql", "0007_learning_plans.sql",
    ]);
    const catalog = createPostgresCourseCatalogRepository(pool);
    const courses = await catalog.listCourses();
    const selections = courses.map((course) => ({ subjectCode: course.primarySubject, courseId: course.id }));
    const originalCatalogs = await Promise.all(courses.map(({ id }) => catalog.getCourseCatalog(id)));
    const source = createFileCourseCatalogRepository();
    for (const actual of originalCatalogs) {
      assert.ok(actual);
      assert.deepEqual(actual, await source.getCourseCatalog(actual.course.id));
    }

    async function fixture() {
      const studentId = `learning-plan-test-${randomUUID()}`;
      students.push(studentId);
      await pool.query("INSERT INTO students(id,status,created_at,updated_at) VALUES($1,'active',now(),now())", [studentId]);
      const read = await repository.readBasis({ studentId, selections });
      const candidate = makeCandidate(read);
      return { studentId, candidate, read,
        async propose(kind: "create" | "rebalance" = "create", basis = read.basis, value = candidate) {
          return repository.saveProposal({ studentId, expectedBasis: basis, candidate: value, kind,
            scope: { fixture: true }, reason: "저장 경계 검증용 명시적 후보", diff: {} });
        } };
    }
    async function confirm(f: Awaited<ReturnType<typeof fixture>>) {
      const saved = await f.propose();
      return repository.confirmProposal({ studentId: f.studentId, proposalId: saved.proposalId, expectedBasis: saved.expectedBasis });
    }
    async function revised(f: Awaited<ReturnType<typeof fixture>>) {
      const read = await repository.readBasis({ studentId: f.studentId, selections });
      const value = structuredClone(f.candidate);
      const completed = new Set(read.completions.map(({ itemKey }) => itemKey));
      value.assignments = value.assignments.filter(({ itemKey }) => !completed.has(itemKey));
      value.conditions = { fixture: true, modified: true };
      return f.propose("rebalance", read.basis, value);
    }

    await suite.test("unknown 학생은 암묵 생성하지 않는다", async () => {
      const missing = `missing-${randomUUID()}`;
      await rejectsCode(() => repository.readBasis({ studentId: missing, selections }), "NOT_FOUND");
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM students WHERE id=$1", [missing])).rows[0].count, 0);
    });

    await suite.test("제안만 저장하고 실제126항목 확정·DATE·초·TTL을 독립 SQL로 확인한다", async () => {
      const f = await fixture();
      assert.deepEqual(f.read.basis, { planId: null, currentVersionId: null, planRevision: 0, completionRevision: 0,
        catalogHash: learningPlanCatalogHash(f.read.catalogSnapshot) });
      assert.deepEqual((await repository.readBasis({ studentId: f.studentId, planId: undefined, selections })).basis, f.read.basis);
      const saved = await f.propose();
      const ttl = new Date(saved.expiresAt).getTime() - new Date(saved.createdAt).getTime();
      assert.ok(ttl >= learningPlanProposalTtlSeconds * 1000 && ttl <= learningPlanProposalTtlSeconds * 1000 + 10);
      assert.equal(await repository.readPlan({ studentId: f.studentId }), undefined);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plans WHERE student_id=$1", [f.studentId])).rows[0].count, 0);
      const result = await repository.confirmProposal({ studentId: f.studentId, proposalId: saved.proposalId, expectedBasis: saved.expectedBasis });
      assert.equal(result.basis.planRevision, 1);
      const rows = (await pool.query(
        `SELECT a.item_key,a.scheduled_date::text AS date,a.item_order,a.duration_seconds,i.lesson_id,i.subject_code,l.course_id
         FROM learning_plan_assignments a JOIN learning_plan_items i USING(plan_id,item_key)
         JOIN lessons l ON l.id=i.lesson_id WHERE a.plan_id=$1 ORDER BY a.scheduled_date,a.item_order`, [result.planId],
      )).rows;
      assert.equal(rows.length, 126);
      assert.equal(rows.reduce((sum, row) => sum + row.duration_seconds, 0), 419939);
      assert.deepEqual(rows.map((row) => ({ itemKey: row.item_key, lessonId: row.lesson_id, subjectCode: row.subject_code,
        courseId: row.course_id, date: row.date, order: row.item_order, durationSeconds: row.duration_seconds })), f.candidate.assignments);
      const queried = await repository.readPlan({ studentId: f.studentId, date: f.candidate.assignments[0].date });
      assert.equal(queried?.assignments.length, 1);
      assert.equal(queried?.version.candidate.assignments.length, 126);
      assert.deepEqual(result.version.candidate, f.candidate);
    });

    await suite.test("동일 제안 동시 확정은 하나의 버전만 만든다", async () => {
      const f = await fixture(); const p = await f.propose();
      const results = await Promise.all([1, 2].map(() => repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis })));
      assert.equal(results.filter(({ replayed }) => replayed).length, 1);
      assert.equal(results[0].version.versionId, results[1].version.versionId);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_versions WHERE plan_id=$1", [results[0].planId])).rows[0].count, 1);
    });

    await suite.test("활성 계획 부재를 기준으로 한 서로 다른 동시 확정은 하나만 성공한다", async () => {
      const f = await fixture(); const proposals = await Promise.all([f.propose(), f.propose()]);
      const results = await Promise.allSettled(proposals.map((p) => repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis })));
      assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
      const rejected = results.find(({ status }) => status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.code, "BASIS_CONFLICT");
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plans WHERE student_id=$1", [f.studentId])).rows[0].count, 1);
    });

    await suite.test("최신 revision 이후에도 정확한 재확정은 최초 결과를 반환한다", async () => {
      const f = await fixture(); const p = await f.propose();
      const first = await repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis });
      const next = await revised(f);
      await repository.confirmProposal({ studentId: f.studentId, proposalId: next.proposalId, expectedBasis: next.expectedBasis });
      const replay = await repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis });
      assert.deepEqual(replay, { ...first, replayed: true });
      await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId,
        expectedBasis: { ...p.expectedBasis, planRevision: 8 } }), "BASIS_CONFLICT");
      await rejectsCode(() => f.propose("rebalance", first.basis), "BASIS_CONFLICT");
    });

    await suite.test("최초 완료·alias 키·payload를 보존하고 key 다른 대상 재사용을 차단한다", async () => {
      const f = await fixture(); const plan = await confirm(f);
      const input = { studentId: f.studentId, planId: plan.planId, itemKey: f.candidate.items[0].itemKey,
        idempotencyKey: "initial", payload: { focus: 4, nested: { understood: true } } };
      const first = await repository.recordCompletion(input);
      const replay = await repository.recordCompletion({ ...input, idempotencyKey: "alias", payload: { nested: { understood: true }, focus: 4 } });
      assert.deepEqual(replay, { ...first, replayed: true });
      assert.deepEqual(await repository.recordCompletion(input), { ...first, replayed: true });
      await rejectsCode(() => repository.recordCompletion({ ...input, idempotencyKey: "alias", itemKey: f.candidate.items[1].itemKey }), "IDEMPOTENCY_CONFLICT");
      await rejectsCode(() => repository.recordCompletion({ ...input, idempotencyKey: "new", payload: { focus: 1 } }), "IDEMPOTENCY_CONFLICT");
      assert.equal((await pool.query("SELECT completion_revision FROM learning_plans WHERE id=$1", [plan.planId])).rows[0].completion_revision, 1);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_completion_keys WHERE plan_id=$1", [plan.planId])).rows[0].count, 2);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_completions WHERE plan_id=$1", [plan.planId])).rows[0].count, 1);
    });

    await suite.test("동시 최초 완료도 한 번만 기록하고 수락한 재시도 키를 모두 보존한다", async () => {
      const f = await fixture(); const plan = await confirm(f);
      const results = await Promise.all(["first", "second"].map((idempotencyKey) => repository.recordCompletion({
        studentId: f.studentId, planId: plan.planId, itemKey: f.candidate.items[0].itemKey, idempotencyKey, payload: { done: true },
      })));
      assert.equal(results.filter(({ replayed }) => replayed).length, 1);
      assert.deepEqual(results[0].completion, results[1].completion);
      assert.equal((await pool.query("SELECT completion_revision FROM learning_plans WHERE id=$1", [plan.planId])).rows[0].completion_revision, 1);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_completion_keys WHERE plan_id=$1", [plan.planId])).rows[0].count, 2);
    });

    await suite.test("완료 revision 변화는 제안 저장/확정을 차단하고 새 버전은 완료를 보존한다", async () => {
      const f = await fixture(); const plan = await confirm(f); const pending = await revised(f);
      const recorded = await repository.recordCompletion({ studentId: f.studentId, planId: plan.planId,
        itemKey: f.candidate.items[0].itemKey, idempotencyKey: "complete", payload: { done: true } });
      await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId, proposalId: pending.proposalId, expectedBasis: pending.expectedBasis }), "BASIS_CONFLICT");
      await rejectsCode(() => f.propose("rebalance", pending.expectedBasis), "BASIS_CONFLICT");
      const next = await revised(f);
      const result = await repository.confirmProposal({ studentId: f.studentId, proposalId: next.proposalId, expectedBasis: next.expectedBasis });
      const queried = await repository.readPlan({ studentId: f.studentId });
      assert.equal(result.version.candidate.assignments.length, 125);
      assert.deepEqual(queried?.completions, [recorded.completion]);
      const previous = await repository.readPlan({ studentId: f.studentId, versionId: plan.version.versionId });
      assert.equal(previous?.assignments.length, 126);
      assert.deepEqual(previous?.version, plan.version);
      assert.deepEqual(previous?.completions, [recorded.completion]);
    });

    await suite.test("plan revision 변화는 다른 제안 확정에도 충돌한다", async () => {
      const f = await fixture(); await confirm(f);
      const [p, other] = await Promise.all([revised(f), revised(f)]);
      await repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis });
      await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId, proposalId: other.proposalId, expectedBasis: other.expectedBasis }), "BASIS_CONFLICT");
    });

    await suite.test("후보 선택 카탈로그 basis는 이전 version hash와 구분하고 제외된 과거 완료를 보존한다", async () => {
      const f = await fixture(); const original = await confirm(f);
      const selected = selections[0];
      const removedItem = f.candidate.items.find(({ courseId }) => courseId !== selected.courseId)!;
      const recorded = await repository.recordCompletion({ studentId: f.studentId, planId: original.planId,
        itemKey: removedItem.itemKey, idempotencyKey: "past", payload: { retained: true } });
      const read = await repository.readBasis({ studentId: f.studentId, selections: [selected] });
      assert.notEqual(read.basis.catalogHash, original.version.catalogHash);
      const value = structuredClone(f.candidate);
      value.catalogSnapshot = read.catalogSnapshot;
      value.items = value.items.filter(({ courseId }) => courseId === selected.courseId);
      value.assignments = value.assignments.filter(({ courseId }) => courseId === selected.courseId);
      value.excludedItems = value.excludedItems.filter(({ courseId }) => courseId === selected.courseId);
      // 호출자가 검증한 선택 변경의 저장만 확인한다. 제품의 제거 정책은 결정하지 않는다.
      const p = await f.propose("rebalance", read.basis, value);
      const result = await repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis });
      assert.equal(result.version.catalogHash, read.basis.catalogHash);
      const queried = await repository.readPlan({ studentId: f.studentId });
      assert.deepEqual(queried?.completions, [recorded.completion]);
      assert.ok(!queried?.version.candidate.items.some(({ itemKey }) => itemKey === removedItem.itemKey));
    });

    await suite.test("학생·계획·항목을 격리하고 DB composite FK도 교차 버전을 거부한다", async () => {
      const [a, b] = await Promise.all([fixture(), fixture()]);
      const [pa, pb] = await Promise.all([confirm(a), confirm(b)]);
      await rejectsCode(() => repository.readBasis({ studentId: b.studentId, planId: pa.planId, selections }), "NOT_FOUND");
      await rejectsCode(() => repository.recordCompletion({ studentId: b.studentId, planId: pa.planId,
        itemKey: a.candidate.items[0].itemKey, idempotencyKey: "same", payload: {} }), "NOT_FOUND");
      const foreignProposal = await revised(a);
      await rejectsCode(() => repository.confirmProposal({ studentId: b.studentId, proposalId: foreignProposal.proposalId, expectedBasis: foreignProposal.expectedBasis }), "NOT_FOUND");
      await rejectsCode(() => repository.readPlan({ studentId: a.studentId, versionId: pb.version.versionId }), "NOT_FOUND");
      await Promise.all([a, b].map((f, index) => repository.recordCompletion({ studentId: f.studentId,
        planId: index === 0 ? pa.planId : pb.planId, itemKey: f.candidate.items[0].itemKey, idempotencyKey: "same", payload: {} })));
      await assert.rejects(pool.query("UPDATE learning_plans SET current_version_id=$2 WHERE id=$1", [pa.planId, pb.version.versionId]), { code: "23503" });
      await assert.rejects(pool.query(`INSERT INTO learning_plan_assignments(plan_id,version_id,item_key,scheduled_date,item_order,duration_seconds)
        VALUES($1,$2,$3,'2041-01-01',0,1)`, [pa.planId, pb.version.versionId, a.candidate.items[0].itemKey]), { code: "23503" });
    });

    await suite.test("DB 기준30분 만료는 반복 요청에서도 같은 사유와 상태를 남긴다", async () => {
      const f = await fixture(); const p = await f.propose();
      await pool.query(`UPDATE learning_plan_proposals SET created_at=clock_timestamp()-interval '31 minutes',
        expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [p.proposalId]);
      for (let retry = 0; retry < 2; retry += 1) await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId,
        proposalId: p.proposalId, expectedBasis: p.expectedBasis }), "PROPOSAL_EXPIRED");
      assert.equal((await pool.query("SELECT status FROM learning_plan_proposals WHERE id=$1", [p.proposalId])).rows[0].status, "expired");
      assert.equal(await repository.readPlan({ studentId: f.studentId }), undefined);
    });

    await suite.test("카탈로그 metadata 변화는 저장/확정을 차단하고 과거 snapshot은 유지한다", async () => {
      const f = await fixture(); const plan = await confirm(f); const p = await revised(f);
      const firstLesson = f.read.catalogSnapshot[0].catalog.lessons[0];
      try {
        await pool.query("UPDATE lessons SET title=$2 WHERE id=$1", [firstLesson.id, `${firstLesson.title} 검증 변경`]);
        await rejectsCode(() => f.propose("rebalance", p.expectedBasis), "CATALOG_CONFLICT");
        await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis }), "CATALOG_CONFLICT");
        const queried = await repository.readPlan({ studentId: f.studentId });
        assert.deepEqual(queried?.version.candidate.catalogSnapshot, plan.version.candidate.catalogSnapshot);
      } finally { await pool.query("UPDATE lessons SET title=$2 WHERE id=$1", [firstLesson.id, firstLesson.title]); }
    });

    await suite.test("저장 중 만료도 부분 버전을 남기지 않고 expired만 기록한다", async () => {
      const f = await fixture(); const p = await f.propose();
      const name = `test_delay_assignment_${randomUUID().replaceAll("-", "")}`;
      assert.match(p.targetPlanId, /^[a-f0-9-]+$/);
      await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.plan_id='${p.targetPlanId}' AND NEW.scheduled_date='2040-01-01'::date THEN
          PERFORM pg_sleep(0.3); END IF; RETURN NEW; END $$`);
      try {
        await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON learning_plan_assignments FOR EACH ROW EXECUTE FUNCTION ${name}()`);
        await pool.query(`UPDATE learning_plan_proposals SET created_at=clock_timestamp()-interval '29 minutes',
          expires_at=clock_timestamp()+interval '0.2 seconds' WHERE id=$1`, [p.proposalId]);
        await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis }), "PROPOSAL_EXPIRED");
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plans WHERE student_id=$1", [f.studentId])).rows[0].count, 0);
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_versions WHERE plan_id=$1", [p.targetPlanId])).rows[0].count, 0);
        assert.equal((await pool.query("SELECT status FROM learning_plan_proposals WHERE id=$1", [p.proposalId])).rows[0].status, "expired");
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON learning_plan_assignments`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
    });

    await suite.test("최초 생성/기존 버전의 중간 저장 실패는 전체 롤백한다", async () => {
      const f = await fixture(); const p = await f.propose();
      const suffix = randomUUID().replaceAll("-", "");
      const functionName = `test_fail_assignment_${suffix}`;
      const triggerName = `test_fail_assignment_${suffix}`;
      assert.match(p.targetPlanId, /^[a-f0-9-]+$/);
      async function inject() {
        await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.plan_id='${p.targetPlanId}' AND NEW.scheduled_date='2040-01-02'::date THEN
            RAISE EXCEPTION '검증용 중간 저장 실패'; END IF; RETURN NEW; END $$`);
        await pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON learning_plan_assignments FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      }
      async function remove() {
        await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON learning_plan_assignments`);
        await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }
      await inject();
      try {
        await assert.rejects(repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis }));
        for (const table of ["learning_plans", "learning_plan_versions", "learning_plan_items", "learning_plan_assignments"]) {
          const column = table === "learning_plans" ? "id" : "plan_id";
          assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column}=$1`, [p.targetPlanId])).rows[0].count, 0);
        }
        assert.equal((await pool.query("SELECT status FROM learning_plan_proposals WHERE id=$1", [p.proposalId])).rows[0].status, "pending");
      } finally { await remove(); }
      const initial = await repository.confirmProposal({ studentId: f.studentId, proposalId: p.proposalId, expectedBasis: p.expectedBasis });
      const recorded = await repository.recordCompletion({ studentId: f.studentId, planId: initial.planId,
        itemKey: f.candidate.items[0].itemKey, idempotencyKey: "before-failure", payload: { unchanged: true } });
      const next = await revised(f); await inject();
      try {
        await assert.rejects(repository.confirmProposal({ studentId: f.studentId, proposalId: next.proposalId, expectedBasis: next.expectedBasis }));
        assert.deepEqual((await repository.readPlan({ studentId: f.studentId }))?.version, initial.version);
        assert.equal((await pool.query("SELECT plan_revision FROM learning_plans WHERE id=$1", [initial.planId])).rows[0].plan_revision, 1);
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_versions WHERE plan_id=$1", [initial.planId])).rows[0].count, 1);
        assert.deepEqual((await repository.readPlan({ studentId: f.studentId }))?.completions, [recorded.completion]);
      } finally { await remove(); }
    });

    await suite.test("후보의 날짜·초·항목 귀속·커버리지 변조는 저장 전에 거부한다", async () => {
      const f = await fixture();
      for (const mutate of [
        (c: LearningPlanCandidate) => { c.assignments[0].durationSeconds -= 1; },
        (c: LearningPlanCandidate) => { c.assignments[0].date = "2040-02-30"; },
        (c: LearningPlanCandidate) => { c.assignments[0].itemKey = "없는 key"; },
        (c: LearningPlanCandidate) => { c.assignments.pop(); },
        (c: LearningPlanCandidate) => { c.items[0].subjectCode = "다른 과목"; },
        (c: LearningPlanCandidate) => { c.normalizedDays[0] = null as unknown as LearningPlanCandidate["normalizedDays"][number]; },
        (c: LearningPlanCandidate) => { c.items[0] = null as unknown as LearningPlanCandidate["items"][number]; },
      ]) { const copy = structuredClone(f.candidate); mutate(copy); await rejectsCode(() => f.propose("create", f.read.basis, copy), "INVALID_CANDIDATE"); }
      const plan = await confirm(f); const read = await repository.readBasis({ studentId: f.studentId, selections });
      const changed = structuredClone(f.candidate);
      const key = changed.items[0].itemKey; changed.items[0].itemKey = changed.items[1].itemKey; changed.items[1].itemKey = key;
      await rejectsCode(() => f.propose("rebalance", read.basis, changed), "INVALID_CANDIDATE");
      const newPool = new Pool({ connectionString: connection, options: "-c TimeZone=Pacific/Kiritimati" });
      try {
        const reopened = createPostgresLearningPlanRepository(newPool);
        const recovered = await reopened.readPlan({ studentId: f.studentId });
        assert.deepEqual(recovered?.version, plan.version);
        assert.deepEqual(recovered?.assignments, f.candidate.assignments);
      } finally { await newPool.end(); }
      // 별도 연결/repository 복구만 검사했다. 실제 HTTP 서버 프로세스 재시작은 통합 단계다.
    });

    for (const expected of originalCatalogs) assert.deepEqual(await catalog.getCourseCatalog(expected!.course.id), expected);
  } finally {
    // 이 실행이 만든 무작위 학생의 행만 정리한다. 실제/기존 fixture는 건드리지 않는다.
    for (const studentId of students) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ids = (await client.query("SELECT id FROM learning_plans WHERE student_id=$1", [studentId])).rows.map(({ id }) => id);
        await client.query("DELETE FROM learning_plan_proposals WHERE student_id=$1", [studentId]);
        await client.query("UPDATE learning_plans SET current_version_id=NULL WHERE student_id=$1", [studentId]);
        for (const table of ["learning_plan_completion_keys", "learning_plan_completions", "learning_plan_assignments", "learning_plan_items", "learning_plan_versions"]) {
          await client.query(`DELETE FROM ${table} WHERE plan_id=ANY($1::varchar[])`, [ids]);
        }
        await client.query("DELETE FROM learning_plans WHERE student_id=$1", [studentId]);
        await client.query("DELETE FROM students WHERE id=$1", [studentId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await pool.end();
  }
});

function makeCandidate(read: LearningPlanReadBasisResult): LearningPlanCandidate {
  const items = read.catalogSnapshot.flatMap(({ subjectCode, catalog }) => catalog.lessons
    .filter(({ lessonType }) => lessonType !== "orientation").map((lesson) => ({ itemKey: randomUUID(), lessonId: lesson.id,
      subjectCode, courseId: lesson.courseId, sequence: lesson.sequence, durationSeconds: lesson.duration.seconds, lessonType: lesson.lessonType })));
  const excludedItems = read.catalogSnapshot.flatMap(({ subjectCode, catalog }) => catalog.lessons
    .filter(({ lessonType }) => lessonType === "orientation").map((lesson) => ({ lessonId: lesson.id, subjectCode,
      courseId: lesson.courseId, sequence: lesson.sequence, durationSeconds: lesson.duration.seconds,
      lessonType: lesson.lessonType, reason: "lesson-type-excluded" as const })));
  // 저장 경계만 검사하는 fixture다. 제품의 배치/날짜·가용 시간 정책을 구현한 것이 아니다.
  const assignments = items.map((item, index) => ({ itemKey: item.itemKey, lessonId: item.lessonId,
    subjectCode: item.subjectCode, courseId: item.courseId, durationSeconds: item.durationSeconds,
    date: new Date(Date.UTC(2040, 0, 1 + index)).toISOString().slice(0, 10), order: 0 }));
  return { items, assignments, normalizedDays: assignments.map(({ date, durationSeconds }) => ({ date, capacitySeconds: durationSeconds })),
    conditions: { fixture: true }, catalogSnapshot: read.catalogSnapshot, excludedItems };
}
async function rejectsCode(action: () => Promise<unknown>, code: LearningPlanRepositoryErrorCode) {
  await assert.rejects(action, (error: unknown) => error instanceof LearningPlanRepositoryError && error.code === code);
}
