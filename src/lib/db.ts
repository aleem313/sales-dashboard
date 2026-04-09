import { sql as vercelSql } from "@vercel/postgres";

const pgHost = process.env.POSTGRES_HOST || "";
const isLocal =
  pgHost === "localhost" ||
  pgHost === "127.0.0.1" ||
  pgHost === "postgres" ||
  !pgHost.includes(".");

// Lazy-loaded pg pool — only imported when running locally, avoiding
// Edge runtime errors from Node.js-only modules.
let localPool: InstanceType<typeof import("pg").Pool> | null = null;

async function getLocalPool() {
  if (!localPool) {
    const { Pool } = await import("pg");
    localPool = new Pool({
      connectionString:
        process.env.POSTGRES_URL ||
        `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}`,
    });
  }
  return localPool;
}

/**
 * Tagged template that works like @vercel/postgres `sql` but falls back
 * to a plain `pg` Pool when POSTGRES_HOST is localhost.
 */
async function sqlTagged<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  if (!isLocal) {
    return vercelSql(strings, ...values) as Promise<{
      rows: T[];
      rowCount: number | null;
    }>;
  }

  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      text += `$${i + 1}`;
    }
  }

  const pool = await getLocalPool();
  return pool.query(text, values as unknown[]);
}

/**
 * Parameterized query — sql.query(text, params)
 * Used where dynamic column/direction interpolation prevents tagged templates.
 */
async function sqlQuery<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  if (!isLocal) {
    return vercelSql.query(text, params) as Promise<{
      rows: T[];
      rowCount: number | null;
    }>;
  }

  const pool = await getLocalPool();
  return pool.query(text, params);
}

// Combine tagged template + .query() into one export
export const sql = Object.assign(sqlTagged, { query: sqlQuery });
