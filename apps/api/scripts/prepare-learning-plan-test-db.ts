import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { createDatabaseClient } from "../src/db/client.js";
import { assertDedicatedTestDatabaseName, prepareLearningPlanCatalogFixture } from "../test/helpers/learning-plan-catalog-fixture.js";

// 저장소 루트의 별도 로컬 파일을 독점 생성한다. 기존 환경 파일을 덮어쓰지 않는다.
const root = new URL("../../../", import.meta.url);
const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const output = new URL(".env.learning-plan-test.local", root);
const expectedMigrations = [
  "0000_initial_schema.sql", "0001_student_curricula.sql",
  "0002_curriculum_read_model.sql", "0003_subject_enrollment_proposals.sql",
];
let stage = "안전 조건 확인";

try {
  assert.ok(process.argv.includes("--allow-create-test-database"), "전용 DB 생성 승인 인자가 필요합니다.");
  assert.equal(existsSync(output), false, "새 테스트 환경 파일이 이미 있습니다. 덮어쓰지 않습니다.");
  const migrationFiles = (await readdir(new URL("../src/db/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(migrationFiles, expectedMigrations, "준비 요청의 migration 범위와 현재 브랜치가 다릅니다.");
  const environment = readEnvironment(new URL(".env.db.local", root));
  assert.ok(environment.DATABASE_URL, "개발 환경의 접속 설정이 없습니다.");
  const sourceUrl = new URL(environment.DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(sourceUrl.hostname), "로컬 DB 서버만 준비 대상으로 허용합니다.");
  const name = `test_learning_plan_${randomUUID().replaceAll("-", "")}`;
  assertDedicatedTestDatabaseName(name, true);
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${name}`;
  assert.notEqual(targetUrl.pathname, sourceUrl.pathname);
  // 기존 검증 환경도 접속 대상이 동일하지 않음을 확인한다. 값은 출력하지 않는다.
  const priorFile = new URL(".env.verify.local", root);
  if (existsSync(priorFile)) {
    const prior = readEnvironment(priorFile).TEST_DATABASE_URL;
    if (prior) assert.notEqual(targetUrl.href, new URL(prior).href);
  }

  stage = "새 전용 DB 생성";
  const admin = new Pool({ connectionString: sourceUrl.href });
  try {
    const collision = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    assert.equal(collision.rowCount, 0, "같은 이름의 DB가 이미 존재합니다.");
    // 이름은 위에서 검증한 생성 문자열이다. 기존 DB에 대한 DROP/ALTER는 없다.
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  } finally {
    await admin.end();
  }
  stage = "별도 로컬 환경 파일 보관";
  await writeFile(output,
    `# 새 전체 일정 검증 전용 환경. 기존 환경과 분리하며 Git 추적 금지.\n` +
    `DATABASE_URL=${targetUrl.href}\nTEST_DATABASE_URL=${targetUrl.href}\n` +
    `VERIFY_TOOLS_ALLOW_TEST_DATABASE=1\nPERSISTENCE_MODE=postgres\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log("새 전용 테스트 DB 생성 및 별도 로컬 환경 파일 보관 완료");

  stage = "현재 브랜치 migration 적용";
  const migration = spawnSync(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
    cwd: apiDirectory, env: { ...process.env, DATABASE_URL: targetUrl.href }, encoding: "utf8",
  });
  assert.equal(migration.status, 0, "마이그레이션 실패. DB와 로컬 환경을 보존합니다.");
  const database = createDatabaseClient(targetUrl.href);
  try {
    const applied = (await database.pool.query<{ id: string }>("SELECT id FROM app_schema_migrations ORDER BY id"))
      .rows.map(({ id }) => id);
    assert.deepEqual(applied, expectedMigrations);
    stage = "카탈로그 적재 및 독립 재조회";
    const report = await prepareLearningPlanCatalogFixture(database, true);
    const counts = await database.pool.query(
      `SELECT (SELECT count(*)::int FROM students) AS students,
        (SELECT count(*)::int FROM student_curricula) AS curricula,
        (SELECT count(*)::int FROM lesson_feedback_events) AS feedback`,
    );
    assert.deepEqual(counts.rows[0], { students: 0, curricula: 0, feedback: 0 });
    console.log(JSON.stringify({ status: "PASS", appliedMigrations: applied, catalogs: report, learningRows: counts.rows[0] }, null, 2));
  } finally {
    await database.close();
  }
} catch {
  // 드라이버 예외에는 접속·인증값이 포함될 수 있으므로 원문을 출력하지 않는다.
  console.error(`테스트 DB 준비 실패 단계: ${stage}. 기존 DB는 변경하지 않으며 새 환경도 자동 삭제하지 않습니다.`);
  process.exitCode = 1;
}

function readEnvironment(path: URL): Record<string, string> {
  return Object.fromEntries(readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) return [];
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    return [[match[1], value]];
  }));
}
