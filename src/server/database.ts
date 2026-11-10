import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { schema } from "./schema";
import { seed } from "./seed";

export interface Database {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(operation: (database: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createLocalDatabase(directory?: string): Promise<Database> {
  if (directory) await mkdir(directory, { recursive: true });
  const engine = new PGlite(directory);
  await engine.waitReady;
  function wrap(client: Pick<PGlite, "query" | "exec">): Database {
    return {
      async query<T>(sql: string, params: unknown[] = []) {
        return (await client.query<T>(sql, params)).rows;
      },
      async exec(sql) { await client.exec(sql); },
      async transaction(operation) {
        return engine.transaction((transaction) => operation(wrap(transaction)));
      },
      async close() { await engine.close(); },
    };
  }
  return wrap(engine);
}

export function createPostgresDatabase(connectionString: string): Database {
  const pool = new Pool({ connectionString, max: 8 });
  function wrap(client: Pool | PoolClient): Database {
    return {
      async query<T>(sql: string, params: unknown[] = []) {
        return (await client.query(sql, params)).rows as T[];
      },
      async exec(sql) { await client.query(sql); },
      async transaction(operation) {
        const connection = await pool.connect();
        try {
          await connection.query("BEGIN");
          const result = await operation(wrap(connection));
          await connection.query("COMMIT");
          return result;
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        } finally {
          connection.release();
        }
      },
      async close() { await pool.end(); },
    };
  }
  return wrap(pool);
}

export function demoEnabled() {
  return process.env.COSPACE_DEMO_MODE === "true" ||
    (process.env.COSPACE_DEMO_MODE !== "false" && !process.env.DATABASE_URL && process.env.NODE_ENV !== "production");
}

const globalDatabase = globalThis as unknown as { cospaceDatabase?: Promise<Database> };

export function getDatabase(): Promise<Database> {
  globalDatabase.cospaceDatabase ??= (async () => {
    const database = process.env.DATABASE_URL
      ? createPostgresDatabase(process.env.DATABASE_URL)
      : await createLocalDatabase(path.resolve(process.env.COSPACE_DATA_DIR || ".data/cospace"));
    await database.exec(schema);
    await seed(database, demoEnabled());
    return database;
  })().catch((error) => {
    delete globalDatabase.cospaceDatabase;
    throw error;
  });
  return globalDatabase.cospaceDatabase;
}
