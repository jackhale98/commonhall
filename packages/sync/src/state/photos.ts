/**
 * Lighter official photos (migration 051). Each photo URL is checked once (again
 * after 90 days): the source's own smaller copy is used when there is one, else the
 * original if it is small enough, else none, and the choice is stored in
 * private.photo_variants, where a trigger applies it to every write.
 */
import type { Sql } from '../db.ts';

/** A photo this size or smaller is used as is. */
export const SMALL_PHOTO_BYTES = 250_000;
/** Larger than this with no smaller copy: show initials instead. */
export const MAX_PHOTO_BYTES = 600_000;

/** Smaller copies the source itself publishes, best first. */
export function smallerCopies(url: string): string[] {
  // Wikimedia: /wikipedia/commons/a/ab/Name.jpg → /wikipedia/commons/thumb/a/ab/Name.jpg/240px-Name.jpg
  const wiki =
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/(?!thumb\/)([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/i.exec(url);
  if (wiki) {
    const [, base, dirs, file] = wiki;
    const thumb = /\.(svg|tiff?)$/i.test(file!) ? `240px-${file}.png` : `240px-${file}`;
    return [`${base}/thumb/${dirs}/${file}/${thumb}`];
  }
  // WordPress makes a 150×150 crop and a 300×300 of each upload.
  const wp = /^(https?:\/\/[^?#]*\/wp-content\/[^?#]*?)(-\d+x\d+)?\.(jpe?g|png|webp)$/i.exec(url);
  if (wp) {
    const [, stem, , ext] = wp;
    return [`${stem}-300x300.${ext}`, `${stem}-150x150.${ext}`];
  }
  return [];
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The size of an image, or null when it can't be read (missing, not an image, an error). */
export async function photoBytes(fetchImpl: Fetch, url: string): Promise<number | null> {
  try {
    const headers = { 'user-agent': 'commonhall (+https://github.com/jackhale98/commonhall)' };
    const head = await fetchImpl(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(15_000) });
    const type = head.headers.get('content-type') ?? '';
    const length = Number(head.headers.get('content-length'));
    if (head.ok && type.startsWith('image/') && length > 0) return length;
    if (head.ok && !type.startsWith('image/') && type) return null;
    // No length (or HEAD refused): read it.
    const get = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!get.ok || !(get.headers.get('content-type') ?? '').startsWith('image/')) {
      await get.body?.cancel().catch(() => undefined);
      return null;
    }
    return (await get.arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

/**
 * What to show for a photo: `{ use }` with the URL (null for initials), or null when
 * the original can't be read right now (left unrecorded, so it is tried again).
 */
export async function choosePhoto(
  fetchImpl: Fetch,
  url: string,
): Promise<{ use: string | null; bytes: number } | null> {
  const original = await photoBytes(fetchImpl, url);
  if (original === null) return null;
  if (original <= SMALL_PHOTO_BYTES) return { use: url, bytes: original };
  for (const copy of smallerCopies(url)) {
    const bytes = await photoBytes(fetchImpl, copy);
    if (bytes !== null && bytes <= SMALL_PHOTO_BYTES) return { use: copy, bytes };
  }
  return original <= MAX_PHOTO_BYTES ? { use: url, bytes: original } : { use: null, bytes: original };
}

/** Check photos not yet checked (or not for 90 days), a few at a time; returns how many changed. */
export async function lightenPhotos(
  sql: Sql,
  options: { fetch?: Fetch; concurrency?: number; log?: (message: string) => void } = {},
): Promise<{ checked: number; replaced: number; removed: number }> {
  const fetchImpl: Fetch = options.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const due = (
    await sql<{ url: string }[]>`
      select distinct p.url from (
        select photo_url as url from public.state_legislators where photo_url is not null and current
        union select photo_url from public.state_executives where photo_url is not null
        union select photo_url from public.local_officials where photo_url is not null
      ) p
      left join private.photo_variants v on v.url = p.url
      where v.url is null or v.checked_at < now() - interval '90 days'`
  ).map((r) => r.url);
  const result = { checked: 0, replaced: 0, removed: 0 };
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const url = due[next++]!;
      const choice = await choosePhoto(fetchImpl, url);
      if (!choice) continue;
      result.checked++;
      // The original maps to the choice; a chosen copy maps to itself, so it isn't checked again.
      await sql`
        insert into private.photo_variants (url, use_url, bytes) values (${url}, ${choice.use}, ${choice.bytes})
        on conflict (url) do update set use_url = excluded.use_url, bytes = excluded.bytes, checked_at = now()`;
      if (choice.use !== url) {
        if (choice.use)
          await sql`
            insert into private.photo_variants (url, use_url) values (${choice.use}, ${choice.use})
            on conflict (url) do update set checked_at = now()`;
        if (choice.use) result.replaced++;
        else result.removed++;
        // Rewrite stored rows; the trigger maps the URL.
        for (const table of ['state_legislators', 'state_executives', 'local_officials'])
          await sql`update ${sql(`public.${table}`)} set photo_url = photo_url where photo_url = ${url}`;
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 6 }, worker));
  options.log?.(
    `Photos: ${result.checked} checked, ${result.replaced} replaced by a smaller copy, ${result.removed} too large (initials)`,
  );
  return result;
}
