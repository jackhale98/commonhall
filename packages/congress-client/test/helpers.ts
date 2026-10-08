import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../src/http.ts';

export function fixture(path: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url)), 'utf8');
}

export function fixtureJson<T = unknown>(path: string): T {
  return JSON.parse(fixture(path)) as T;
}

export interface Route {
  match: (url: URL) => boolean;
  respond: (url: URL) => Response | Promise<Response>;
}

/** A fetch that replays fixtures by URL and records every request it saw. */
export function replayFetch(routes: Route[]): FetchLike & { calls: URL[] } {
  const calls: URL[] = [];
  const fn = (async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const route = routes.find((r) => r.match(url));
    if (!route) return new Response(`no fixture for ${url.pathname}${url.search}`, { status: 404 });
    return route.respond(url);
  }) as FetchLike & { calls: URL[] };
  fn.calls = calls;
  return fn;
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export const noSleep = async () => undefined;
