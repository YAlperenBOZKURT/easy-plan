import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { layout, sendMail } from '../mailer.ts';
import { processReminders, sendDailySummaries } from '../scheduler.ts';

export async function mailRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** SMTP ayarının gerçekten çalıştığını anında görmek için. */
  app.post('/mail/test', async (req, reply) => {
    if (!config.mailEnabled) return reply.code(503).send({ error: 'mail_disabled' });
    const user = req.user!;
    const result = await sendMail({
      to: user.email,
      subject: 'Planner · test maili',
      kind: 'test',
      userId: user.id,
      html: layout(
        'Mail ayarların çalışıyor',
        `<p style="margin:0;font-size:14px;line-height:1.6">Bu bir test mailidir. Hatırlatmaların bu adrese
         (<strong>${user.email}</strong>) bu görünümde gelecek.</p>`,
      ),
    });
    if (!result.sent) return reply.code(502).send({ error: 'send_failed', detail: result.error });
    return { ok: true };
  });

  /** Kullanıcı yalnızca kendi gönderim geçmişini görür. */
  app.get<{ Querystring: { limit?: string } }>('/mail/log', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const entries = db()
      .prepare(
        `SELECT id, kind, to_addr, subject, status, error, created_at FROM mail_log
         WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(req.user!.id, limit);
    return { entries, mailEnabled: config.mailEnabled };
  });

  /** Zamanlayıcıyı elle tetikler — geliştirme ve doğrulama için. */
  app.post('/mail/run-scheduler', async () => ({
    reminders: await processReminders(),
    summaries: await sendDailySummaries(),
  }));
}
