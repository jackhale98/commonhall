/**
 * Auth helpers. supabase-js is imported lazily: anonymous visitors on public
 * pages never download it. Sessions persist in localStorage under a fixed key so
 * islands can tell whether someone is signed in without loading the library.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabase } from './config';
import { href } from './paths';

export const STORAGE_KEY = 'civic-auth';
const PENDING_KEY = 'civic-pending-follow';

let clientPromise: Promise<SupabaseClient> | undefined;

export function getClient(): Promise<SupabaseClient> {
  if (!hasSupabase) return Promise.reject(new Error('Supabase is not configured for this build.'));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Implicit flow: a magic link opened on another device or browser still signs in.
        flowType: 'implicit',
      },
    }),
  );
  return clientPromise;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True if a session might exist (cheap check, no network, no library). */
export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false;
  if (/access_token=|error_description=/.test(window.location.hash)) return true;
  return Boolean(safeStorage()?.getItem(STORAGE_KEY));
}

export async function getSession(): Promise<Session | null> {
  if (!hasStoredSession()) return null;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  return data.session;
}

export function accountUrl(next?: string): string {
  return next ? `${href('account/')}?next=${encodeURIComponent(next)}` : href('account/');
}

export interface PendingTarget {
  targetType: string;
  targetId: string;
}

export interface PendingFollow {
  targets: PendingTarget[];
  returnTo: string;
  at: number;
}

/**
 * Remember follows the user asked for while signed out. localStorage rather than
 * sessionStorage: the magic link usually opens in a new tab. Expires after an hour.
 */
export function savePendingFollows(targets: PendingTarget[], returnTo: string) {
  safeStorage()?.setItem(PENDING_KEY, JSON.stringify({ targets, returnTo, at: Date.now() }));
}

export function savePendingFollow(targetType: string, targetId: string, returnTo: string) {
  savePendingFollows([{ targetType, targetId }], returnTo);
}

export function takePendingFollow(): PendingFollow | null {
  const storage = safeStorage();
  const raw = storage?.getItem(PENDING_KEY);
  storage?.removeItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingFollow;
    return Date.now() - value.at < 3_600_000 && Array.isArray(value.targets) ? value : null;
  } catch {
    return null;
  }
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

export async function followMany(targets: PendingTarget[]): Promise<void> {
  if (targets.length === 0) return;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error('Not signed in');
  const { error } = await client.from('follows').upsert(
    targets.map((t) => ({ user_id: session.user.id, target_type: t.targetType, target_id: t.targetId })),
    { ignoreDuplicates: true },
  );
  if (error) throw error;
  for (const t of targets) void followCache?.then((set) => set.add(key(t.targetType, t.targetId)));
}

export function follow(targetType: string, targetId: string): Promise<void> {
  return followMany([{ targetType, targetId }]);
}

export async function unfollow(targetType: string, targetId: string): Promise<void> {
  const client = await getClient();
  const { error } = await client.from('follows').delete().match({ target_type: targetType, target_id: targetId });
  if (error) throw error;
  void followCache?.then((set) => set.delete(key(targetType, targetId)));
}

const key = (type: string, id: string) => `${type}:${id}`;
let followCache: Promise<Set<string>> | undefined;

/** All of the user's follows, loaded once per page and shared by every Follow button. */
function followSet(): Promise<Set<string>> {
  followCache ??= (async () => {
    const client = await getClient();
    const { data, error } = await client.from('follows').select('target_type,target_id').limit(1000);
    if (error) throw error;
    return new Set((data ?? []).map((f) => key(f.target_type, f.target_id)));
  })();
  return followCache;
}

/** The ids the user follows of one kind ("bill", "state_legislator", …). */
export async function followedIds(targetType: string): Promise<string[]> {
  const prefix = `${targetType}:`;
  return [...(await followSet())].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

export interface SavedDistricts {
  state: string | null;
  congressional_district: number | null;
  state_upper_district: string | null;
  state_lower_district: string | null;
  city: string | null;
  council_district: number | null;
}

let districtsCache: Promise<SavedDistricts | null> | undefined;

/** The signed-in user's saved districts (from Find my reps), loaded once per page; null when signed out. */
export function savedDistricts(): Promise<SavedDistricts | null> {
  districtsCache ??= (async () => {
    if (!hasStoredSession()) return null;
    const client = await getClient();
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    const { data: row } = await client
      .from('profiles')
      .select('state,congressional_district,state_upper_district,state_lower_district,city,council_district')
      .eq('user_id', data.session.user.id)
      .maybeSingle();
    return (row as SavedDistricts | null) ?? null;
  })().catch(() => null);
  return districtsCache;
}

export async function isFollowing(targetType: string, targetId: string): Promise<boolean> {
  return (await followSet()).has(key(targetType, targetId));
}

export interface PolisProfile {
  /** Random per-user id; the only identifier ever sent to Pol.is. */
  xid: string;
  state: string | null;
  city: string | null;
  councilDistrict: number | null;
}

/** The signed-in user's Pol.is id and saved residency (creating an empty profile if needed). */
export async function polisProfile(): Promise<PolisProfile | null> {
  if (!hasStoredSession()) return null;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  if (!data.session) return null;
  const read = () =>
    client
      .from('profiles')
      .select('polis_xid,state,city,council_district')
      .eq('user_id', data.session!.user.id)
      .maybeSingle();
  let { data: row, error } = await read();
  if (error) throw error;
  if (!row) {
    const inserted = await client
      .from('profiles')
      .upsert({ user_id: data.session.user.id }, { ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
    ({ data: row, error } = await read());
    if (error || !row) throw error ?? new Error('Profile not found');
  }
  return { xid: row.polis_xid, state: row.state, city: row.city, councilDistrict: row.council_district };
}

/** Has the signed-in user asked for a discussion on this item? */
export async function hasRequestedDiscussion(targetType: string, targetId: string): Promise<boolean> {
  const client = await getClient();
  const { data, error } = await client
    .from('discussion_requests')
    .select('target_id')
    .match({ target_type: targetType, target_id: targetId })
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function setDiscussionRequest(targetType: string, targetId: string, on: boolean): Promise<void> {
  const client = await getClient();
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Not signed in');
  const { error } = on
    ? await client
        .from('discussion_requests')
        .upsert(
          { user_id: data.session.user.id, target_type: targetType, target_id: targetId },
          { ignoreDuplicates: true },
        )
    : await client.from('discussion_requests').delete().match({ target_type: targetType, target_id: targetId });
  if (error) throw error;
}

/** Is the signed-in user a maintainer who can manage discussions? */
export async function isAdmin(): Promise<boolean> {
  const client = await getClient();
  const { data, error } = await client.rpc('is_admin');
  if (error) throw error;
  return data === true;
}
