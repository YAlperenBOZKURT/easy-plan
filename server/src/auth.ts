import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { db, transaction } from './db.ts';
import { hashToken, newId, newToken, nowIso } from './ids.ts';
import type { Role, UserRow } from './types.ts';

/* ------------------------------------------------------------------ şifreler */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Unknown accounts still execute one scrypt derivation, reducing login timing
// differences that could otherwise help enumerate registered email addresses.
export const DUMMY_PASSWORD_HASH = hashPassword('planner-dummy-password-never-used-for-login');

/* ----------------------------------------------------------------- kullanıcı */

export const findUserByEmail = (email: string): UserRow | undefined =>
  db().prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as UserRow | undefined;

export const findUserById = (id: string): UserRow | undefined =>
  db().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

export function createUser(input: {
  email: string;
  password: string;
  name?: string;
  role?: Role;
  timezone?: string;
}): UserRow {
  const id = newId();
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO users (id, email, name, password_hash, role, timezone, daily_summary,
                          last_summary_day, active, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, 1, NULL, ?, ?)`,
    )
    .run(
      id,
      input.email.trim(),
      input.name?.trim() ?? '',
      hashPassword(input.password),
      input.role ?? 'user',
      input.timezone ?? config.defaultTz,
      at,
      at,
    );
  return findUserById(id)!;
}

export function setPassword(userId: string, password: string) {
  db()
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(password), nowIso(), userId);
  destroyAllSessions(userId); // şifre değişince tüm cihazlardan çıkılır
}

/** İlk açılışta .env'deki adminle hesabı kurar; hesap zaten varsa dokunmaz. */
export function seedAdmin(log: Pick<FastifyBaseLogger, 'info' | 'warn'> = console) {
  if (!config.adminEmail || !config.adminPassword) return;

  const existing = findUserByEmail(config.adminEmail);
  if (existing) {
    // Sık karşılaşılan tuzak: .env'deki ADMIN_PASSWORD sonradan değiştirilir ama
    // hesap zaten var olduğu için kayıtlı şifre eskisi kalır.
    if (!verifyPassword(config.adminPassword, existing.password_hash)) {
      log.warn(
        { email: config.adminEmail },
        `Admin şifresi .env'deki ADMIN_PASSWORD ile aynı değil. ` +
          `ADMIN_PASSWORD yalnızca ilk hesap oluşturulurken kullanılır; değiştirmek için npm run sifre kullan.`,
      );
    }
    return;
  }

  if (config.adminPassword.length < 12 || config.adminPassword.length > 256) {
    throw new Error('ADMIN_PASSWORD must contain between 12 and 256 characters when creating the first admin.');
  }

  createUser({
    email: config.adminEmail,
    password: config.adminPassword,
    name: 'Admin',
    role: 'admin',
  });
  log.info({ email: config.adminEmail }, 'initial admin created');
}

/* ----------------------------------------------------------- JWT sessions */

export const ACCESS_COOKIE = 'planner_access';
export const REFRESH_COOKIE = 'planner_refresh';

export interface JwtClaims {
  sub: string;
  sid: string;
  jti: string;
  tokenType: 'access' | 'refresh';
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSeconds: number;
  refreshExpiresInSeconds: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    namespaces: 'access' | 'refresh';
    payload: JwtClaims;
    user: UserRow | undefined;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    authSessionId?: string;
  }
}

function signPair(
  app: FastifyInstance,
  userId: string,
  sessionId: string,
  refreshExpiresInSeconds = config.jwt.refreshDays * 86_400,
): TokenPair {
  const base = { sub: userId, sid: sessionId };
  return {
    accessToken: app.jwt.access.sign({ ...base, jti: newId(), tokenType: 'access' }),
    refreshToken: app.jwt.refresh.sign(
      { ...base, jti: newId(), tokenType: 'refresh' },
      { expiresIn: `${refreshExpiresInSeconds}s` },
    ),
    accessExpiresInSeconds: config.jwt.accessMinutes * 60,
    refreshExpiresInSeconds,
  };
}

function validClaims(value: unknown, tokenType: JwtClaims['tokenType']): value is JwtClaims {
  if (!value || typeof value !== 'object') return false;
  const claims = value as Partial<JwtClaims>;
  return (
    claims.tokenType === tokenType &&
    typeof claims.sub === 'string' &&
    typeof claims.sid === 'string' &&
    typeof claims.jti === 'string'
  );
}

export function createSession(app: FastifyInstance, userId: string, device = ''): TokenPair {
  const sessionId = newId();
  const pair = signPair(app, userId, sessionId);
  const now = new Date();
  const expires = new Date(now.getTime() + config.jwt.refreshDays * 86_400_000);
  db()
    .prepare(
      `INSERT INTO sessions
         (id, user_id, refresh_token_hash, device, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      userId,
      hashToken(pair.refreshToken),
      device.slice(0, 200),
      now.toISOString(),
      now.toISOString(),
      expires.toISOString(),
    );
  db().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), userId);
  return pair;
}

export function rotateSession(app: FastifyInstance, refreshToken: string): TokenPair | undefined {
  let claims: unknown;
  try {
    claims = app.jwt.refresh.verify(refreshToken);
  } catch {
    return undefined;
  }
  if (!validClaims(claims, 'refresh')) return undefined;

  const database = db();
  const tokenHash = hashToken(refreshToken);
  const row = database
    .prepare('SELECT id, user_id, refresh_token_hash, expires_at FROM sessions WHERE id = ?')
    .get(claims.sid) as
    | { id: string; user_id: string; refresh_token_hash: string; expires_at: string }
    | undefined;

  if (!row || row.user_id !== claims.sub || row.refresh_token_hash !== tokenHash) {
    const replay = database
      .prepare('SELECT session_id FROM session_refresh_history WHERE token_hash = ?')
      .get(tokenHash) as { session_id: string } | undefined;
    if (replay) database.prepare('DELETE FROM sessions WHERE id = ?').run(replay.session_id);
    return undefined;
  }

  const user = findUserById(row.user_id);
  if (!user || user.active !== 1 || Date.parse(row.expires_at) <= Date.now()) {
    database.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return undefined;
  }

  // Rotation does not extend the original absolute session lifetime.
  const remainingSeconds = Math.max(1, Math.ceil((Date.parse(row.expires_at) - Date.now()) / 1_000));
  const next = signPair(app, row.user_id, row.id, remainingSeconds);
  transaction(database, () => {
    // Keep the most recently consumed token for rotation-reuse detection.
    database.prepare('DELETE FROM session_refresh_history WHERE session_id = ?').run(row.id);
    database
      .prepare('INSERT INTO session_refresh_history (token_hash, session_id, consumed_at) VALUES (?, ?, ?)')
      .run(tokenHash, row.id, nowIso());
    database
      .prepare('UPDATE sessions SET refresh_token_hash = ?, last_seen_at = ? WHERE id = ?')
      .run(hashToken(next.refreshToken), nowIso(), row.id);
  });
  return next;
}

export function revokeSession(sessionId: string) {
  db().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function revokeRefreshToken(app: FastifyInstance, refreshToken: string) {
  try {
    const claims = app.jwt.refresh.verify(refreshToken);
    if (validClaims(claims, 'refresh')) revokeSession(claims.sid);
  } catch {
    // Logout is idempotent; an invalid or expired token is already unusable.
  }
}

export function destroyAllSessions(userId: string) {
  db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function setAuthCookies(reply: FastifyReply, pair: TokenPair) {
  const secure = config.appUrl.startsWith('https://');
  reply.setCookie(ACCESS_COOKIE, pair.accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: pair.accessExpiresInSeconds,
  });
  reply.setCookie(REFRESH_COOKIE, pair.refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/api/v1/auth',
    maxAge: pair.refreshExpiresInSeconds,
  });
}

export function clearAuthCookies(reply: FastifyReply) {
  const secure = config.appUrl.startsWith('https://');
  reply.clearCookie(ACCESS_COOKIE, { path: '/', sameSite: 'strict', secure });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth', sameSite: 'strict', secure });
}

export function accessTokenFromRequest(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[ACCESS_COOKIE];
}

export function refreshTokenFromRequest(req: FastifyRequest, bodyToken?: unknown): string | undefined {
  if (typeof bodyToken === 'string' && bodyToken.length > 0) return bodyToken;
  return req.cookies?.[REFRESH_COOKIE];
}

/** Resolves a signed access JWT and checks that its revocable session still exists. */
export async function attachUser(req: FastifyRequest) {
  const token = accessTokenFromRequest(req);
  if (!token) return;
  try {
    const claims = req.server.jwt.access.verify(token);
    if (!validClaims(claims, 'access')) return;
    const session = db()
      .prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
      .get(claims.sid) as { user_id: string; expires_at: string } | undefined;
    if (!session || session.user_id !== claims.sub || Date.parse(session.expires_at) <= Date.now()) return;
    const user = findUserById(claims.sub);
    if (!user || user.active !== 1) return;
    req.user = user;
    req.authSessionId = claims.sid;
    db().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), claims.sid);
  } catch {
    // Invalid, expired, or incorrectly signed JWTs are treated as unauthenticated.
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  await attachUser(req);
  if (!req.user) {
    reply.header('www-authenticate', 'Bearer realm="planner", error="invalid_token"');
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await attachUser(req);
  if (!req.user) {
    reply.header('www-authenticate', 'Bearer realm="planner", error="invalid_token"');
    return reply.code(401).send({ error: 'unauthorized' });
  }
  if (req.user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
}

/* -------------------------------------------------- davet ve şifre sıfırlama */

export function createInvite(email: string, createdBy: string) {
  const token = newToken();
  const expires = new Date(Date.now() + config.inviteDays * 86_400_000).toISOString();
  db()
    .prepare(
      `INSERT INTO invites (token_hash, email, created_by, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    )
    .run(hashToken(token), email.trim(), createdBy, expires, nowIso());
  return { token, url: `${config.appUrl}/davet/${token}`, expiresAt: expires };
}

export function readInvite(token: string) {
  const row = db()
    .prepare('SELECT * FROM invites WHERE token_hash = ?')
    .get(hashToken(token)) as
    | { token_hash: string; email: string; expires_at: string; used_at: string | null }
    | undefined;
  if (!row) return { valid: false as const, reason: 'not_found' as const };
  if (row.used_at) return { valid: false as const, reason: 'used' as const };
  if (new Date(row.expires_at).getTime() < Date.now())
    return { valid: false as const, reason: 'expired' as const };
  return { valid: true as const, email: row.email };
}

export function consumeInvite(token: string) {
  db().prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(nowIso(), hashToken(token));
}

export function createPasswordReset(userId: string) {
  const token = newToken();
  const expires = new Date(Date.now() + config.resetHours * 3_600_000).toISOString();
  db()
    .prepare(
      `INSERT INTO password_resets (token_hash, user_id, expires_at, used_at, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
    )
    .run(hashToken(token), userId, expires, nowIso());
  return { token, url: `${config.appUrl}/sifre-sifirla/${token}`, expiresAt: expires };
}

export function consumePasswordReset(token: string): string | undefined {
  const row = db()
    .prepare('SELECT * FROM password_resets WHERE token_hash = ?')
    .get(hashToken(token)) as
    | { user_id: string; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) return undefined;
  db().prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(nowIso(), hashToken(token));
  return row.user_id;
}
