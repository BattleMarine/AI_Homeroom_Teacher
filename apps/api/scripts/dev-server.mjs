import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Pool } from "pg";

const mode = process.argv[2];
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseEnvironmentFile = resolve(apiDirectory, "..", "..", ".env.db.local");

if (mode !== "postgres" && mode !== "memory") {
  throw new Error("개발 저장소 모드는 postgres 또는 memory여야 합니다.");
}

if (mode === "postgres") {
  if (!existsSync(databaseEnvironmentFile)) {
    throw new Error(".env.db.local 파일이 필요합니다. DB 개발 환경 설정을 확인하세요.");
  }

  process.loadEnvFile(databaseEnvironmentFile);

  if (process.env.PERSISTENCE_MODE !== "postgres") {
    throw new Error("PostgreSQL 개발 실행에는 .env.db.local의 PERSISTENCE_MODE=postgres 설정이 필요합니다.");
  }

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("PostgreSQL 개발 실행에는 DATABASE_URL 환경 변수가 필요합니다.");
  }

  await assertPostgresPreflight(process.env.DATABASE_URL);
} else {
  process.env.PERSISTENCE_MODE = "memory";
}

process.env.API_HOST ??= "127.0.0.1";
process.env.API_PORT ??= "4100";
await assertPortAvailable(process.env.API_HOST, Number(process.env.API_PORT));

const server = spawn(
  process.execPath,
  ["--watch", "--import", "tsx", "src/server.ts"],
  {
    cwd: apiDirectory,
    env: process.env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

async function assertPostgresPreflight(connectionString) {
  const pool = new Pool({ connectionString });
  try {
    await pool.query("SELECT 1");
    const migrationDirectory = resolve(apiDirectory, "src", "db", "migrations");
    const requiredMigrationIds = (await readdir(migrationDirectory))
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();
    const appliedMigrationIds = new Set(
      (await pool.query("SELECT id FROM app_schema_migrations")).rows.map((row) => row.id),
    );
    const missingMigrationIds = requiredMigrationIds.filter((migrationId) => !appliedMigrationIds.has(migrationId));

    if (missingMigrationIds.length > 0) {
      throw new Error(`적용되지 않은 마이그레이션이 있습니다: ${missingMigrationIds.join(", ")}`);
    }
  } finally {
    await pool.end();
  }
}

async function assertPortAvailable(host, port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("API_PORT는 1부터 65535 사이의 정수여야 합니다.");
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.once("error", (error) => rejectPromise(new Error(`API 포트를 사용할 수 없습니다: ${host}:${port}`, { cause: error })));
    probe.listen({ host, port }, () => probe.close((error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    }));
  });
}
