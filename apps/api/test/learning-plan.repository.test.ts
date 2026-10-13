import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
      "0008_learning_plan_segments_and_progress.sql",
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
      value.progressSnapshot = executionSnapshot(read);
      return f.propose("rebalance", read.basis, value);
    }
    async function finish(f: Awaited<ReturnType<typeof fixture>>, planId: string, itemKey = f.candidate.items[0].itemKey) {
      const item = f.candidate.items.find((item) => item.itemKey === itemKey)!;
      return repository.recordProgress({ studentId: f.studentId, planId, itemKey,
        idempotencyKey: `fixture-finish:${itemKey}`, positionSeconds: item.durationSeconds, spentSeconds: item.durationSeconds });
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
        `SELECT a.item_key,a.scheduled_date::text AS date,a.item_order,a.duration_seconds,i.lesson_id,i.subject_code,l.course_id,
          a.segment_key,a.start_offset_seconds,a.end_offset_seconds
         FROM learning_plan_assignments a JOIN learning_plan_items i USING(plan_id,item_key)
         JOIN lessons l ON l.id=i.lesson_id WHERE a.plan_id=$1 ORDER BY a.scheduled_date,a.item_order`, [result.planId],
      )).rows;
      assert.equal(rows.length, 126);
      assert.equal(rows.reduce((sum, row) => sum + row.duration_seconds, 0), 419939);
      assert.deepEqual(rows.map((row) => ({ itemKey: row.item_key, lessonId: row.lesson_id, subjectCode: row.subject_code,
        courseId: row.course_id, date: row.date, order: row.item_order, durationSeconds: row.duration_seconds,
        segmentKey: row.segment_key, startOffsetSeconds: row.start_offset_seconds, endOffsetSeconds: row.end_offset_seconds })), f.candidate.assignments);
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
      await finish(f, plan.planId);
      const input = { studentId: f.studentId, planId: plan.planId, itemKey: f.candidate.items[0].itemKey,
        idempotencyKey: "initial", payload: { focus: 4, nested: { understood: true } } };
      const first = await repository.recordCompletion(input);
      const replay = await repository.recordCompletion({ ...input, idempotencyKey: "alias", payload: { nested: { understood: true }, focus: 4 } });
      assert.deepEqual(replay, { ...first, replayed: true });
      assert.deepEqual(await repository.recordCompletion(input), { ...first, replayed: true });
      await rejectsCode(() => repository.recordCompletion({ ...input, idempotencyKey: "alias", itemKey: f.candidate.items[1].itemKey }), "IDEMPOTENCY_CONFLICT");
      await rejectsCode(() => repository.recordCompletion({ ...input, idempotencyKey: "new", payload: { focus: 1 } }), "IDEMPOTENCY_CONFLICT");
      assert.equal((await pool.query("SELECT completion_revision FROM learning_plans WHERE id=$1", [plan.planId])).rows[0].completion_revision, 2);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_completion_keys WHERE plan_id=$1", [plan.planId])).rows[0].count, 2);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_completions WHERE plan_id=$1", [plan.planId])).rows[0].count, 1);
    });

    await suite.test("동시 최초 완료도 한 번만 기록하고 수락한 재시도 키를 모두 보존한다", async () => {
      const f = await fixture(); const plan = await confirm(f);
      await finish(f, plan.planId);
      const results = await Promise.all(["first", "second"].map((idempotencyKey) => repository.recordCompletion({
        studentId: f.studentId, planId: plan.planId, itemKey: f.candidate.items[0].itemKey, idempotencyKey, payload: { done: true },
      })));
      assert.equal(results.filter(({ replayed }) => replayed).length, 1);
      assert.deepEqual(results[0].completion, results[1].completion);
      assert.equal((await pool.query("SELECT completion_revision FROM learning_plans WHERE id=$1", [plan.planId])).rows[0].completion_revision, 2);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_completion_keys WHERE plan_id=$1", [plan.planId])).rows[0].count, 2);
    });

    await suite.test("완료 revision 변화는 제안 저장/확정을 차단하고 새 버전은 완료를 보존한다", async () => {
      const f = await fixture(); const plan = await confirm(f); const pending = await revised(f);
      await finish(f, plan.planId);
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
      await finish(f, original.planId, removedItem.itemKey);
      const recorded = await repository.recordCompletion({ studentId: f.studentId, planId: original.planId,
        itemKey: removedItem.itemKey, idempotencyKey: "past", payload: { retained: true } });
      const read = await repository.readBasis({ studentId: f.studentId, selections: [selected] });
      assert.notEqual(read.basis.catalogHash, original.version.catalogHash);
      const value = structuredClone(f.candidate);
      value.catalogSnapshot = read.catalogSnapshot;
      value.progressSnapshot = executionSnapshot(read);
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
      await Promise.all([finish(a, pa.planId), finish(b, pb.planId)]);
      await Promise.all([a, b].map((f, index) => repository.recordCompletion({ studentId: f.studentId,
        planId: index === 0 ? pa.planId : pb.planId, itemKey: f.candidate.items[0].itemKey, idempotencyKey: "same", payload: {} })));
      await assert.rejects(pool.query("UPDATE learning_plans SET current_version_id=$2 WHERE id=$1", [pa.planId, pb.version.versionId]), { code: "23503" });
      await assert.rejects(pool.query(`INSERT INTO learning_plan_assignments(plan_id,version_id,item_key,scheduled_date,item_order,duration_seconds,segment_key,start_offset_seconds,end_offset_seconds)
        VALUES($1,$2,$3,'2041-01-01',0,1,'cross-plan',0,1)`, [pa.planId, pb.version.versionId, a.candidate.items[0].itemKey]), { code: "23503" });
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
      await finish(f, initial.planId);
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

    await suite.test("긴 실제 강의의 이어보기와 35분 실제 진도를 분리하고 과거 버전은 보존한다", async () => {
      const f = await fixture();
      const split = segmentedCandidate(f.read, f.candidate, "2040-01-01", 3000);
      const target = split.items.find(({ durationSeconds }) => durationSeconds > 4200)!;
      assert.ok(target);
      const proposed = await f.propose("create", f.read.basis, split);
      const initial = await repository.confirmProposal({ studentId: f.studentId, proposalId: proposed.proposalId, expectedBasis: proposed.expectedBasis });
      const scheduled = initial.version.candidate.assignments.filter(({ itemKey }) => itemKey === target.itemKey);
      assert.equal(scheduled[0].durationSeconds, 3000);
      assert.ok(scheduled.length > 1);
      assert.equal(new Set(scheduled.map(({ lessonId }) => lessonId)).size, 1);
      const staleRead = await repository.readBasis({ studentId: f.studentId, selections });
      const stale = await f.propose("rebalance", staleRead.basis, segmentedCandidate(staleRead, split));
      const input = { studentId: f.studentId, planId: initial.planId, itemKey: target.itemKey,
        idempotencyKey: "actual-35-minutes", positionSeconds: 2100, spentSeconds: 2100 };
      const event = await repository.recordProgress(input);
      assert.equal(event.completion, null);
      assert.equal(event.progress.positionSeconds, 2100);
      await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId, proposalId: stale.proposalId, expectedBasis: stale.expectedBasis }), "BASIS_CONFLICT");
      const current = await repository.readBasis({ studentId: f.studentId, selections });
      const remaining = segmentedCandidate(current, split);
      assert.equal(remaining.assignments.filter(({ itemKey }) => itemKey === target.itemKey).reduce((sum, row) => sum + row.durationSeconds, 0), target.durationSeconds - 2100);
      for (const change of [-1, 1]) {
        const invalid = structuredClone(remaining);
        const first = invalid.assignments.find(({ itemKey }) => itemKey === target.itemKey)!;
        first.startOffsetSeconds += change; first.durationSeconds -= change;
        await rejectsCode(() => f.propose("rebalance", current.basis, invalid), "INVALID_CANDIDATE");
      }
      const next = await f.propose("rebalance", current.basis, remaining);
      await repository.confirmProposal({ studentId: f.studentId, proposalId: next.proposalId, expectedBasis: next.expectedBasis });
      const reopenedPool = new Pool({ connectionString: connection, options: "-c TimeZone=Pacific/Kiritimati" });
      try {
        const reopened = createPostgresLearningPlanRepository(reopenedPool);
        const actual = await repository.readPlan({ studentId: f.studentId });
        assert.deepEqual(await reopened.readPlan({ studentId: f.studentId }), actual);
        const past = await reopened.readPlan({ studentId: f.studentId, versionId: initial.version.versionId });
        assert.deepEqual(past?.version, initial.version);
        assert.equal(past?.progress.find(({ itemKey }) => itemKey === target.itemKey)?.positionSeconds, 2100);
        assert.equal(past?.version.candidate.progressSnapshot?.progress.length, 0);
      } finally { await reopenedPool.end(); }
    });

    await suite.test("진도 event의 동시 재시도·역행·재수강 시간·키 namespace를 검증한다", async () => {
      const f = await fixture(); const plan = await confirm(f); const item = f.candidate.items[0];
      const input = { studentId: f.studentId, planId: plan.planId, itemKey: item.itemKey,
        idempotencyKey: "same-key", positionSeconds: 35, spentSeconds: 80 };
      const events = await Promise.all([repository.recordProgress(input), repository.recordProgress(input)]);
      const first = events.find(({ replayed }) => !replayed)!;
      assert.equal(events.filter(({ replayed }) => replayed).length, 1);
      assert.deepEqual(events.find(({ replayed }) => replayed), { ...first, replayed: true });
      await rejectsCode(() => repository.recordProgress({ ...input, spentSeconds: 81 }), "IDEMPOTENCY_CONFLICT");
      await rejectsCode(() => repository.recordProgress({ ...input, idempotencyKey: "regress", positionSeconds: 34 }), "BASIS_CONFLICT");
      await rejectsCode(() => repository.recordProgress({ ...input, idempotencyKey: "overflow", positionSeconds: item.durationSeconds + 1 }), "INVALID_CANDIDATE");
      await rejectsCode(() => repository.recordProgress({ ...input, idempotencyKey: "noop", spentSeconds: 0 }), "INVALID_STATE");
      await rejectsCode(() => repository.recordCompletion({ studentId: f.studentId, planId: plan.planId,
        itemKey: item.itemKey, idempotencyKey: "premature", payload: {} }), "INVALID_STATE");
      for (const spentSeconds of [-1, 0.5, 86401]) await rejectsCode(() => repository.recordProgress({ ...input,
        idempotencyKey: "invalid-seconds", spentSeconds }), "INVALID_CANDIDATE");
      const rewatch = await repository.recordProgress({ ...input, idempotencyKey: "rewatch", spentSeconds: 20 });
      assert.equal(rewatch.progress.positionSeconds, 35);
      const ending = await repository.recordProgress({ ...input, idempotencyKey: "end", positionSeconds: item.durationSeconds, spentSeconds: 0 });
      assert.equal(ending.completion?.payload, null);
      const feedback = await repository.recordCompletion({ studentId: f.studentId, planId: plan.planId,
        itemKey: item.itemKey, idempotencyKey: input.idempotencyKey, payload: {} });
      assert.deepEqual(feedback.completion.payload, {});
      assert.equal(feedback.completion.completedAt, ending.completion?.completedAt);
      assert.equal(feedback.completion.completionRevision, ending.completion?.completionRevision);
      assert.equal(feedback.completion.feedbackRevision, 4);
      assert.deepEqual(await repository.recordProgress(input), { ...first, replayed: true });
      const read = await repository.readPlan({ studentId: f.studentId });
      assert.equal(read?.plan.completionRevision, 4);
      assert.deepEqual(read?.dailyUsage, [{ studyDate: first.event.studyDate, spentSeconds: 100 }]);
      const sql = (await pool.query(`SELECT count(*)::int AS count,sum(spent_seconds)::int AS spent,
        bool_and(study_date=(created_at AT TIME ZONE 'Asia/Seoul')::date) AS seoul FROM learning_plan_progress_events WHERE plan_id=$1`, [plan.planId])).rows[0];
      assert.deepEqual(sql, { count: 3, spent: 100, seoul: true });
      const stranger = await fixture();
      await rejectsCode(() => repository.recordProgress({ ...input, studentId: stranger.studentId }), "NOT_FOUND");
    });

    await suite.test("실제 종료와 optional feedback은 한 revision이며 첫 별도 feedback이 과거 제안을 막는다", async () => {
      const f = await fixture(); const plan = await confirm(f); const item = f.candidate.items[0];
      const input = { studentId: f.studentId, planId: plan.planId, itemKey: item.itemKey,
        idempotencyKey: "end-and-feedback", positionSeconds: item.durationSeconds, spentSeconds: 21, feedback: { focus: 4 } };
      const first = await repository.recordProgress(input);
      assert.equal(first.completionRevision, 1);
      assert.equal(first.completion?.feedbackRevision, 1);
      assert.deepEqual(await repository.recordProgress(input), { ...first, replayed: true });
      const before = await repository.readPlan({ studentId: f.studentId });
      await rejectsCode(() => repository.recordProgress({ ...input, idempotencyKey: "conflict", spentSeconds: 10, feedback: { focus: 1 } }), "IDEMPOTENCY_CONFLICT");
      assert.deepEqual(await repository.readPlan({ studentId: f.studentId }), before);
      const secondItem = f.candidate.items[1];
      await repository.recordProgress({ ...input, itemKey: secondItem.itemKey, idempotencyKey: "second-end",
        positionSeconds: secondItem.durationSeconds, spentSeconds: 3, feedback: undefined });
      const stale = await revised(f);
      const feedback = { studentId: f.studentId, planId: plan.planId, itemKey: secondItem.itemKey, idempotencyKey: "late", payload: {} };
      await repository.recordCompletion(feedback);
      await rejectsCode(() => repository.confirmProposal({ studentId: f.studentId, proposalId: stale.proposalId, expectedBasis: stale.expectedBasis }), "BASIS_CONFLICT");
      const after = await repository.readPlan({ studentId: f.studentId });
      await repository.recordCompletion(feedback);
      assert.deepEqual(await repository.readPlan({ studentId: f.studentId }), after);
      assert.equal(after?.dailyUsage[0].spentSeconds, 24);
    });

    await suite.test("당일 총한도는 실제 시간을 한 번 차감하며 제외한 과목의 시간도 남는다", async () => {
      const f = await fixture(); const plan = await confirm(f); const item = f.candidate.items[0];
      const event = await repository.recordProgress({ studentId: f.studentId, planId: plan.planId,
        itemKey: item.itemKey, idempotencyKey: "today", positionSeconds: 35, spentSeconds: 80 });
      const read = await repository.readBasis({ studentId: f.studentId, selections });
      const today = event.event.studyDate;
      const candidate = segmentedCandidate(read, f.candidate, today);
      candidate.normalizedDays[0].capacitySeconds += 80;
      const saved = await f.propose("rebalance", read.basis, candidate);
      assert.deepEqual((await repository.readPlan({ studentId: f.studentId }))?.dailyUsage, read.dailyUsage);
      const over = structuredClone(candidate); over.normalizedDays[0].capacitySeconds -= 1;
      await rejectsCode(() => f.propose("rebalance", read.basis, over), "INVALID_CANDIDATE");
      const fake = structuredClone(candidate); fake.progressSnapshot!.dailyUsage[0].spentSeconds = 0;
      await rejectsCode(() => f.propose("rebalance", read.basis, fake), "BASIS_CONFLICT");
      await repository.confirmProposal({ studentId: f.studentId, proposalId: saved.proposalId, expectedBasis: saved.expectedBasis });
      const updated = await repository.readBasis({ studentId: f.studentId, selections });
      const noToday = segmentedCandidate(updated, candidate, shiftDate(today, 1));
      noToday.normalizedDays.unshift({ date: today, capacitySeconds: 20 });
      await f.propose("rebalance", updated.basis, noToday);
      const subsetSelections = selections.filter(({ courseId }) => courseId !== item.courseId);
      const subsetRead = await repository.readBasis({ studentId: f.studentId, selections: subsetSelections });
      const subset = structuredClone(candidate);
      subset.items = subset.items.filter(({ courseId }) => courseId !== item.courseId);
      subset.catalogSnapshot = subsetRead.catalogSnapshot;
      subset.excludedItems = subset.excludedItems.filter(({ courseId }) => courseId !== item.courseId);
      const remaining = segmentedCandidate(subsetRead, subset, shiftDate(today, 1));
      const removal = await f.propose("rebalance", subsetRead.basis, remaining);
      await repository.confirmProposal({ studentId: f.studentId, proposalId: removal.proposalId, expectedBasis: removal.expectedBasis });
      const removed = await repository.readPlan({ studentId: f.studentId });
      assert.deepEqual(removed?.dailyUsage, read.dailyUsage);
      assert.equal(removed?.historicalItems.length, 126);
      assert.equal(removed?.progress.find(({ itemKey }) => itemKey === item.itemKey)?.positionSeconds, 35);
      assert.deepEqual(await repository.recordProgress({ studentId: f.studentId, planId: plan.planId, itemKey: item.itemKey,
        idempotencyKey: "today", positionSeconds: 35, spentSeconds: 80 }), { ...event, replayed: true });
      await rejectsCode(() => repository.recordProgress({ studentId: f.studentId, planId: plan.planId,
        itemKey: item.itemKey, idempotencyKey: "after-removal", positionSeconds: 36, spentSeconds: 1 }), "NOT_FOUND");
    });

    await suite.test("이월 후보는 확정 전 불변이며 최초 미완료 구간 날짜를 보존한다", async () => {
      const f = await fixture();
      const today = (await pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS date")).rows[0].date as string;
      const past = segmentedCandidate(f.read, f.candidate, shiftDate(today, -200), 3000);
      const item = past.items[0];
      const firstDate = past.assignments[0].date;
      const initial = await f.propose("create", f.read.basis, past);
      const plan = await repository.confirmProposal({ studentId: f.studentId, proposalId: initial.proposalId, expectedBasis: initial.expectedBasis });
      await repository.recordProgress({ studentId: f.studentId, planId: plan.planId, itemKey: item.itemKey,
        idempotencyKey: "carryover-partial", positionSeconds: 100, spentSeconds: 110 });
      const read = await repository.readBasis({ studentId: f.studentId, selections });
      const next = segmentedCandidate(read, past);
      next.carryoverCandidates = [{ itemKey: item.itemKey, carryoverSinceDate: firstDate }];
      next.items[0].carryoverSinceDate = firstDate;
      const invalid = structuredClone(next); invalid.carryoverCandidates[0].carryoverSinceDate = shiftDate(firstDate, 1);
      await rejectsCode(() => f.propose("rebalance", read.basis, invalid), "INVALID_CANDIDATE");
      const saved = await f.propose("rebalance", read.basis, next);
      assert.equal((await repository.readPlan({ studentId: f.studentId }))?.progress.find(({ itemKey }) => itemKey === item.itemKey)?.carryoverSinceDate, null);
      const name = `test_fail_carryover_${randomUUID().replaceAll("-", "")}`;
      assert.match(plan.planId, /^[a-f0-9-]+$/);
      await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.plan_id='${plan.planId}' THEN RAISE EXCEPTION '검증용 이월 저장 실패'; END IF; RETURN NEW; END $$`);
      try {
        await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON learning_plan_assignments FOR EACH ROW EXECUTE FUNCTION ${name}()`);
        const before = await repository.readPlan({ studentId: f.studentId });
        await assert.rejects(repository.confirmProposal({ studentId: f.studentId, proposalId: saved.proposalId, expectedBasis: saved.expectedBasis }));
        assert.deepEqual(await repository.readPlan({ studentId: f.studentId }), before);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON learning_plan_assignments`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
      await repository.confirmProposal({ studentId: f.studentId, proposalId: saved.proposalId, expectedBasis: saved.expectedBasis });
      const current = await repository.readBasis({ studentId: f.studentId, selections });
      const again = segmentedCandidate(current, next);
      assert.equal(again.items[0].carryoverSinceDate, firstDate);
      for (const date of [null, shiftDate(firstDate, 1)]) {
        const reset = structuredClone(again); reset.items[0].carryoverSinceDate = date;
        await rejectsCode(() => f.propose("rebalance", current.basis, reset), "INVALID_CANDIDATE");
      }
      const another = await f.propose("rebalance", current.basis, again);
      await repository.confirmProposal({ studentId: f.studentId, proposalId: another.proposalId, expectedBasis: another.expectedBasis });
      const recoveredPool = new Pool({ connectionString: connection });
      try {
        const recovered = await createPostgresLearningPlanRepository(recoveredPool).readPlan({ studentId: f.studentId, versionId: plan.version.versionId });
        assert.equal(recovered?.progress.find(({ itemKey }) => itemKey === item.itemKey)?.carryoverSinceDate, firstDate);
        assert.deepEqual(recovered?.version, plan.version);
      } finally { await recoveredPool.end(); }
    });

    await suite.test("feedback 삽입 실패는 진도·시간·완료·revision을 전부 롤백한다", async () => {
      const f = await fixture(); const plan = await confirm(f); const item = f.candidate.items[0];
      const name = `test_fail_feedback_${randomUUID().replaceAll("-", "")}`;
      assert.match(plan.planId, /^[a-f0-9-]+$/);
      const before = await repository.readPlan({ studentId: f.studentId });
      await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.plan_id='${plan.planId}' THEN RAISE EXCEPTION '검증용 feedback 저장 실패'; END IF; RETURN NEW; END $$`);
      try {
        await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON learning_plan_feedbacks FOR EACH ROW EXECUTE FUNCTION ${name}()`);
        await assert.rejects(repository.recordProgress({ studentId: f.studentId, planId: plan.planId, itemKey: item.itemKey,
          idempotencyKey: "rollback", positionSeconds: item.durationSeconds, spentSeconds: 40, feedback: {} }));
        assert.deepEqual(await repository.readPlan({ studentId: f.studentId }), before);
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM learning_plan_progress_events WHERE plan_id=$1", [plan.planId])).rows[0].count, 0);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON learning_plan_feedbacks`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
      const event = await repository.recordProgress({ studentId: f.studentId, planId: plan.planId, itemKey: item.itemKey,
        idempotencyKey: "rollback", positionSeconds: item.durationSeconds, spentSeconds: 40, feedback: {} });
      assert.equal(event.completionRevision, 1);
      assert.deepEqual(event.completion?.payload, {});
    });

    await suite.test("데이터가 있는0007에서0008로 원본·완료 시각을 보존하며 이행한다", async () => {
      // 전용 DB 안의 무작위 schema만 대상으로 삼아 public과 기존 DB를 변경하지 않는다.
      const schema = `lp_migration_${randomUUID().replaceAll("-", "")}`;
      assert.match(schema, /^lp_migration_[a-f0-9]{32}$/);
      await pool.query(`CREATE SCHEMA ${schema}`);
      const scopedPool = new Pool({ connectionString: connection, options: `-c search_path=${schema}` });
      const client = await scopedPool.connect();
      try {
        for (const migration of ["0000_initial_schema.sql", "0001_student_curricula.sql", "0002_curriculum_read_model.sql", "0003_subject_enrollment_proposals.sql", "0007_learning_plans.sql"]) {
          await client.query(await readFile(new URL(`../src/db/migrations/${migration}`, import.meta.url), "utf8"));
        }
        await client.query("INSERT INTO courses SELECT * FROM public.courses");
        await client.query("INSERT INTO lessons SELECT * FROM public.lessons");
        const studentId = `migration-${randomUUID()}`; const planId = randomUUID(); const versionId = randomUUID();
        await client.query("INSERT INTO students(id,status,created_at,updated_at) VALUES($1,'active',now(),now())", [studentId]);
        const scopedRepository = createPostgresLearningPlanRepository(scopedPool);
        // 신규 진도 SELECT는0008을 요구하므로 미이행 schema에서 readBasis를 호출하지 않는다.
        const candidate = makeCandidate(await repository.readBasis({ studentId: (await fixture()).studentId, selections }));
        const { progressSnapshot: _, carryoverCandidates: __, ...legacy } = candidate;
        const legacyJson = { ...legacy, assignments: legacy.assignments.map(({ segmentKey: ___, startOffsetSeconds: ____, endOffsetSeconds: _____, ...whole }) => whole) };
        const item = candidate.items[0];
        await client.query("INSERT INTO learning_plans(id,student_id,created_at,updated_at) VALUES($1,$2,now(),now())", [planId, studentId]);
        await client.query(`INSERT INTO learning_plan_versions(id,plan_id,version_number,kind,scope_json,reason,diff_json,candidate_json,catalog_hash,created_at)
          VALUES($1,$2,1,'create','{}','이행 검증','{}',$3,$4,now())`, [versionId, planId, JSON.stringify(legacyJson), learningPlanCatalogHash(candidate.catalogSnapshot)]);
        for (const stored of candidate.items) await client.query("INSERT INTO learning_plan_items(plan_id,item_key,lesson_id,subject_code) VALUES($1,$2,$3,$4)", [planId, stored.itemKey, stored.lessonId, stored.subjectCode]);
        for (const assignment of candidate.assignments) await client.query(`INSERT INTO learning_plan_assignments(plan_id,version_id,item_key,scheduled_date,item_order,duration_seconds)
          VALUES($1,$2,$3,$4,0,$5)`, [planId, versionId, assignment.itemKey, assignment.date, assignment.durationSeconds]);
        await client.query("UPDATE learning_plans SET current_version_id=$2,plan_revision=1,completion_revision=1 WHERE id=$1", [planId, versionId]);
        await client.query(`INSERT INTO learning_plan_completions(plan_id,item_key,payload_json,completed_at,completion_revision)
          VALUES($1,$2,'{}','2025-01-01T01:02:03Z',1)`, [planId, item.itemKey]);
        await client.query("INSERT INTO learning_plan_completion_keys(plan_id,item_key,idempotency_key) VALUES($1,$2,'legacy')", [planId, item.itemKey]);
        const before = (await client.query("SELECT candidate_json::text AS raw FROM learning_plan_versions WHERE id=$1", [versionId])).rows[0].raw;
        // snapshot 누락이 있으면 현재 카탈로그로 채우지 않고 전체 migration을 실패시킨다.
        await client.query("INSERT INTO learning_plan_items(plan_id,item_key,lesson_id,subject_code) VALUES($1,'missing-snapshot',$2,$3)", [planId, item.lessonId, item.subjectCode]);
        await client.query("BEGIN");
        await assert.rejects(client.query(await readFile(new URL("../src/db/migrations/0008_learning_plan_segments_and_progress.sql", import.meta.url), "utf8")), { code: "23502" });
        await client.query("ROLLBACK");
        assert.equal((await client.query(`SELECT count(*)::int AS count FROM information_schema.columns
          WHERE table_schema=$1 AND table_name='learning_plan_assignments' AND column_name='segment_key'`, [schema])).rows[0].count, 0);
        await client.query("DELETE FROM learning_plan_items WHERE plan_id=$1 AND item_key='missing-snapshot'", [planId]);
        await client.query("BEGIN");
        await client.query(await readFile(new URL("../src/db/migrations/0008_learning_plan_segments_and_progress.sql", import.meta.url), "utf8"));
        await client.query("COMMIT");
        assert.equal((await client.query("SELECT candidate_json::text AS raw FROM learning_plan_versions WHERE id=$1", [versionId])).rows[0].raw, before);
        const migrated = await scopedRepository.readPlan({ studentId });
        assert.equal(migrated?.version.legacyNormalized, true);
        assert.equal(migrated?.version.candidate.progressSnapshot, null);
        assert.deepEqual(migrated?.dailyUsage, []);
        assert.equal(migrated?.assignments.length, 126);
        for (const row of migrated!.assignments) {
          assert.equal(row.segmentKey, row.itemKey); assert.equal(row.startOffsetSeconds, 0);
          assert.equal(row.endOffsetSeconds, row.durationSeconds);
        }
        assert.equal(migrated?.progress.find(({ itemKey }) => itemKey === item.itemKey)?.positionSeconds, item.durationSeconds);
        assert.equal(migrated?.completions[0].completedAt, "2025-01-01T01:02:03.000Z");
        assert.deepEqual(migrated?.completions[0].payload, {});
        assert.equal(migrated?.completions[0].feedbackRevision, 1);
        const replay = await scopedRepository.recordCompletion({ studentId, planId, itemKey: item.itemKey, idempotencyKey: "legacy", payload: {} });
        assert.equal(replay.replayed, true);
        assert.deepEqual(await scopedRepository.readPlan({ studentId }), migrated);
      } finally {
        await client.query("ROLLBACK"); client.release(); await scopedPool.end();
        // 위에서 검증한 이 실행 전용 schema만 정리한다. 실제 데이터와 public은 대상이 아니다.
        await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      }
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
        for (const table of ["learning_plan_progress_events", "learning_plan_completion_keys", "learning_plan_feedbacks", "learning_plan_completions", "learning_plan_assignments", "learning_plan_items", "learning_plan_versions"]) {
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
    segmentKey: randomUUID(), startOffsetSeconds: 0, endOffsetSeconds: item.durationSeconds,
    date: new Date(Date.UTC(2040, 0, 1 + index)).toISOString().slice(0, 10), order: 0 }));
  return { items, assignments, normalizedDays: assignments.map(({ date, durationSeconds }) => ({ date, capacitySeconds: durationSeconds })),
    conditions: { fixture: true }, catalogSnapshot: read.catalogSnapshot, excludedItems,
    progressSnapshot: executionSnapshot(read), carryoverCandidates: [] };
}
function executionSnapshot(read: LearningPlanReadBasisResult) {
  return { progress: read.progress.map(({ itemKey, positionSeconds }) => ({ itemKey, positionSeconds })), dailyUsage: read.dailyUsage };
}
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function segmentedCandidate(read: LearningPlanReadBasisResult, original: LearningPlanCandidate, start = "2040-01-01", limit = Number.MAX_SAFE_INTEGER): LearningPlanCandidate {
  const candidate = structuredClone(original);
  const execution = new Map(read.progress.map((item) => [item.itemKey, item]));
  candidate.items = candidate.items.map((item) => ({ ...item, carryoverSinceDate: execution.get(item.itemKey)?.carryoverSinceDate ?? null }));
  candidate.progressSnapshot = executionSnapshot(read); candidate.carryoverCandidates = [];
  candidate.assignments = []; candidate.normalizedDays = [];
  for (const item of candidate.items) {
    let position = execution.get(item.itemKey)?.positionSeconds ?? 0;
    while (position < item.durationSeconds) {
      const end = Math.min(item.durationSeconds, position + limit);
      const date = shiftDate(start, candidate.assignments.length);
      candidate.assignments.push({ itemKey: item.itemKey, lessonId: item.lessonId, courseId: item.courseId, subjectCode: item.subjectCode,
        segmentKey: randomUUID(), startOffsetSeconds: position, endOffsetSeconds: end, durationSeconds: end - position, date, order: 0 });
      candidate.normalizedDays.push({ date, capacitySeconds: end - position });
      position = end;
    }
  }
  return candidate;
}
async function rejectsCode(action: () => Promise<unknown>, code: LearningPlanRepositoryErrorCode) {
  await assert.rejects(action, (error: unknown) => error instanceof LearningPlanRepositoryError && error.code === code);
}
