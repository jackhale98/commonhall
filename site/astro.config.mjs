// @ts-check
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';

// GitHub Pages: SITE_URL is the origin (https://<user>.github.io) and BASE_PATH the
// project path (/<repo>/). With a custom domain, set BASE_PATH to '/'.
// The deploy workflow fills both from actions/configure-pages.
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = process.env.BASE_PATH || '/';

// Content Security Policy, as a <meta> tag (GitHub Pages can't send headers). Astro
// hashes every inline script and style it renders, so only our own scripts run:
// no third-party script hosts, no injected inline code. The browser talks to this
// site and Supabase; Pol.is is an iframe; photos come from many government sites.
const supabase = (() => {
  try {
    return new URL(process.env.PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    return null;
  }
})();
const connect = ["'self'", supabase, supabase?.replace(/^http/, 'ws')].filter(Boolean).join(' ');
/** @type {NonNullable<import('astro').AstroUserConfig['security']>['csp']} */
const csp = {
  directives: /** @type {any} */ ([
    "default-src 'self'",
    `connect-src ${connect}`,
    "img-src 'self' data: https:",
    "font-src 'self'",
    'frame-src https://pol.is',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]),
  scriptDirective: { resources: ["'self'"] },
  // Style attributes (style="…") are allowed; style elements are hashed.
  styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: /** @type {const} */ ('attribute') }] },
};

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  output: 'static',
  integrations: [preact()],
  build: { format: 'directory' },
  prefetch: false,
  security: { csp },
  vite: {
    // The site only reads PUBLIC_* env vars; service keys must never be referenced here.
    envPrefix: 'PUBLIC_',
  },
});
