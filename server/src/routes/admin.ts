import { statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { nowIso } from '../ids.ts';
import { button, escapeHtml, layout, sendMail } from '../mailer.ts';
import { createInvite, findUserByEmail, requireAdmin } from '../auth.ts';
import { removeUserFiles } from '../storage.ts';

/**
 * Yönetim uçları. Bilinçli sınır: burada yalnızca SAYILAR ve hesap bilgileri
 * döner — hiçbir uç kart başlığı, notu veya resmini göstermez.
 */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/stats', async () => {
    const one = <T>(sql: string, ...params: (string | number)[]) =>
      db().prepare(sql).get(...params) as T;

    const users = one<{ n: number }>('SELECT COUNT(*) AS n FROM users').n;
    const activeUsers = one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM users WHERE last_login_at > ?',
      new Date(Date.now() - 30 * 86_400_000).toISOString(),
    ).n;
    const cards = one<{ n: number }>('SELECT COUNT(*) AS n FROM cards').n;
    const habits = one<{ n: number }>('SELECT COUNT(*) AS n FROM habits').n;
    const images = one<{ n: number; bytes: number }>(
      'SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM card_images',
    );
    const pendingReminders = one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM card_reminders WHERE sent_at IS NULL',
    ).n;

    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const mailsByDay = db()
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, status, COUNT(*) AS n
         FROM mail_log WHERE created_at > ? GROUP BY day, status ORDER BY day`,
      )
      .all(since) as { day: string; status: string; n: number }[];

    let dbBytes = 0;
    try {
      dbBytes = statSync(config.dbFile).size;
    } catch {
      dbBytes = 0;
    }

    return {
      users,
      activeUsers,
      cards,
      habits,
      images: images.n,
      imageBytes: images.bytes,
      pendingReminders,
      dbBytes,
      mailEnabled: config.mailEnabled,
      mailsByDay,
    };
  });

  app.get('/admin/users', async () => {
    const rows = db()
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.timezone, u.active, u.daily_summary,
                u.created_at, u.last_login_at,
                (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id)              AS cards,
                (SELECT COUNT(*) FROM habits h WHERE h.user_id = u.id)             AS habits,
                (SELECT COUNT(*) FROM card_images i WHERE i.user_id = u.id)        AS images,
                (SELECT COALESCE(SUM(bytes), 0) FROM card_images i WHERE i.user_id = u.id) AS bytes,
                (SELECT COUNT(*) FROM card_reminders r WHERE r.user_id = u.id AND r.sent_at IS NULL) AS pending_reminders,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id)           AS sessions
         FROM users u ORDER BY u.created_at`,
      )
      .all() as Record<string, unknown>[];

    return {
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        timezone: r.timezone,
        active: r.active === 1,
        dailySummary: r.daily_summary === 1,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        cards: r.cards,
        habits: r.habits,
        images: r.images,
        bytes: r.bytes,
        pendingReminders: r.pending_reminders,
        sessions: r.sessions,
      })),
    };
  });

  /* ----------------------------------------------------------------- davetler */

  app.get('/admin/invites', async () => {
    const rows = db()
      .prepare(
        `SELECT email, expires_at, used_at, created_at FROM invites
         WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
      )
      .all(nowIso()) as Record<string, unknown>[];
    return { invites: rows };
  });

  app.post<{ Body: { email?: string } }>('/admin/invites', async (req, reply) => {
    const email = (req.body?.email ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'invalid_email' });
    if (findUserByEmail(email)) return reply.code(409).send({ error: 'email_taken' });

    const invite = createInvite(email, req.user!.id);
    const result = await sendMail({
      to: email,
      subject: 'Planner · davet',
      kind: 'invite',
      html: layout(
        'Planner davetin hazır',
        `<p style="margin:0;font-size:14px;line-height:1.6">${escapeHtml(req.user!.name || 'Bir arkadaşın')} seni Planner'a davet etti.
         Aşağıdaki bağlantıdan kendi şifreni belirleyip hemen kullanmaya başlayabilirsin.
         Bağlantı 7 gün geçerli.</p>${button('Hesabımı oluştur', invite.url)}`,
      ),
    });

    // Mail kapalıysa (veya gönderilemediyse) linki elle paylaşabilmek için döneriz.
    return { url: invite.url, expiresAt: invite.expiresAt, mailSent: result.sent, mailError: result.error };
  });

  /* --------------------------------------------------------------- kullanıcılar */

  app.patch<{ Params: { id: string }; Body: { role?: string; active?: boolean } }>(
    '/admin/users/:id',
    async (req, reply) => {
      const target = db().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
        | { id: string; role: string }
        | undefined;
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (target.id === req.user!.id) return reply.code(400).send({ error: 'cannot_modify_self' });

      const sets: string[] = [];
      const values: (string | number)[] = [];
      if (req.body?.role === 'admin' || req.body?.role === 'user') {
        sets.push('role = ?');
        values.push(req.body.role);
      }
      if (typeof req.body?.active === 'boolean') {
        sets.push('active = ?');
        values.push(req.body.active ? 1 : 0);
        if (!req.body.active) db().prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      }
      if (sets.length === 0) return reply.code(400).send({ error: 'nothing_to_update' });

      // Sistemde en az bir admin kalmalı.
      if (req.body?.role === 'user' && countAdmins() <= 1 && target.role === 'admin') {
        return reply.code(400).send({ error: 'last_admin' });
      }

      sets.push('updated_at = ?');
      values.push(nowIso(), target.id);
      db().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const target = db().prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; role: string }
      | undefined;
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.id === req.user!.id) return reply.code(400).send({ error: 'cannot_delete_self' });
    if (target.role === 'admin' && countAdmins() <= 1) return reply.code(400).send({ error: 'last_admin' });

    // Kartlar, resim satırları, hatırlatmalar ve oturumlar ON DELETE CASCADE ile gider;
    // diskteki dosyaları ayrıca temizliyoruz.
    db().prepare('DELETE FROM users WHERE id = ?').run(target.id);
    await removeUserFiles(target.id);
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string } }>('/admin/mail-log', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const rows = db()
      .prepare(
        `SELECT m.id, m.kind, m.to_addr, m.subject, m.status, m.error, m.created_at, u.email AS user_email
         FROM mail_log m LEFT JOIN users u ON u.id = m.user_id
         ORDER BY m.created_at DESC LIMIT ?`,
      )
      .all(limit);
    return { entries: rows };
  });
}

function countAdmins(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as {
    n: number;
  }).n;
}
