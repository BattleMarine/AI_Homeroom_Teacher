import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getDatabaseConfig } from "../config.js";
import { createDatabaseClient } from "./client.js";

const migrationDirectoryUrl = new URL("./migrations/", import.meta.url);

async function migrate() {
  const database = createDatabaseClient(getDatabaseConfig().connectionString);
  try {
    await database.withTransaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_schema_migrations (
          id varchar(255) PRIMARY KEY,
          applied_at timestamptz NOT NULL
        )
      `);
      const applied = new Set(
        (await client.query<{ id: string }>("SELECT id FROM app_schema_migrations")).rows.map((row) => row.id),
      );
      const fileNames = (await readdir(fileURLToPath(migrationDirectoryUrl)))
        .filter((fileName) => fileName.endsWith(".sql"))
        .sort();

      for (const fileName of fileNames) {
        if (applied.has(fileName)) continue;
        await client.query((await readFile(new URL(fileName, migrationDirectoryUrl), "utf8")).replace(/^\uFEFF/, ""));
        await client.query("INSERT INTO app_schema_migrations (id, applied_at) VALUES ($1, now())", [fileName]);
        console.log(`마이그레이션 적용: ${fileName}`);
      }
    });
  } finally {
    await database.close();
  }
}

await migrate();
