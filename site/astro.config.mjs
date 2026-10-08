// @ts-check
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';

// GitHub Pages: SITE_URL is the origin (https://<user>.github.io) and BASE_PATH the
// project path (/<repo>/). With a custom domain, set BASE_PATH to '/'.
// The deploy workflow fills both from actions/configure-pages.
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  output: 'static',
  integrations: [preact()],
  build: { format: 'directory' },
  prefetch: false,
  vite: {
    // The site only reads PUBLIC_* env vars; service keys must never be referenced here.
    envPrefix: 'PUBLIC_',
  },
});
