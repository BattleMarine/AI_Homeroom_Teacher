import { getDatabaseConfig } from "../config.js";
import { createDatabaseClient } from "./client.js";

const database = createDatabaseClient(getDatabaseConfig().connectionString);

try {
  await database.check();
  console.log("PostgreSQL 연결과 기본 쿼리 실행을 확인했습니다.");
} finally {
  await database.close();
}
