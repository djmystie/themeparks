const BASE = 'https://api.themeparks.wiki/v1';

export class ApiError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// Conditional requests, bounded memory, and coalescing keep calls well below API limits.
export class ThemeParksApi {
  constructor({ fetchImpl = fetch, apiKey = process.env.THEMEPARKS_API_KEY, now = Date.now } = {}) {
    this.fetch = fetchImpl;
    this.apiKey = apiKey;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
    this.blockedUntil = 0;
  }

  async get(path, params = {}, ttl = 300_000) {
    const url = new URL(`${BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return cached.data;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.blockedUntil > this.now()) {
      throw new ApiError('API rate limit: wait before retrying.', 429, Math.ceil((this.blockedUntil - this.now()) / 1000));
    }
    const request = this.request(url, cached, ttl).then(entry => {
      if (entry.store) {
        if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, entry);
      } else this.cache.delete(key);
      return entry.data;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  async request(url, cached, ttl) {
    const headers = { Accept: 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    let response;
    try {
      response = await this.fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ApiError('ThemeParks.wiki could not be reached within the request timeout. Try again later.', 503);
    }
    if (response.status !== 304 && !response.ok) {
      const body = await response.json().catch(() => ({}));
      const rawRetry = response.headers.get('retry-after');
      const retry = Number(body.retryAfter ?? rawRetry);
      const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : 60;
      if (response.status === 429) this.blockedUntil = this.now() + retryAfter * 1000;
      const reason = response.status === 403
        ? 'History access denied: the requested dates may exceed your API plan history window.'
        : response.status === 429 ? 'API rate limit reached.'
          : `ThemeParks.wiki returned HTTP ${response.status}.`;
      throw new ApiError(reason, response.status, response.status === 429 ? retryAfter : undefined);
    }
    const control = response.headers.get('cache-control') ?? '';
    const maxAge = control.match(/(?:^|,)\s*max-age=(\d+)/i);
    const duration = /no-store|no-cache/i.test(control) ? 0 : Math.max(ttl, Number(maxAge?.[1] ?? 0) * 1000);
    let data;
    try { data = response.status === 304 ? cached?.data : await response.json(); }
    catch { throw new ApiError('API returned invalid JSON.', 502); }
    if (!data || typeof data !== 'object') throw new ApiError('API returned an invalid response.', 502);
    return { data, etag: response.headers.get('etag') ?? cached?.etag, expires: this.now() + duration, store: !/no-store/i.test(control) };
  }
}
