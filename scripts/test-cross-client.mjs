import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(join(tmpdir(), 'easy-plan-e2e-'));
// Set every external-delivery setting before importing server configuration.
Object.assign(process.env, {
  NODE_ENV: 'test', DATA_DIR: dataDir, APP_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: randomUUID() + randomUUID(),
  JWT_REFRESH_SECRET: randomUUID() + randomUUID(),
  SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '', MAIL_FROM: '',
  VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '',
  ALLOWED_ORIGINS: '', DEFAULT_TZ: 'Europe/Istanbul', DEFAULT_CARD_TIME: '09:00',
});
const [{ buildServer }, { createUser }, { closeDb }, { api }, { logger }] = await Promise.all([
  import('../server/src/index.ts'), import('../server/src/auth.ts'),
  import('../server/src/db.ts'), import('../web/src/lib/api.ts'), import('../web/src/lib/logger.ts'),
]);
const app = await buildServer({ logger: false, docs: false });
const networkFetch = globalThis.fetch;
const cookies = new Map();
let control;
let child;
let timer;
// Only browser transport is adapted: use the actual web api module over TCP,
// retaining Set-Cookie and adding the same trusted Origin as a browser.
globalThis.fetch = async (input, init = {}) => {
  assert.equal(typeof input, 'string');
  assert.ok(input.startsWith('/api/v1/'));
  const headers = new Headers(init.headers);
  headers.set('origin', 'http://localhost:5173');
  if (cookies.size) headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  const response = await networkFetch(new URL(input, address), { ...init, headers });
  for (const cookie of response.headers.getSetCookie()) {
    const [name, value] = cookie.split(';', 1)[0].split('=');
    cookies.set(name, value);
  }
  return response;
};
logger.debug = () => {}; // Keep test output focused; warnings still report failures.
let address;
try {
  address = await app.listen({ host: '127.0.0.1', port: 0 });
  const password = randomUUID() + 'Aa1!';
  createUser({ email: 'web@example.test', password });
  const editor = createUser({ email: 'native@example.test', password, timezone: 'America/New_York' });
  await api.login('web@example.test', password);
  const { board } = await api.createBoard('Cross-client release check');
  await api.addBoardMember(board.id, editor.email, 'editor');
  api.setActiveBoard(board.id);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const { card } = await api.createCard({ day, title: 'Web initial', note: '', reminders: [60], startTime: '12:00' });
  const controlPath = `/${randomUUID()}`;
  const actions = new Set();
  control = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== controlPath) {
      response.writeHead(404).end(); return;
    }
    try {
      let input = '';
      for await (const chunk of request) input += chunk;
      const { action, ...args } = JSON.parse(input);
      let result = { ok: true };
      switch (action) {
        case 'edit': {
          const current = (await api.cards(day, day)).cards.find(c => c.id === card.id);
          assert.ok(current);
          result = await api.updateCard(card.id, { title: args.title, updatedAt: current.updatedAt });
          break;
        }
        case 'assert-card': {
          const current = (await api.cards(day, day)).cards.find(c => c.id === args.id);
          assert.ok(current);
          assert.equal(current.title, args.title);
          if (args.done !== undefined) assert.equal(current.done, args.done);
          break;
        }
        case 'assert-image': {
          const current = (await api.cards(day, day)).cards.find(c => c.id === args.id);
          assert.ok(current);
          assert.equal(current.images.length, args.count);
          if (args.count) {
            const image = await networkFetch(new URL(current.images[0].url, address), {
              headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
            });
            assert.equal(image.status, 200);
            assert.equal(image.headers.get('content-type'), 'image/webp');
          }
          break;
        }
        case 'archive': result = await api.archiveCard(card.id); break;
        case 'restore': result = await api.restoreCard(card.id); break;
        case 'delete': await api.deleteCard(card.id); break;
        case 'revoke': await api.removeBoardMember(board.id, editor.id); break;
        default: throw new Error(`Unknown control action: ${action}`);
      }
      actions.add(action);
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      console.error(error);
      response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'control_assertion_failed' }));
    }
  });
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
  const controlUrl = `http://127.0.0.1:${control.address().port}${controlPath}`;
  const args = ['test', '--no-pub', 'e2e/cross_client_test.dart', '--reporter', 'expanded'];
  child = process.platform === 'win32'
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'flutter', ...args], {
        cwd: join(root, 'mobile'), stdio: 'inherit', env: { ...process.env,
          E2E_URL: address, E2E_CONTROL: controlUrl, E2E_EMAIL: editor.email,
          E2E_PASSWORD: password, E2E_BOARD: board.id, E2E_CARD: card.id, E2E_DAY: day },
      })
    : spawn('flutter', args, { cwd: join(root, 'mobile'), stdio: 'inherit', env: { ...process.env,
        E2E_URL: address, E2E_CONTROL: controlUrl, E2E_EMAIL: editor.email,
        E2E_PASSWORD: password, E2E_BOARD: board.id, E2E_CARD: card.id, E2E_DAY: day } });
  const exitCode = await new Promise((resolve, reject) => {
    timer = setTimeout(() => { child.kill(); reject(new Error('Cross-client test exceeded 3 minutes')); }, 180_000);
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(exitCode, 0, 'Flutter cross-client scenario failed');
  for (const action of ['edit', 'assert-card', 'assert-image', 'archive', 'restore', 'delete', 'revoke']) {
    assert.ok(actions.has(action), `Missing cross-client assertion: ${action}`);
  }
  console.log('PASS: actual web API + Flutter Store/API over HTTP, offline conflict recovery, images, lifecycle and revocation.');
} finally {
  clearTimeout(timer);
  globalThis.fetch = networkFetch;
  await app.close();
  if (control) await new Promise(resolve => control.close(resolve));
  closeDb();
  // Only the fresh mkdtemp directory owned by this run is removed.
  assert.equal(dirname(resolve(dataDir)), resolve(tmpdir()));
  assert.ok(basename(dataDir).startsWith('easy-plan-e2e-'));
  await rm(dataDir, { recursive: true, force: true });
}
