import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireUser } from '../auth.ts';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { cardDto } from '../dto.ts';
import { repo, type Repo } from '../repo.ts';
import { applyReminders, sanitizeOffsets } from '../reminders.ts';
import { indexBetween } from '../sorting.ts';
import { removeImageFiles } from '../storage.ts';
import { addYears, isValidDay, isValidInstant, isValidTime, today } from '../time.ts';
import { CARD_COLORS, CARD_PRIORITIES } from '../types.ts';
import { isChecklistComplete, sanitizeChecklist } from '../checklist.ts';

export const storeFor = (req: FastifyRequest): Repo => repo(db(), req.user!.id);

/** Gezinme ve veri penceresi: bugünden ±1 yıl. */
function withinWindow(day: string, tz: string): boolean {
  const now = today(tz);
  return day >= addYears(now, -config.windowYears) && day <= addYears(now, config.windowYears);
}

function readCardBody(body: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  if (body === undefined) return { out, errors };

  if (typeof body.day === 'string') {
    if (!isValidDay(body.day)) errors.push('day');
    else out.day = body.day;
  }
  if (typeof body.title === 'string') out.title = body.title.slice(0, 200);
  if (typeof body.note === 'string') out.note = body.note.slice(0, 5000);
  for (const key of ['startTime', 'endTime'] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === '') out[key] = null;
    else if (typeof value === 'string' && isValidTime(value)) out[key] = value;
    else errors.push(key);
  }
  if (typeof body.color === 'string') {
    if ((CARD_COLORS as readonly string[]).includes(body.color)) out.color = body.color;
    else errors.push('color');
  }
  if (typeof body.done === 'boolean') out.done = body.done;
  if (typeof body.priority === 'string') {
    if ((CARD_PRIORITIES as readonly string[]).includes(body.priority)) out.priority = body.priority;
    else errors.push('priority');
  }
  if ('deadlineAt' in body) {
    if (body.deadlineAt === null || body.deadlineAt === '') out.deadlineAt = null;
    else if (typeof body.deadlineAt === 'string' && isValidInstant(body.deadlineAt)) {
      out.deadlineAt = new Date(body.deadlineAt).toISOString();
    } else errors.push('deadlineAt');
  }
  if ('checklist' in body) {
    const checklist = sanitizeChecklist(body.checklist);
    if (checklist.valid) {
      out.checklist = checklist.items;
      // Checklist'i olan kartta durum maddelerden türetilir: son tik kartı
      // tamamlar, herhangi bir tiki geri almak kartı yeniden açar.
      if (checklist.items.length > 0) out.done = isChecklistComplete(checklist.items);
    }
    else errors.push('checklist');
  }
  // Yalnızca sıfırlamaya izin verilir: "elle taşındı" işaretini sürükleme koyar.
  if (body.manualSort === false) out.manualSort = false;
  return { out, errors };
}

export async function cardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** Belirli bir tarih aralığındaki kartlar, resim ve hatırlatmalarıyla. */
  app.get<{ Querystring: { from?: string; to?: string } }>('/cards', async (req, reply) => {
    const { from, to } = req.query;
    if (!from || !to || !isValidDay(from) || !isValidDay(to)) {
      return reply.code(400).send({ error: 'invalid_range' });
    }
    const store = storeFor(req);
    const cards = store.cards.range(from, to);
    const ids = cards.map((c) => c.id);
    const images = store.images.forCards(ids);
    const reminders = store.reminders.forCards(ids);
    return { cards: cards.map((card) => cardDto(card, images, reminders)) };
  });

  app.post<{ Body: Record<string, unknown> }>('/cards', async (req, reply) => {
    const { out, errors } = readCardBody(req.body);
    if (errors.length > 0) return reply.code(400).send({ error: 'invalid_fields', fields: errors });
    if (typeof out.day !== 'string') return reply.code(400).send({ error: 'day_required' });
    if (!withinWindow(out.day, req.user!.timezone)) return reply.code(400).send({ error: 'out_of_window' });

    const store = storeFor(req);
    // İstemcinin ürettiği id kabul edilir: çevrimdışı oluşturulan kart senkronda çakışmaz.
    const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
    if (id && store.cards.get(id)) return reply.code(409).send({ error: 'already_exists' });

    const card = store.cards.create({ id, ...(out as { day: string }) });
    const offsets = sanitizeOffsets(req.body?.reminders);
    if (offsets.length > 0) applyReminders(store, card, req.user!, offsets);

    return reply.code(201).send({ card: cardDto(card, [], store.reminders.forCard(card.id)) });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/cards/:id',
    async (req, reply) => {
      const store = storeFor(req);
      const current = store.cards.get(req.params.id);
      if (!current) return reply.code(404).send({ error: 'not_found' });

      // Çevrimdışı senkron: elimizdeki sürüm daha yeniyse gelen yazma yok sayılır.
      const clientUpdatedAt = req.body?.updatedAt;
      if (typeof clientUpdatedAt === 'string' && current.updated_at > clientUpdatedAt) {
        return reply.code(409).send({
          error: 'stale_write',
          card: cardDto(current, store.images.forCard(current.id), store.reminders.forCard(current.id)),
        });
      }

      const { out, errors } = readCardBody(req.body);
      if (errors.length > 0) return reply.code(400).send({ error: 'invalid_fields', fields: errors });
      if (typeof out.day === 'string' && !withinWindow(out.day, req.user!.timezone)) {
        return reply.code(400).send({ error: 'out_of_window' });
      }

      const card = store.cards.update(req.params.id, out)!;

      // Gün ya da saat değiştiyse hatırlatmaların zamanı yeniden hesaplanır.
      const offsets =
        req.body && 'reminders' in req.body
          ? sanitizeOffsets(req.body.reminders)
          : store.reminders.forCard(card.id).map((r) => r.offset_minutes);
      applyReminders(store, card, req.user!, offsets);

      return { card: cardDto(card, store.images.forCard(card.id), store.reminders.forCard(card.id)) };
    },
  );

  app.delete<{ Params: { id: string } }>('/cards/:id', async (req, reply) => {
    const store = storeFor(req);
    if (!store.cards.get(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const images = store.cards.remove(req.params.id);
    await removeImageFiles(images);
    return { ok: true };
  });

  /**
   * Sürükle-bırak: kart hedef günde, verilen iki komşunun arasına yerleşir ve
   * manual_sort=1 olur — saati değişse bile bu sıra korunur.
   */
  app.patch<{
    Params: { id: string };
    Body: { day?: string; beforeId?: string | null; afterId?: string | null };
  }>('/cards/:id/move', async (req, reply) => {
    const store = storeFor(req);
    const card = store.cards.get(req.params.id);
    if (!card) return reply.code(404).send({ error: 'not_found' });

    const day = req.body?.day ?? card.day;
    if (!isValidDay(day)) return reply.code(400).send({ error: 'invalid_day' });
    if (!withinWindow(day, req.user!.timezone)) return reply.code(400).send({ error: 'out_of_window' });

    const before = req.body?.beforeId ? store.cards.get(req.body.beforeId) : undefined;
    const after = req.body?.afterId ? store.cards.get(req.body.afterId) : undefined;
    const sortIndex = indexBetween(before?.sort_index ?? null, after?.sort_index ?? null);

    const moved = store.cards.update(card.id, { day, sortIndex, manualSort: true })!;
    if (day !== card.day) {
      applyReminders(
        store,
        moved,
        req.user!,
        store.reminders.forCard(moved.id).map((r) => r.offset_minutes),
      );
    }
    return { card: cardDto(moved, store.images.forCard(moved.id), store.reminders.forCard(moved.id)) };
  });
}
