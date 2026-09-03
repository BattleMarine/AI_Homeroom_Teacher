import { buildApp } from "./app.js";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getApiServerConfig, getDatabaseConfig, getPersistenceMode } from "./config.js";
import { createDatabaseClient } from "./db/client.js";
import { createPostgresCourseCatalogRepository } from "./course-catalog/course-catalog.postgres-repository.js";
import { createPostgresProgressStateRepository } from "./progress/progress.postgres-repository.js";
import { createPostgresProgressService } from "./progress/progress.postgres-service.js";
import { createPostgresStudentCurriculumRepository } from "./student-curriculum/student-curriculum.postgres-repository.js";
import { createPostgresSubjectEnrollmentProposalRepository } from "./subject-enrollment/subject-enrollment.postgres-repository.js";
import type { Pool } from "pg";

const config = getApiServerConfig();
const persistenceMode = getPersistenceMode();
const database = persistenceMode === "postgres"
  ? createDatabaseClient(getDatabaseConfig().connectionString)
  : undefined;

if (database) {
  try {
    await database.check();
    await assertRequiredMigrations(database.pool);
  } catch (error) {
    await database.close();
    throw new Error("PostgreSQL 연결에 실패했습니다. DATABASE_URL과 마이그레이션 상태를 확인하세요.", { cause: error });
  }
}

async function assertRequiredMigrations(pool: Pool) {
  const migrationDirectory = fileURLToPath(new URL("./db/migrations/", import.meta.url));
  const requiredMigrationIds = (await readdir(migrationDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const appliedMigrationIds = new Set(
    (await pool.query<{ id: string }>("SELECT id FROM app_schema_migrations")).rows.map((row) => row.id),
  );
  const missingMigrationIds = requiredMigrationIds.filter((migrationId) => !appliedMigrationIds.has(migrationId));

  if (missingMigrationIds.length > 0) {
    throw new Error(`적용되지 않은 마이그레이션이 있습니다: ${missingMigrationIds.join(", ")}`);
  }
}

const studentCurriculumRepository = database
  ? createPostgresStudentCurriculumRepository(database.pool)
  : undefined;

const subjectEnrollmentProposalRepository = database
  ? createPostgresSubjectEnrollmentProposalRepository(database.pool)
  : undefined;

const app = database
  ? buildApp({
      courseCatalogRepository: createPostgresCourseCatalogRepository(database.pool),
      progressServiceResolver: (subjectCode) => createPostgresProgressService(
        createPostgresProgressStateRepository(database.pool, subjectCode),
        studentCurriculumRepository!,
        subjectCode,
      ),
      studentCurriculumRepository,
      subjectEnrollmentProposalRepository,
    })
  : buildApp();

if (database) {
  app.addHook("onClose", async () => database.close());
}

try {
  await app.listen(config);
  app.log.info({ persistenceMode }, "API 저장소 모드로 시작했습니다.");
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
