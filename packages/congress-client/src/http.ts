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
    return this.usedCount >= this.limit;
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
  sleep?: (ms: number) => Promise<void>;
  headers?: Record<string, string>;
  userAgent?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly headers: Record<string, string>;

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.budget = options.budget ?? new RequestBudget();
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
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
    const retryAfter = response?.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.min(seconds * 1000, this.maxDelayMs);
    }
    const exponential = this.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * this.baseDelayMs * 0.25;
    return Math.min(exponential + jitter, this.maxDelayMs);
  }
}
