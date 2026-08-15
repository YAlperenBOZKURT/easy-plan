import type { AdminStats, AdminUser, Card, Habit, User } from './types.ts';
import { logger } from './logger.ts';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public payload?: unknown,
    public requestId?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function safePath(path: string): string {
  return path.replace(/\/(invite|reset)\/[^/?]+/g, '/$1/[redacted]');
}

let refreshPromise: Promise<void> | undefined;

const isPublicAuthRequest = (path: string) =>
  /^\/auth\/(login|token|refresh|invite\/|forgot|reset\/)/.test(path);

async function refreshWebSession(): Promise<void> {
  const clientRequestId = requestId();
  const response = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-request-id': clientRequestId },
  });
  if (response.ok) return;
  const data = await response.json().catch(() => undefined);
  const code = (data as { error?: string } | undefined)?.error ?? `http_${response.status}`;
  throw new ApiError(response.status, code, data, response.headers.get('x-request-id') ?? clientRequestId);
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  // Fastify, `application/json` içerik tipi taşıyan gövdesiz istekleri 400 ile
  // reddeder. Bu nedenle JSON başlığını yalnızca gerçekten bir gövde varsa ekle.
  // Özellikle DELETE çağrıları gövdesizdir.
  const headers = new Headers(init.headers);
  const clientRequestId = requestId();
  headers.set('x-request-id', clientRequestId);
  if (init.body !== undefined && init.body !== null && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

  const startedAt = performance.now();
  let res: Response;
  try {
    res = await fetch(BASE + path, { credentials: 'same-origin', ...init, headers });
  } catch (error) {
    logger.error('api_network_error', error, {
      method: init.method ?? 'GET', path: safePath(path), requestId: clientRequestId,
    });
    throw error;
  }

  const serverRequestId = res.headers.get('x-request-id') ?? clientRequestId;
  logger.debug('api_request_completed', {
    method: init.method ?? 'GET', path: safePath(path), status: res.status,
    durationMs: Math.round(performance.now() - startedAt), requestId: serverRequestId,
  });

  if (res.status === 401 && allowRefresh && !isPublicAuthRequest(path)) {
    refreshPromise ??= refreshWebSession().finally(() => {
      refreshPromise = undefined;
    });
    await refreshPromise;
    return request<T>(path, init, false);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const code = (data as { error?: string } | undefined)?.error ?? `http_${res.status}`;
    logger.warn('api_request_rejected', {
      method: init.method ?? 'GET', path: safePath(path), status: res.status,
      code, requestId: serverRequestId,
    });
    throw new ApiError(res.status, code, data, serverRequestId);
  }
  return data as T;
}

export const api = {
  /* kimlik */
  me: () => request<{ user: User }>('/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  forgot: (email: string) =>
    request<{ ok: true }>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  readInvite: (token: string) => request<{ email: string }>(`/auth/invite/${token}`),
  acceptInvite: (token: string, name: string, password: string) =>
    request<{ user: User }>(`/auth/invite/${token}`, {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>(`/auth/reset/${token}`, { method: 'POST', body: JSON.stringify({ password }) }),
  updateMe: (patch: Record<string, unknown>) =>
    request<{ user: User }>('/me', { method: 'PATCH', body: JSON.stringify(patch) }),

  /* kartlar */
  cards: (from: string, to: string) => request<{ cards: Card[] }>(`/cards?from=${from}&to=${to}`),
  createCard: (input: Record<string, unknown>) =>
    request<{ card: Card }>('/cards', { method: 'POST', body: JSON.stringify(input) }),
  updateCard: (id: string, patch: Record<string, unknown>) =>
    request<{ card: Card }>(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCard: (id: string) => request<{ ok: true }>(`/cards/${id}`, { method: 'DELETE' }),
  moveCard: (id: string, body: { day: string; beforeId?: string | null; afterId?: string | null }) =>
    request<{ card: Card }>(`/cards/${id}/move`, { method: 'PATCH', body: JSON.stringify(body) }),

  /* görseller */
  uploadImages: (cardId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append('file', file);
    return request<{ images: Card['images'] }>(`/cards/${cardId}/images`, { method: 'POST', body: form });
  },
  deleteImage: (id: string) => request<{ ok: true }>(`/images/${id}`, { method: 'DELETE' }),

  /* davranışlar */
  habits: () => request<{ habits: Habit[] }>('/habits'),
  createHabit: (input: Record<string, unknown>) =>
    request<{ habit: Habit; createdCards: number }>('/habits', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateHabit: (id: string, patch: Record<string, unknown>) =>
    request<{ habit: Habit }>(`/habits/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteHabit: (id: string) => request<{ ok: true }>(`/habits/${id}`, { method: 'DELETE' }),

  /* mail */
  testMail: () => request<{ ok: true }>('/mail/test', { method: 'POST' }),
  mailLog: () =>
    request<{
      entries: { id: string; kind: string; subject: string; status: string; error: string | null; created_at: string }[];
      mailEnabled: boolean;
    }>('/mail/log'),

  /* yönetim */
  adminStats: () => request<AdminStats>('/admin/stats'),
  adminUsers: () => request<{ users: AdminUser[] }>('/admin/users'),
  adminInvites: () =>
    request<{ invites: { email: string; expires_at: string; created_at: string }[] }>('/admin/invites'),
  createInvite: (email: string) =>
    request<{ url: string; expiresAt: string; mailSent: boolean; mailError?: string }>('/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  updateUser: (id: string, patch: { role?: string; active?: boolean }) =>
    request<{ ok: true }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id: string) => request<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' }),
  adminMailLog: () =>
    request<{
      entries: {
        id: string;
        kind: string;
        to_addr: string;
        status: string;
        error: string | null;
        created_at: string;
        user_email: string | null;
      }[];
    }>('/admin/mail-log'),
};
