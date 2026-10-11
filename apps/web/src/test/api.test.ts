import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage, toQuery } from '@/lib/api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.cookie = 'tms_csrf=csrf-123; path=/';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('serialises query params, skipping empty values and joining arrays', () => {
    expect(toQuery({ a: 1, b: '', c: undefined, d: ['X', 'Y'], e: [], f: false })).toBe('?a=1&d=X%2CY&f=false');
    expect(toQuery({})).toBe('');
  });

  it('sends the CSRF header on unsafe requests only', async () => {
    fetchMock.mockResolvedValue(json(200, { data: {} }));
    await api.get('/tickets');
    await api.post('/tickets', { subject: 'x' });
    const [, getInit] = fetchMock.mock.calls[0];
    const [, postInit] = fetchMock.mock.calls[1];
    expect(getInit.headers['X-CSRF-Token']).toBeUndefined();
    expect(postInit.headers['X-CSRF-Token']).toBe('csrf-123');
    expect(postInit.credentials).toBe('same-origin');
    expect(JSON.parse(postInit.body)).toEqual({ subject: 'x' });
  });

  it('refreshes the session once on 401 and retries the request', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }))
      .mockResolvedValueOnce(json(200, { data: { refreshed: true } }))
      .mockResolvedValueOnce(json(200, { data: { ok: 1 } }));
    const res = await api.get<{ data: { ok: number } }>('/auth/me');
    expect(res.data.ok).toBe(1);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/auth/me', '/api/auth/refresh', '/api/auth/me']);
  });

  it('surfaces structured API errors with field details', async () => {
    fetchMock.mockResolvedValue(json(422, { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { fieldErrors: { subject: ['Too short'] } } } }));
    const err = (await api.post('/tickets', {}).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.field('subject')).toBe('Too short');
    expect(errorMessage(err)).toBe('subject: Too short');
  });

  it('maps network failures to a friendly error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api.get('/tickets').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('NETWORK_ERROR');
  });
});
