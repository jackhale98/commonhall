/**
 * Database helpers. The sync code talks to Postgres directly with postgres.js
 * (works under Node and Deno), connecting as the service role / postgres user.
 */
import type postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, unknown>>;
export type TransactionSql = postgres.TransactionSql<Record<string, unknown>>;
export type AnySql = Sql | TransactionSql;

export type Row = Record<string, unknown>;

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return name;
}

/**
 * Insert `row`, or update the existing row only if some column actually differs.
 * Returns true if a row was inserted or changed. Column names come from our own
 * code (never from upstream data) and are validated anyway.
 */
export async function upsertIfChanged(sql: AnySql, table: string, keys: string[], row: Row): Promise<boolean> {
  const cols = Object.keys(row).map(ident);
  const tableName = table.split('.').map(ident).join('.');
  const keyCols = keys.map(ident);
  const updatable = cols.filter((c) => !keyCols.includes(c));
  const values = cols.map((c) => row[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  let query = `insert into ${tableName} as t (${cols.join(', ')}) values (${placeholders}) on conflict (${keyCols.join(', ')})`;
  if (updatable.length === 0) {
    query += ' do nothing';
  } else {
    query += ` do update set ${updatable.map((c) => `${c} = excluded.${c}`).join(', ')}`;
    query += ` where (${updatable.map((c) => `t.${c}`).join(', ')}) is distinct from (${updatable
      .map((c) => `excluded.${c}`)
      .join(', ')})`;
  }
  query += ' returning 1';
  const result = await sql.unsafe(query, values as postgres.ParameterOrJSON<never>[]);
  return result.length > 0;
}

/** Insert many rows in one statement; returns the number inserted. */
export async function insertMany(
  sql: AnySql,
  table: string,
  rows: Row[],
  onConflictDoNothing = false,
): Promise<number> {
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]!).map(ident);
  const tableName = table.split('.').map(ident).join('.');
  let written = 0;
  // Stay well under Postgres' 65535 bind-parameter limit.
  const chunk = Math.max(1, Math.floor(30000 / cols.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values: unknown[] = [];
    const tuples = slice.map((row) => {
      const start = values.length;
      for (const c of cols) values.push(row[c] ?? null);
      return `(${cols.map((_, j) => `$${start + j + 1}`).join(', ')})`;
    });
    const query = `insert into ${tableName} (${cols.join(', ')}) values ${tuples.join(', ')}${
      onConflictDoNothing ? ' on conflict do nothing' : ''
    } returning 1`;
    const result = await sql.unsafe(query, values as postgres.ParameterOrJSON<never>[]);
    written += result.length;
  }
  return written;
}
