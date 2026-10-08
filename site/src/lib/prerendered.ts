/**
 * The build writes /prerendered.json listing every item with a prerendered page.
 * Client-rendered fallback routes use it to send visitors to the clean URL (with
 * its better link preview) when one exists.
 */
import { href } from './paths';

export interface PrerenderedIndex {
  bills: string[];
  /** Open States id → clean path. */
  stateBills: Record<string, string>;
  localMatters: string[];
  discussions: string[];
}

let cached: Promise<PrerenderedIndex | null> | undefined;

export function prerenderedIndex(): Promise<PrerenderedIndex | null> {
  cached ??= fetch(href('prerendered.json'))
    .then((r) => (r.ok ? (r.json() as Promise<PrerenderedIndex>) : null))
    .catch(() => null);
  return cached;
}

/** Replace the current page with `clean` if `has` says it was prerendered. Returns true if redirecting. */
export async function redirectIfPrerendered(has: (index: PrerenderedIndex) => string | null): Promise<boolean> {
  const index = await prerenderedIndex();
  const clean = index ? has(index) : null;
  if (!clean || clean === window.location.pathname) return false;
  window.location.replace(clean);
  return true;
}
