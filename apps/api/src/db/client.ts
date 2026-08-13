import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

export type DatabaseClient = {
  pool: Pool;
  db: ReturnType<typeof drizzle>;
  close(): Promise<void>;
  check(): Promise<void>;
  withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
};

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new Pool({ connectionString });

  return {
    pool,
    db: drizzle({ client: pool }),
    async close() {
      await pool.end();
    },
    async check() {
      await pool.query("SELECT 1");
    },
    async withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
