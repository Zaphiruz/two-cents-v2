import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from './api';

describe('request', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    fetchSpy.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockReset();
  });

  function jsonResponse(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  }

  it('always sends credentials: include', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
    await request('/api/foo');
    const init = fetchSpy.mock.calls[0]![1]!;
    expect(init.credentials).toBe('include');
  });

  it('parses JSON success responses', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ hello: 'world' }));
    const result = await request<{ hello: string }>('/api/foo');
    expect(result).toEqual({ hello: 'world' });
  });

  it('sets Content-Type for POST with body and serializes JSON', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    await request('/api/foo', { method: 'POST', body: { a: 1 } });
    const init = fetchSpy.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('does not set Content-Type for GET', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    await request('/api/foo');
    const init = fetchSpy.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBeNull();
  });

  it('throws ApiError on non-2xx responses with the parsed body and status', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ message: 'nope' }, { status: 400 }),
    );

    await expect(request('/api/foo')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'nope',
      body: { message: 'nope' },
    });

    fetchSpy.mockResolvedValue(
      jsonResponse({ error: 'not_authenticated' }, { status: 401 }),
    );
    const err = await request('/api/auth/me').catch((e) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });
});
