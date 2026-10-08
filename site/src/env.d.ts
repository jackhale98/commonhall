/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly PUBLIC_POLIS_SITE_ID?: string;
  readonly PUBLIC_SITE_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
