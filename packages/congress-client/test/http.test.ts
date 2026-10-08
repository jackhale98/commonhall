import { describe, expect, it } from 'vitest';
import {
  BudgetExhaustedError,
  HttpClient,
  HttpError,
  RateLimitedError,
  RequestBudget,
  parseRetryAfter,
  redactUrl,
} from '../src/http.ts';
import { json, noSleep } from './helpers.ts';

function sequence(...responses: (() => Response)[]) {
  let i = 0;
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const next = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return next();
  };
  return { fetch, calls };
}

describe('HttpClient', () => {
  it('retries 5xx with backoff, then succeeds', async () => {
    const delays: number[] = [];
    const { fetch, calls } = sequence(
      () => new Response('oops', { status: 500 }),
      () => new Response('oops', { status: 503 }),
      () => json({ ok: true }),
    );
    const client = new HttpClient({ fetch, sleep: async (ms) => void delays.push(ms), baseDelayMs: 100 });
    await expect(client.getJson('https://example.test/a')).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeGreaterThanOrEqual(200);
    expect(client.budget.used).toBe(3);
  });

  it('fails fast on 429 without a short Retry-After (hourly quota spent)', async () => {
    const { fetch, calls } = sequence(() => new Response('slow down', { status: 429 }));
    const client = new HttpClient({ fetch, sleep: noSleep });
    const error = await client.getJson('https://api.example.test/a?api_key=k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toBeInstanceOf(BudgetExhaustedError); // jobs pause and resume
    expect(calls).toHaveLength(1);
    expect(client.budget.exhausted).toBe(true);
    await expect(client.getJson('https://api.example.test/b')).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(calls).toHaveLength(1);

    const long = sequence(() => new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
    const client2 = new HttpClient({ fetch: long.fetch, sleep: noSleep });
    await expect(client2.getJson('https://api.example.test/a')).rejects.toBeInstanceOf(RateLimitedError);
    expect(long.calls).toHaveLength(1);
  });

  it('honours a short Retry-After on 429', async () => {
    const delays: number[] = [];
    const { fetch } = sequence(
      () => new Response('', { status: 429, headers: { 'retry-after': '7' } }),
      () => json({}),
    );
    const client = new HttpClient({ fetch, sleep: async (ms) => void delays.push(ms) });
    await client.getJson('https://example.test/a');
    expect(delays).toEqual([7000]);
  });

  it('does not retry other 4xx', async () => {
    const { fetch, calls } = sequence(() => new Response('missing', { status: 404 }));
    const client = new HttpClient({ fetch, sleep: noSleep });
    await expect(client.getJson('https://example.test/a?api_key=secret')).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
    });
    expect(calls).toHaveLength(1);
  });

  it('gives up after maxAttempts and keeps the key out of the message', async () => {
    const { fetch, calls } = sequence(() => new Response('down', { status: 502 }));
    const client = new HttpClient({ fetch, sleep: noSleep, maxAttempts: 3 });
    const error = await client.getJson('https://example.test/a?api_key=secret').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as Error).message).not.toContain('secret');
    expect(calls).toHaveLength(3);
  });

  it('retries network errors', async () => {
    let n = 0;
    const fetch = async () => {
      n += 1;
      if (n === 1) throw new TypeError('fetch failed');
      return json({ n });
    };
    const client = new HttpClient({ fetch, sleep: noSleep });
    await expect(client.getJson('https://example.test')).resolves.toEqual({ n: 2 });
  });

  it('stops when the budget is exhausted, counting retries', async () => {
    const { fetch } = sequence(
      () => new Response('', { status: 500 }),
      () => json({}),
      () => json({}),
    );
    const budget = new RequestBudget(2, 'congress');
    const client = new HttpClient({ fetch, sleep: noSleep, budget });
    await client.getJson('https://example.test/1');
    expect(budget.used).toBe(2);
    expect(budget.exhausted).toBe(true);
    await expect(client.getJson('https://example.test/2')).rejects.toBeInstanceOf(BudgetExhaustedError);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('7')).toBe(7000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('nonsense')).toBeNull();
    const inAMinute = new Date(Date.now() + 60_000).toUTCString();
    expect(parseRetryAfter(inAMinute)).toBeGreaterThan(50_000);
  });
});

describe('redactUrl', () => {
  it('hides api keys', () => {
    expect(redactUrl('https://x.test/a?format=json&api_key=abc123&b=1')).toBe(
      'https://x.test/a?format=json&api_key=***&b=1',
    );
  });
});
