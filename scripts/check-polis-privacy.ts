/**
 * Privacy check for discussions: open a discussion page signed out and then as a
 * signed-in Boston resident, record every request the browser makes to pol.is,
 * and fail if any contains the user's auth id, email or saved address.
 *
 * Needs a local Supabase (`supabase start`), a build served at SITE (built with
 * PUBLIC_POLIS_SITE_ID set) and the local service-role key:
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... SITE=http://localhost:4321/ npm run check:polis
 */
import { chromium, type Request } from 'playwright';

const SITE = (process.env.SITE ?? 'http://localhost:4321/').replace(/\/?$/, '/');
const SUPABASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCUSSION = process.env.DISCUSSION ?? 'example-boston-ordinance';
if (!SERVICE) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (from `supabase status`).');

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });

const email = `polis-check-${Date.now()}@example.test`;
const address = '1 City Hall Square, Boston, MA 02201';
const created = (await (
  await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, email_confirm: true }),
  })
).json()) as { id: string };
const userId = created.id;
await admin('/rest/v1/profiles', {
  method: 'POST',
  headers: { prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify({
    user_id: userId,
    address_label: address,
    state: 'MA',
    congressional_district: 8,
    city: 'ma-boston',
    council_district: 1,
  }),
});
const [profile] = (await (await admin(`/rest/v1/profiles?user_id=eq.${userId}&select=polis_xid`)).json()) as {
  polis_xid: string;
}[];

const secrets = [userId, email, address, 'City Hall Square', 'City%20Hall', 'City+Hall'];
const leaks: string[] = [];
const seen: { phase: string; url: string }[] = [];

function inspect(phase: string, req: Request) {
  const url = req.url();
  if (!/^https?:\/\/([a-z0-9-]+\.)*pol\.is\//.test(url)) return;
  seen.push({ phase, url });
  const haystack = [url, req.postData() ?? '', JSON.stringify(req.headers())].join('\n');
  const decoded = (() => {
    try {
      return decodeURIComponent(haystack);
    } catch {
      return haystack;
    }
  })();
  for (const s of secrets) if (haystack.includes(s) || decoded.includes(s)) leaks.push(`${phase}: ${s} in ${url}`);
}

const browser = await chromium.launch();
try {
  // 1. Signed out.
  const anon = await browser.newPage();
  anon.on('request', (r) => inspect('signed-out', r));
  await anon.goto(`${SITE}discussions/${DISCUSSION}/?utm_source=test#frag`, { waitUntil: 'networkidle' });
  const anonPolis = seen.filter((s) => s.phase === 'signed-out');
  if (anonPolis.some((s) => s.url.includes('xid='))) leaks.push('signed-out: an xid was sent');
  if (anonPolis.some((s) => /utm_source|frag/.test(s.url))) leaks.push('signed-out: query string or fragment sent');

  // 2. Signed in (magic link from the admin API), resident of the discussion's city.
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('request', (r) => inspect('signed-in', r));
  const link = (await (
    await admin('/auth/v1/admin/generate_link', {
      method: 'POST',
      body: JSON.stringify({ type: 'magiclink', email, redirect_to: `${SITE}account/` }),
    })
  ).json()) as { action_link: string };
  await page.goto(link.action_link);
  await page.waitForURL(`${SITE}account/**`);
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k === 'civic-auth'));
  await page.goto(`${SITE}discussions/${DISCUSSION}/`, { waitUntil: 'networkidle' });
  const signedIn = seen.filter((s) => s.phase === 'signed-in');
  if (!signedIn.some((s) => s.url.includes(`xid=${profile!.polis_xid}`))) {
    leaks.push('signed-in: expected the random polis_xid to be sent (is PUBLIC_POLIS_SITE_ID set?)');
  }

  console.log(`Requests to pol.is: ${anonPolis.length} signed out, ${signedIn.length} signed in`);
  for (const s of seen) console.log(`  [${s.phase}] ${s.url}`);
} finally {
  await browser.close();
  await admin(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
}

if (leaks.length) {
  console.error('FAIL\n' + leaks.join('\n'));
  process.exit(1);
}
console.log('OK: no auth id, email or address reached pol.is.');
