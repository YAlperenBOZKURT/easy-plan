import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { newId, nowIso } from '../ids.ts';
import { requireUser } from '../auth.ts';

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

const validSubscription = (body: SubscriptionBody | undefined) => {
  if (!body || typeof body.endpoint !== 'string' || body.endpoint.length > 2048) return undefined;
  if (typeof body.keys?.p256dh !== 'string' || body.keys.p256dh.length > 512) return undefined;
  if (typeof body.keys?.auth !== 'string' || body.keys.auth.length > 512) return undefined;
  try {
    if (new URL(body.endpoint).protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  return { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth };
};

export async function pushRoutes(app: FastifyInstance) {
  app.get('/push/config', { preHandler: requireUser }, async (req) => {
    const row = db()
      .prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?')
      .get(req.user!.id) as { count: number };
    return {
      enabled: config.webPushEnabled,
      publicKey: config.webPushEnabled ? config.webPush.publicKey : null,
      subscriptions: row.count,
    };
  });

  app.post<{ Body: SubscriptionBody }>('/push/subscriptions', { preHandler: requireUser }, async (req, reply) => {
    if (!config.webPushEnabled) return reply.code(503).send({ error: 'push_disabled' });
    const subscription = validSubscription(req.body);
    if (!subscription) return reply.code(400).send({ error: 'invalid_subscription' });

    const now = nowIso();
    db().prepare(
      `INSERT INTO push_subscriptions
         (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`,
    ).run(
      newId(),
      req.user!.id,
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      String(req.headers['user-agent'] ?? '').slice(0, 500),
      now,
      now,
    );
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Body: { endpoint?: unknown } }>(
    '/push/subscriptions',
    { preHandler: requireUser },
    async (req, reply) => {
      if (typeof req.body?.endpoint !== 'string') {
        return reply.code(400).send({ error: 'invalid_subscription' });
      }
      db().prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
        .run(req.user!.id, req.body.endpoint);
      return { ok: true };
    },
  );
}
