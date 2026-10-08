/**
 * Shared HTTP plumbing for every upstream client: a request budget, retry with
 * exponential backoff on 429/5xx, and injectable fetch/sleep so tests can run
 * against recorded fixtures without touching the network.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class BudgetExhaustedError extends Error {
  constructor(
    readonly limit: number,
    readonly label: string,
  ) {
    super(`${label} request budget of ${limit} exhausted`);
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * The upstream rate limiter said no (HTTP 429) and asked us to wait longer than
 * is worth waiting inside one run. Jobs treat this like an exhausted budget:
 * checkpoint and resume on the next run.
 */
export class RateLimitedError extends BudgetExhaustedError {
  constructor(
    readonly url: string,
    readonly retryAfterMs: number | null,
  ) {
    super(0, 'upstream rate limit');
    this.name = 'RateLimitedError';
    this.message = `Rate limited by ${new URL(url).host}${retryAfterMs ? `; retry after ${Math.round(retryAfterMs / 1000)}s` : ''}`;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${redactUrl(url)}`);
    this.name = 'HttpError';
  }
}

/**
 * Counts requests against a hard cap. Every attempt (including retries) costs one
 * request, because that is how the upstream rate limiter counts them.
 */
export class RequestBudget {
  private usedCount = 0;
  private forcedExhausted = false;

  constructor(
    readonly limit: number = Number.POSITIVE_INFINITY,
    readonly label = 'api',
  ) {}

  get used(): number {
    return this.usedCount;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.usedCount);
  }

  get exhausted(): boolean {
    return this.forcedExhausted || this.usedCount >= this.limit;
  }

  /** Mark the budget spent (e.g. the upstream said 429), so callers pause. */
  exhaust(): void {
    this.forcedExhausted = true;
  }

  /** Reserve one request or throw if the cap is reached. */
  take(): void {
    if (this.exhausted) throw new BudgetExhaustedError(this.limit, this.label);
    this.usedCount += 1;
  }
}

export interface HttpOptions {
  fetch?: FetchLike;
  budget?: RequestBudget;
  /** Attempts per request, including the first. Default 5. */
  maxAttempts?: number;
  /** Base delay for exponential backoff in ms. Default 1000. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay in ms. Default 60000. */
  maxDelayMs?: number;
  /**
   * A 429 is retried only if the server asks for a wait no longer than this
   * (Retry-After). Otherwise RateLimitedError is thrown at once. Default 30000.
   */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  headers?: Record<string, string>;
  userAgent?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry-After as milliseconds (seconds or an HTTP date), or null. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Remove API keys from URLs before they appear in logs or errors. */
export function redactUrl(url: string): string {
  return url.replace(/([?&]api_key=)[^&]*/gi, '$1***');
}

export class HttpClient {
  readonly budget: RequestBudget;
  private readonly fetchImpl: FetchLike;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly headers: Record<string, string>;

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.budget = options.budget ?? new RequestBudget();
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.headers = {
      'user-agent': options.userAgent ?? 'civic-tracker (+https://github.com/jackhale98/opencongress)',
      ...options.headers,
    };
  }

  /** GET a URL, retrying 429 and 5xx with exponential backoff. Other 4xx throw immediately. */
  async get(url: string, accept = 'application/json'): Promise<Response> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      this.budget.take();
      let response: Response | undefined;
      let networkError: unknown;
      try {
        response = await this.fetchImpl(url, { headers: { ...this.headers, accept } });
      } catch (error) {
        networkError = error;
      }

      if (response && response.ok) return response;

      if (response?.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        await response.body?.cancel().catch(() => undefined);
        if (retryAfterMs === null || retryAfterMs > this.maxRetryAfterMs || attempt >= this.maxAttempts) {
          this.budget.exhaust();
          throw new RateLimitedError(url, retryAfterMs);
        }
        await this.sleep(retryAfterMs);
        continue;
      }

      const retryable = response ? isRetryableStatus(response.status) : true;
      if (!retryable || attempt >= this.maxAttempts) {
        if (response) {
          const body = await response.text().catch(() => '');
          throw new HttpError(response.status, url, body.slice(0, 500));
        }
        throw networkError instanceof Error ? networkError : new Error(String(networkError));
      }

      // Drain the body so the connection can be reused.
      if (response) await response.body?.cancel().catch(() => undefined);
      await this.sleep(this.backoffDelay(attempt, response));
    }
  }

  async getJson<T>(url: string): Promise<T> {
    const response = await this.get(url, 'application/json');
    return (await response.json()) as T;
  }

  async getText(url: string, accept = 'text/plain'): Promise<string> {
    const response = await this.get(url, accept);
    return response.text();
  }

  private backoffDelay(attempt: number, response?: Response): number {
    const retryAfter = parseRetryAfter(response?.headers.get('retry-after') ?? null);
    if (retryAfter !== null) return Math.min(retryAfter, this.maxDelayMs);
    const exponential = this.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * this.baseDelayMs * 0.25;
    return Math.min(exponential + jitter, this.maxDelayMs);
  }
}
