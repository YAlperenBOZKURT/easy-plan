import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api.ts';

describe('API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('JSON isteğine içerik tipi ve izleme kimliği ekler', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'server-1' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.login('user@example.com', 'secret123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('/api/v1/auth/login');
    expect(init.credentials).toBe('same-origin');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-request-id')).toBeTruthy();
  });

  it('gövdesiz DELETE isteğine JSON içerik tipi eklemez', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.deleteCard('card-1');

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  it('sunucu hata kodunu ve request id değerini ApiError ile taşır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_credentials' }), {
          status: 401,
          headers: { 'content-type': 'application/json', 'x-request-id': 'server-error-9' },
        }),
      ),
    );

    const error = await api.login('user@example.com', 'wrong').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'invalid_credentials', requestId: 'server-error-9' });
  });

  it('access JWT süresi dolunca refresh cookie ile sessizce yeniler ve isteği tekrarlar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user: { id: 'u1', email: 'user@example.com', name: 'User', role: 'user' } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.me();

    expect(result.user.email).toBe('user@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/auth/refresh');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).credentials).toBe('same-origin');
  });
});
