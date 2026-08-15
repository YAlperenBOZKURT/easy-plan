import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const testDataDir = mkdtempSync(join(tmpdir(), 'planner-jwt-test-'));
process.env.DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-with-at-least-thirty-two-characters';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-with-at-least-thirty-two-characters';

const [{ buildServer }, { createUser }, { closeDb }] = await Promise.all([
  import('../src/index.ts'),
  import('../src/auth.ts'),
  import('../src/db.ts'),
]);

const trustedOrigin = 'http://localhost:5173';

function cookieValue(headers: Record<string, string | string[] | number | undefined>, name: string): string {
  const raw = headers['set-cookie'];
  const values = (Array.isArray(raw) ? raw : [raw]).map((value) => String(value ?? ''));
  for (const value of values) {
    const match = value.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  throw new Error(`Cookie not found: ${name}`);
}

const cookieHeader = (access?: string, refresh?: string) =>
  [access && `planner_access=${encodeURIComponent(access)}`, refresh && `planner_refresh=${encodeURIComponent(refresh)}`]
    .filter(Boolean)
    .join('; ');

function jwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  assert.ok(payload);
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

test('JWT access/refresh güvenlik akışı', async (t) => {
  const app = await buildServer({ logger: false, docs: true });
  await app.ready();
  createUser({ email: 'jwt-user@example.com', password: 'correct horse battery staple' });

  t.after(async () => {
    await app.close();
    closeDb();
    rmSync(testDataDir, { recursive: true, force: true });
  });

  await t.test('web login HttpOnly JWT cookie üretir ve access token kullanıcıyı doğrular', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: trustedOrigin },
      payload: { email: 'jwt-user@example.com', password: 'correct horse battery staple' },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.headers['cache-control'], 'no-store');
    const access = cookieValue(login.headers, 'planner_access');
    const refresh = cookieValue(login.headers, 'planner_refresh');
    assert.equal(access.split('.').length, 3);
    assert.equal(refresh.split('.').length, 3);
    assert.equal(jwtPayload(access).tokenType, 'access');
    assert.equal(jwtPayload(refresh).tokenType, 'refresh');
    assert.match(String(login.headers['set-cookie']), /HttpOnly/i);
    assert.match(String(login.headers['set-cookie']), /SameSite=Strict/i);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader(access) },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, 'jwt-user@example.com');
  });

  await t.test('web refresh Origin kontrolü uygular, token döndürür ve reuse oturumu iptal eder', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'jwt-user@example.com', password: 'correct horse battery staple' },
    });
    const oldRefresh = cookieValue(login.headers, 'planner_refresh');

    const csrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(undefined, oldRefresh) },
    });
    assert.equal(csrf.statusCode, 403);
    assert.equal(csrf.json().error, 'untrusted_origin');

    const rotated = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(undefined, oldRefresh), origin: trustedOrigin },
    });
    assert.equal(rotated.statusCode, 200);
    const nextAccess = cookieValue(rotated.headers, 'planner_access');
    const nextRefresh = cookieValue(rotated.headers, 'planner_refresh');
    assert.notEqual(nextRefresh, oldRefresh);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(undefined, oldRefresh), origin: trustedOrigin },
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.json().error, 'invalid_refresh');

    const revokedAccess = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookieHeader(nextAccess) },
    });
    assert.equal(revokedAccess.statusCode, 401);
  });

  await t.test('native Bearer JWT yenilenir ve logout ile anında revoke edilir', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { email: 'jwt-user@example.com', password: 'correct horse battery staple', device: 'test' },
    });
    assert.equal(login.statusCode, 200);
    const first = login.json();
    assert.equal(jwtPayload(first.accessToken).tokenType, 'access');
    assert.equal(jwtPayload(first.refreshToken).tokenType, 'refresh');

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    assert.equal(refreshed.statusCode, 200);
    const second = refreshed.json();
    assert.notEqual(second.refreshToken, first.refreshToken);

    const headerRefresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { authorization: `Bearer ${second.refreshToken}` },
    });
    assert.equal(headerRefresh.statusCode, 200);
    const third = headerRefresh.json();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${third.accessToken}` },
    });
    assert.equal(me.statusCode, 200);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${third.accessToken}` },
      payload: { refreshToken: third.refreshToken },
    });
    assert.equal(logout.statusCode, 200);

    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${third.accessToken}` },
    });
    assert.equal(revoked.statusCode, 401);
  });
});
