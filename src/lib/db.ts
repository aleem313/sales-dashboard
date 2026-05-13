import type { Pool as PgPool, PoolClient } from "pg";

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

/**
 * Tagged-template wrapper bound to a single PoolClient. Mirrors the `sql`
 * surface so transaction bodies can reuse the same template style.
 */
export type TxSql = {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

function makeTxSql(client: PoolClient): TxSql {
  const tagged = <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }> => {
    let text = "";
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    return client.query<T>(text, values as unknown[]) as Promise<{
      rows: T[];
      rowCount: number | null;
    }>;
  };
  return Object.assign(tagged, {
    query: <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
      client.query<T>(text, params) as Promise<{ rows: T[]; rowCount: number | null }>,
  }) as unknown as TxSql;
}

/**
 * Run `fn` inside a single transaction on one pooled client. BEGIN before
 * the body; COMMIT if it resolves; ROLLBACK if it throws (then re-throws).
 *
 * Use this when several statements must succeed or fail together AND when
 * intermediate states between statements would otherwise violate a
 * constraint — splitting work across separate top-level `sql` calls would
 * use different connections and lose atomicity.
 */
export async function withTransaction<T>(
  fn: (tx: TxSql) => Promise<T>
): Promise<T> {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const tx = makeTxSql(client);
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // swallow — we want to surface the original error
    }
    throw err;
  } finally {
    client.release();
  }
}
