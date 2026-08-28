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

  await t.test('Bearer JWT ile kart arama endpointi sonuç ve doğrulama hatası döndürür', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { email: 'jwt-user@example.com', password: 'correct horse battery staple' },
    });
    const accessToken = login.json().accessToken as string;
    const authorization = `Bearer ${accessToken}`;
    const cardDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const card = await app.inject({
      method: 'POST',
      url: '/api/v1/cards',
      headers: { authorization },
      payload: { day: cardDay, title: 'Roadmap toplantısı', note: 'Arama endpointi' },
    });
    assert.equal(card.statusCode, 201);

    const search = await app.inject({
      method: 'GET',
      url: '/api/v1/cards/search?q=road',
      headers: { authorization },
    });
    assert.equal(search.statusCode, 200);
    assert.equal(search.json().cards.length, 1);
    assert.equal(search.json().cards[0].title, 'Roadmap toplantısı');

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/cards/search?q=a',
      headers: { authorization },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, 'validation_error');
  });

  await t.test('şablona multipart görsel yüklenir ve şablon cevabında görünür', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { email: 'jwt-user@example.com', password: 'correct horse battery staple' },
    });
    const authorization = `Bearer ${login.json().accessToken as string}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/card-templates',
      headers: { authorization },
      payload: { name: 'Görselli şablon', title: 'Kontrol' },
    });
    assert.equal(created.statusCode, 201);
    const templateId = created.json().template.id as string;
    const boundary = 'planner-template-image-boundary';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/card-templates/${templateId}/images`,
      headers: { authorization, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    assert.equal(upload.statusCode, 201, upload.body);
    assert.equal(upload.json().images.length, 1);

    const templates = await app.inject({
      method: 'GET',
      url: '/api/v1/card-templates',
      headers: { authorization },
    });
    const template = templates.json().templates.find((item: { id: string }) => item.id === templateId);
    assert.equal(template.images.length, 1);
  });

  await t.test('dışa aktarılan JSON dosyası multipart olarak tekrar içe alınır', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/token',
      payload: { email: 'jwt-user@example.com', password: 'correct horse battery staple' },
    });
    const authorization = `Bearer ${login.json().accessToken as string}`;
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const boundary = 'planner-json-import-boundary';
    const json = Buffer.from(JSON.stringify({
      version: 1,
      cards: [{ day, title: 'İçe aktarılan kart', tags: [], checklist: [], reminders: [] }],
    }));
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="easy-plan.json"\r\nContent-Type: application/json\r\n\r\n`,
      ),
      json,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/data/import',
      headers: { authorization, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    assert.equal(imported.statusCode, 201, imported.body);
    assert.equal(imported.json().imported, 1, imported.body);

    const exported = await app.inject({
      method: 'GET',
      url: `/api/v1/data/export?format=json&from=${day}&to=${day}`,
      headers: { authorization },
    });
    assert.equal(exported.statusCode, 200);
    assert.match(String(exported.headers['content-disposition']), /easy-plan.*\.json/);
    assert.ok(exported.json().cards.some((card: { title: string }) => card.title === 'İçe aktarılan kart'));
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
