/**
 * Public configuration. Only PUBLIC_* values may appear here: they are inlined
 * into the browser bundle. The anon (publishable) key is safe to ship only
 * because row-level security is enabled on every table.
 */
export const SUPABASE_URL: string = import.meta.env.PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SITE_NAME = import.meta.env.PUBLIC_SITE_NAME || 'Civic Tracker';

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Demo mode: no Supabase project, so the site is built from the sample data in
 * src/data/demo.json and account features are switched off.
 */
export const DEMO = !hasSupabase && import.meta.env.PUBLIC_DEMO === 'true';
