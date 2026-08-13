import { buildApp } from "./app.js";
import { getApiServerConfig, getDatabaseConfig, getPersistenceMode } from "./config.js";
import { createDatabaseClient } from "./db/client.js";
import { createPostgresCourseCatalogRepository } from "./course-catalog/course-catalog.postgres-repository.js";
import { createPostgresProgressStateRepository } from "./progress/progress.postgres-repository.js";
import { createPostgresProgressService } from "./progress/progress.postgres-service.js";

const config = getApiServerConfig();
const persistenceMode = getPersistenceMode();
const database = persistenceMode === "postgres"
  ? createDatabaseClient(getDatabaseConfig().connectionString)
  : undefined;

if (database) {
  try {
    await database.check();
  } catch (error) {
    await database.close();
    throw new Error("PostgreSQL 연결에 실패했습니다. DATABASE_URL과 마이그레이션 상태를 확인하세요.", { cause: error });
  }
}

const app = database
  ? buildApp({
      courseCatalogRepository: createPostgresCourseCatalogRepository(database.pool),
      progressService: createPostgresProgressService(createPostgresProgressStateRepository(database.pool)),
    })
  : buildApp();

if (database) {
  app.addHook("onClose", async () => database.close());
}

try {
  await app.listen(config);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
