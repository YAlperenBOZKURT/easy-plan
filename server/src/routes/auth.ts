import type { FastifyInstance } from 'fastify';
import { db } from '../db.ts';
import { userDto } from '../dto.ts';
import { nowIso } from '../ids.ts';
import { button, escapeHtml, layout, sendMail } from '../mailer.ts';
import {
  attachUser,
  clearAuthCookies,
  consumeInvite,
  consumePasswordReset,
  createPasswordReset,
  createSession,
  createUser,
  DUMMY_PASSWORD_HASH,
  destroyAllSessions,
  findUserByEmail,
  readInvite,
  refreshTokenFromRequest,
  requireUser,
  revokeRefreshToken,
  revokeSession,
  rotateSession,
  setAuthCookies,
  setPassword,
  verifyPassword,
} from '../auth.ts';

/** Long passphrases are preferred over brittle composition rules. */
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 256;
const validNewPassword = (password: string) =>
  password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD;

const strict = {
  bodyLimit: 16 * 1024,
  config: {
    rateLimit: { max: 10, timeWindow: '5 minutes' },
  },
};

export async function authRoutes(app: FastifyInstance) {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });

  /* ------------------------------------------------------------------ giriş */

  const login = async (email: unknown, password: unknown) => {
    const candidate = typeof password === 'string' ? password : '';
    if (candidate.length > MAX_PASSWORD) return undefined;
    const user = typeof email === 'string' ? findUserByEmail(email) : undefined;
    const passwordMatches = verifyPassword(candidate, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || user.active !== 1 || !passwordMatches) return undefined;
    return user;
  };

  app.post<{ Body: { email?: string; password?: string } }>(
    '/auth/login',
    strict,
    async (req, reply) => {
      const user = await login(req.body?.email ?? '', req.body?.password ?? '');
      if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
      const pair = createSession(app, user.id, String(req.headers['user-agent'] ?? ''));
      setAuthCookies(reply, pair);
      return { user: userDto(user) };
    },
  );

  /** Flutter/native istemci için aynı kimlik, çerez yerine Bearer jetonu. */
  app.post<{ Body: { email?: string; password?: string; device?: string } }>(
    '/auth/token',
    strict,
    async (req, reply) => {
      const user = await login(req.body?.email ?? '', req.body?.password ?? '');
      if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
      const pair = createSession(
        app,
        user.id,
        typeof req.body?.device === 'string'
          ? req.body.device
          : String(req.headers['user-agent'] ?? ''),
      );
      return { ...pair, user: userDto(user) };
    },
  );

  app.post<{ Body: { refreshToken?: string } }>('/auth/refresh', strict, async (req, reply) => {
    const bearerRefresh = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : undefined;
    const nativeRefresh = req.body?.refreshToken ?? bearerRefresh;
    const refreshToken = refreshTokenFromRequest(req, nativeRefresh);
    if (!refreshToken) return reply.code(401).send({ error: 'refresh_required' });

    const pair = rotateSession(app, refreshToken);
    if (!pair) {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: 'invalid_refresh' });
    }

    if (typeof nativeRefresh === 'string') return pair;
    setAuthCookies(reply, pair);
    return { ok: true, accessExpiresInSeconds: pair.accessExpiresInSeconds };
  });

  app.post<{ Body: { refreshToken?: string } }>('/auth/logout', async (req, reply) => {
    const refreshToken = refreshTokenFromRequest(req, req.body?.refreshToken);
    if (refreshToken) revokeRefreshToken(app, refreshToken);
    else {
      await attachUser(req);
      if (req.authSessionId) revokeSession(req.authSessionId);
    }
    clearAuthCookies(reply);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireUser }, async (req) => ({ user: userDto(req.user!) }));

  /* ------------------------------------------------------------------ davet */

  app.get<{ Params: { token: string } }>('/auth/invite/:token', strict, async (req, reply) => {
    const invite = readInvite(req.params.token);
    if (!invite.valid) return reply.code(410).send({ error: invite.reason });
    return { email: invite.email };
  });

  app.post<{ Params: { token: string }; Body: { name?: string; password?: string } }>(
    '/auth/invite/:token',
    strict,
    async (req, reply) => {
      const invite = readInvite(req.params.token);
      if (!invite.valid) return reply.code(410).send({ error: invite.reason });

      const password = req.body?.password ?? '';
      if (!validNewPassword(password)) return reply.code(400).send({ error: 'weak_password' });
      if (findUserByEmail(invite.email)) return reply.code(409).send({ error: 'email_taken' });

      const user = createUser({
        email: invite.email,
        password,
        name: typeof req.body?.name === 'string' ? req.body.name : '',
      });
      consumeInvite(req.params.token);
      const pair = createSession(app, user.id, String(req.headers['user-agent'] ?? ''));
      setAuthCookies(reply, pair);
      return { user: userDto(user) };
    },
  );

  /* -------------------------------------------------------- şifre sıfırlama */

  app.post<{ Body: { email?: string } }>('/auth/forgot', strict, async (req) => {
    const user = findUserByEmail(req.body?.email ?? '');
    // Cevap her durumda aynı: hangi adreslerin kayıtlı olduğu sızdırılmaz.
    if (user && user.active === 1) {
      const reset = createPasswordReset(user.id);
      await sendMail({
        to: user.email,
        subject: 'Planner · şifre sıfırlama',
        kind: 'reset',
        userId: user.id,
        html: layout(
          'Şifreni sıfırla',
          `<p style="margin:0;font-size:14px;line-height:1.6">Merhaba${user.name ? ' ' + escapeHtml(user.name) : ''},
           aşağıdaki bağlantıyla yeni bir şifre belirleyebilirsin. Bağlantı 1 saat geçerlidir ve
           yalnızca bir kez kullanılabilir.</p>${button('Yeni şifre belirle', reset.url)}
           <p style="margin:18px 0 0;font-size:13px;color:#8a8a8e">Bu isteği sen yapmadıysan bu maili yok sayabilirsin.</p>`,
        ),
      });
    }
    return { ok: true };
  });

  app.post<{ Params: { token: string }; Body: { password?: string } }>(
    '/auth/reset/:token',
    strict,
    async (req, reply) => {
      const password = req.body?.password ?? '';
      if (!validNewPassword(password)) return reply.code(400).send({ error: 'weak_password' });
      const userId = consumePasswordReset(req.params.token);
      if (!userId) return reply.code(410).send({ error: 'invalid_token' });
      setPassword(userId, password); // mevcut tüm oturumları da düşürür
      return { ok: true };
    },
  );

  /* ------------------------------------------------------------------ profil */

  app.patch<{
    Body: {
      name?: string;
      timezone?: string;
      dailySummary?: boolean;
      currentPassword?: string;
      newPassword?: string;
    };
  }>('/me', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = req.body ?? {};

    if (body.newPassword !== undefined) {
      if (!verifyPassword(body.currentPassword ?? '', user.password_hash)) {
        return reply.code(403).send({ error: 'wrong_password' });
      }
      if (!validNewPassword(body.newPassword)) return reply.code(400).send({ error: 'weak_password' });
      setPassword(user.id, body.newPassword);
      const pair = createSession(app, user.id, String(req.headers['user-agent'] ?? ''));
      setAuthCookies(reply, pair); // bu cihaz açık kalsın, diğerleri düşsün
    }

    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (typeof body.name === 'string') {
      sets.push('name = ?');
      values.push(body.name.trim().slice(0, 80));
    }
    if (typeof body.timezone === 'string' && isValidTimezone(body.timezone)) {
      sets.push('timezone = ?');
      values.push(body.timezone);
    }
    if (typeof body.dailySummary === 'boolean') {
      sets.push('daily_summary = ?');
      values.push(body.dailySummary ? 1 : 0);
    }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      values.push(nowIso(), user.id);
      db().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    const fresh = db().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    return { user: userDto(fresh as never) };
  });

  app.post('/me/logout-all', { preHandler: requireUser }, async (req, reply) => {
    destroyAllSessions(req.user!.id);
    clearAuthCookies(reply);
    return { ok: true };
  });
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('tr-TR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
