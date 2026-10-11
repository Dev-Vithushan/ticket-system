/**
 * Thin fetch wrapper for the REST API.
 *  - Cookies carry the session (HttpOnly; never readable here).
 *  - The CSRF token (readable cookie) is echoed in X-CSRF-Token on every unsafe request.
 *  - A 401 triggers one silent refresh-token rotation, then the request is retried.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } & Record<string, unknown>,
  ) {
    super(message);
  }
  /** First validation message for a field, if any. */
  field(name: string) {
    return this.details?.fieldErrors?.[name]?.[0];
  }
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; unreadCount?: number };
}

const BASE = '/api';
let csrfToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

function readCsrfCookie() {
  const m = document.cookie.match(/(?:^|; )tms_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string> {
  csrfToken = readCsrfCookie() ?? csrfToken;
  if (csrfToken) return csrfToken;
  const res = await fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' });
  const body = await res.json();
  csrfToken = body.data.csrfToken as string;
  return csrfToken;
}

async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': await ensureCsrf() },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

export function toQuery(params?: Query) {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  /** Do not attempt token refresh (used by auth endpoints). */
  noRefresh?: boolean;
  raw?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = await ensureCsrf();

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${toQuery(opts.query)}`, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
  }

  if (res.status === 401 && !opts.noRefresh && !retried) {
    if (await refreshSession()) return request<T>(path, opts, true);
    onSessionExpired?.();
  }
  if (res.status === 403 && !retried) {
    const peek = await res.clone().json().catch(() => null);
    if (peek?.error?.code === 'CSRF_INVALID') {
      csrfToken = null;
      return request<T>(path, opts, true);
    }
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
    return res as unknown as T;
  }
  const payload = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = payload?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'HTTP_ERROR', err.message ?? `Request failed (${res.status})`, err.details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  auth: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body, noRefresh: true }),
  /** Downloads a file through the authenticated session and saves it with the server-provided name. */
  async download(path: string, query?: Query) {
    const res = await request<Response>(path, { query, raw: true });
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
    const name = match ? decodeURIComponent(match[1]) : 'download';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = err.details?.fieldErrors;
    if (err.code === 'VALIDATION_ERROR' && fields) {
      const first = Object.entries(fields).find(([, v]) => v?.length);
      if (first) return `${first[0]}: ${first[1][0]}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
