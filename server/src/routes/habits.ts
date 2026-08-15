import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { db } from '../db.ts';
import { habitDto } from '../dto.ts';
import { materializeHabit, runMaintenance } from '../maintenance.ts';
import { sanitizeOffsets } from '../reminders.ts';
import { isValidTime } from '../time.ts';
import { CARD_COLORS } from '../types.ts';
import { storeFor } from './cards.ts';

const parseWeekdays = (input: unknown): number[] => {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort();
};

export async function habitRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/habits', async (req) => ({ habits: storeFor(req).habits.list().map(habitDto) }));

  app.post<{ Body: Record<string, unknown> }>('/habits', async (req, reply) => {
    const body = req.body ?? {};
    const weekdays = parseWeekdays(body.weekdays);
    if (weekdays.length === 0) return reply.code(400).send({ error: 'weekdays_required' });

    for (const key of ['startTime', 'endTime'] as const) {
      const value = body[key];
      if (value != null && value !== '' && !(typeof value === 'string' && isValidTime(value))) {
        return reply.code(400).send({ error: 'invalid_time', field: key });
      }
    }
    const color = typeof body.color === 'string' && (CARD_COLORS as readonly string[]).includes(body.color)
      ? body.color
      : 'red';

    const store = storeFor(req);
    const habit = store.habits.create({
      title: typeof body.title === 'string' ? body.title.slice(0, 200) : '',
      note: typeof body.note === 'string' ? body.note.slice(0, 5000) : '',
      startTime: typeof body.startTime === 'string' && body.startTime ? body.startTime : null,
      endTime: typeof body.endTime === 'string' && body.endTime ? body.endTime : null,
      color,
      weekdays,
      reminders: sanitizeOffsets(body.reminders),
    });

    // Kartlar hemen üretilir: kullanıcı kaydeder kaydetmez takvimde görsün.
    const created = materializeHabit(db(), req.user!, habit);
    return reply.code(201).send({ habit: habitDto(store.habits.get(habit.id)!), createdCards: created });
  });

  /**
   * Davranış düzenlemesi mevcut kartlara DOKUNMAZ; yalnızca bundan sonra
   * üretilecek kartları etkiler. Her kart bağımsız yaşar.
   */
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/habits/:id',
    async (req, reply) => {
      const store = storeFor(req);
      if (!store.habits.get(req.params.id)) return reply.code(404).send({ error: 'not_found' });
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};

      if (typeof body.title === 'string') patch.title = body.title.slice(0, 200);
      if (typeof body.note === 'string') patch.note = body.note.slice(0, 5000);
      for (const key of ['startTime', 'endTime'] as const) {
        if (!(key in body)) continue;
        const value = body[key];
        if (value === null || value === '') patch[key] = null;
        else if (typeof value === 'string' && isValidTime(value)) patch[key] = value;
        else return reply.code(400).send({ error: 'invalid_time', field: key });
      }
      if (typeof body.color === 'string' && (CARD_COLORS as readonly string[]).includes(body.color)) {
        patch.color = body.color;
      }
      if ('weekdays' in body) {
        const weekdays = parseWeekdays(body.weekdays);
        if (weekdays.length === 0) return reply.code(400).send({ error: 'weekdays_required' });
        patch.weekdays = weekdays;
      }
      if ('reminders' in body) patch.reminders = sanitizeOffsets(body.reminders);
      if (typeof body.active === 'boolean') patch.active = body.active;

      const habit = store.habits.update(req.params.id, patch)!;
      return { habit: habitDto(habit) };
    },
  );

  /** Davranışı siler; ondan türemiş kartlar takvimde olduğu gibi kalır. */
  app.delete<{ Params: { id: string } }>('/habits/:id', async (req, reply) => {
    if (!storeFor(req).habits.remove(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.post('/maintenance/run', async () => runMaintenance());
}
