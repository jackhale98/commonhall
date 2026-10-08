import { randomUUID } from 'node:crypto';
import type { Sql } from '@civic/sync';

/** Create a confirmed user directly in auth.users (local test database only). */
export async function createUser(sql: Sql, email = `${randomUUID()}@example.test`): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${email}, '', now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{}')`;
  return id;
}

/** Run `fn` as an authenticated user, the way PostgREST does (role + JWT claims). */
export async function asUser<T>(sql: Sql, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

export async function asAnon<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'anon', true)`;
    await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}
