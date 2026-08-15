import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { cardDto, habitDto } from '../dto.ts';
import { storeFor } from './cards.ts';

/**
 * Delta senkron ucu — Flutter istemcisi için.
 *
 * `since` verilmezse tam kopya döner. İstemci aldığı `serverTime`'ı saklar ve bir
 * sonraki çağrıda onu gönderir; aradaki değişiklikler ve silinenler (tombstone)
 * gelir. Senkron birimi karttır: resim veya hatırlatma değişince kartın
 * updated_at'i de tazelendiği için tek akış yeterlidir.
 */
export async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get<{ Querystring: { since?: string } }>('/changes', async (req, reply) => {
    const since = req.query.since ?? '1970-01-01T00:00:00.000Z';
    if (Number.isNaN(Date.parse(since))) return reply.code(400).send({ error: 'invalid_since' });

    const store = storeFor(req);
    const serverTime = new Date().toISOString();

    const cards = store.cards.changedSince(since);
    const ids = cards.map((c) => c.id);
    const images = store.images.forCards(ids);
    const reminders = store.reminders.forCards(ids);

    return {
      serverTime,
      cards: cards.map((card) => cardDto(card, images, reminders)),
      habits: store.habits.changedSince(since).map(habitDto),
      deletions: store.deletions.since(since).map((d) => ({
        entity: d.entity,
        id: d.id,
        deletedAt: d.deleted_at,
      })),
    };
  });
}
