/**
 * Public configuration. Only PUBLIC_* values may appear here: they are inlined
 * into the browser bundle. The anon (publishable) key is safe to ship only
 * because row-level security is enabled on every table.
 */
export const SUPABASE_URL: string = import.meta.env.PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SITE_NAME = import.meta.env.PUBLIC_SITE_NAME || 'CommonHall';

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Demo mode: no Supabase project, so the site is built from the sample data in
 * src/data/demo.json and account features are switched off.
 */
export const DEMO = !hasSupabase && import.meta.env.PUBLIC_DEMO === 'true';

/** Pol.is site id (public; from the Pol.is admin "integrate" page). Discussions show a notice without it. */
export const POLIS_SITE_ID: string = import.meta.env.PUBLIC_POLIS_SITE_ID ?? '';
/**
 * Open participation (the default for now): anyone may vote and add statements
 * without an account, and "residents only" becomes a request rather than a check.
 * Set PUBLIC_OPEN_PARTICIPATION=false to require sign-in (and residency) again.
 */
export const OPEN_PARTICIPATION = import.meta.env.PUBLIC_OPEN_PARTICIPATION !== 'false';
export const POLIS_EMBED_URL = 'https://pol.is/embed.js';
