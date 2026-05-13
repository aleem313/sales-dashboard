import type { Pool as PgPool } from "pg";

let pool: PgPool | null = null;

async function getPool(): Promise<PgPool> {
  if (!pool) {
    const { Pool } = await import("pg");
    pool = new Pool({
      connectionString:
        process.env.POSTGRES_URL ||
        `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}`,
    });
  }
  return pool;
}

/**
 * Tagged template wrapper around `pg.Pool.query`. Mirrors the API the rest
 * of the codebase was written against (rows + rowCount return shape).
 */
async function sqlTagged<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      text += `$${i + 1}`;
    }
  }
  const p = await getPool();
  return p.query(text, values as unknown[]);
}

/**
 * Parameterized query — sql.query(text, params)
 * Used where dynamic column/direction interpolation prevents tagged templates.
 */
async function sqlQuery<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const p = await getPool();
  return p.query(text, params);
}

export const sql = Object.assign(sqlTagged, { query: sqlQuery });
