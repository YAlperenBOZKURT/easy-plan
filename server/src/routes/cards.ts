import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireUser } from '../auth.ts';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { cardDto, cardTemplateDto, type CardTemplateDto } from '../dto.ts';
import { repo, type Repo } from '../repo.ts';
import { applyReminders, sanitizeOffsets } from '../reminders.ts';
import { indexBetween } from '../sorting.ts';
import { removeImageFiles } from '../storage.ts';
import { addYears, isValidDay, isValidInstant, isValidTime, today } from '../time.ts';
import { CARD_COLORS, CARD_PRIORITIES } from '../types.ts';
import { isChecklistComplete, sanitizeChecklist } from '../checklist.ts';
import { sanitizeTags } from '../tags.ts';
import { MAX_SEARCH_RESULTS, readSearchQuery } from '../search.ts';
import { newId } from '../ids.ts';
import { requestBoardAccess } from '../boards.ts';

export const storeFor = (req: FastifyRequest): Repo => {
  const access = requestBoardAccess(db(), req);
  return repo(db(), req.user!.id, access.board.id, access.membership.role);
};

/** Gezinme ve veri penceresi: bugünden ±1 yıl. */
export function withinWindow(day: string, tz: string): boolean {
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
  if ('tags' in body) {
    const result = sanitizeTags(body.tags);
    if (result.valid) out.tags = result.tags;
    else errors.push('tags');
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

function stillMatchesTemplate(
  body: Record<string, unknown>,
  out: Record<string, unknown>,
  template: CardTemplateDto,
  reminders: number[],
): boolean {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const fields: Array<[string, keyof CardTemplateDto]> = [
    ['title', 'title'], ['note', 'note'], ['startTime', 'startTime'], ['endTime', 'endTime'],
    ['color', 'color'], ['priority', 'priority'], ['tags', 'tags'],
  ];
  for (const [bodyKey, templateKey] of fields) {
    if (bodyKey in body && !same(out[bodyKey], template[templateKey])) return false;
  }
  if ('checklist' in body) {
    const incoming = (out.checklist as Array<{ text: string; done: boolean }> | undefined) ?? [];
    const compact = (items: Array<{ text: string; done: boolean }>) =>
      items.map((item) => ({ text: item.text, done: item.done }));
    if (!same(compact(incoming), compact(template.checklist))) return false;
  }
  if ('reminders' in body && !same(reminders, template.reminders)) return false;
  // Son tarih şablonun parçası değildir; oluştururken eklenmesi bile kartı
  // özelleştirilmiş yapar. null göndermek istemcilerin normal boş alanıdır.
  if ('deadlineAt' in body && out.deadlineAt != null) return false;
  if (body.done === true) return false;
  return true;
}

export async function cardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  const lifecycleCards = (req: FastifyRequest, state: 'archived' | 'trash') => {
    const store = storeFor(req);
    const cards = store.cards.lifecycle(state);
    const ids = cards.map((card) => card.id);
    const images = store.images.forCards(ids);
    const reminders = store.reminders.forCards(ids);
    return { cards: cards.map((card) => cardDto(card, images, reminders)) };
  };

  app.get('/tags', async (req) => ({ tags: storeFor(req).cards.allTags() }));

  app.get('/cards/archived', async (req) => lifecycleCards(req, 'archived'));

  app.get('/cards/trash', async (req) => lifecycleCards(req, 'trash'));

  app.get<{ Querystring: { q?: string } }>('/cards/search', async (req, reply) => {
    const parsed = readSearchQuery(req.query.q);
    if (!parsed.valid) return reply.code(400).send({ error: 'invalid_search_query' });
    const store = storeFor(req);
    const cards = store.cards.search(parsed.match, MAX_SEARCH_RESULTS);
    const ids = cards.map((card) => card.id);
    const images = store.images.forCards(ids);
    const reminders = store.reminders.forCards(ids);
    return {
      query: parsed.query,
      cards: cards.map((card) => cardDto(card, images, reminders)),
    };
  });

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
    const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId : undefined;
    const template = templateId ? store.templates.get(templateId) : undefined;
    if (templateId && !template) return reply.code(404).send({ error: 'template_not_found' });
    const templateDto = template ? cardTemplateDto(template) : undefined;
    // İstemcinin ürettiği id kabul edilir: çevrimdışı oluşturulan kart senkronda çakışmaz.
    const id = typeof req.body?.id === 'string' ? req.body.id : undefined;
    if (id && store.cards.get(id)) return reply.code(409).send({ error: 'already_exists' });

    const offsets = req.body && 'reminders' in req.body
      ? sanitizeOffsets(req.body.reminders)
      : (templateDto?.reminders ?? []);
    const linked = Boolean(
      template && templateDto && stillMatchesTemplate(req.body, out, templateDto, offsets),
    );
    const defaults = templateDto
      ? {
          title: templateDto.title,
          note: templateDto.note,
          startTime: templateDto.startTime,
          endTime: templateDto.endTime,
          color: templateDto.color,
          priority: templateDto.priority,
          tags: templateDto.tags,
          checklist: templateDto.checklist.map((item) => ({
            id: newId(), text: item.text, done: false,
          })),
        }
      : {};
    const card = store.cards.create({
      id,
      ...defaults,
      ...(out as { day: string }),
      templateId: linked ? template!.id : null,
    });
    if (template) store.images.cloneForCard(card.id, store.templates.images(template.id));
    if (offsets.length > 0) applyReminders(store, card, req.user!, offsets);

    return reply.code(201).send({
      card: cardDto(card, store.images.forCard(card.id), store.reminders.forCard(card.id)),
    });
  });

  app.post<{ Params: { id: string }; Body: { day?: string } }>(
    '/cards/:id/duplicate',
    async (req, reply) => {
      const store = storeFor(req);
      const source = store.cards.get(req.params.id);
      if (!source) return reply.code(404).send({ error: 'not_found' });
      const day = req.body?.day ?? source.day;
      if (!isValidDay(day)) return reply.code(400).send({ error: 'invalid_day' });
      if (!withinWindow(day, req.user!.timezone)) return reply.code(400).send({ error: 'out_of_window' });

      const sourceDto = cardDto(source);
      const card = store.cards.create({
        day,
        title: source.title,
        note: source.note,
        startTime: source.start_time,
        endTime: source.end_time,
        color: source.color,
        done: false,
        priority: source.priority,
        tags: sourceDto.tags,
        checklist: sourceDto.checklist.map((item) => ({ id: newId(), text: item.text, done: false })),
      });
      const offsets = store.reminders.forCard(source.id).map((row) => row.offset_minutes);
      const images = store.images.cloneForCard(card.id, store.images.forCard(source.id));
      applyReminders(store, card, req.user!, offsets);
      return reply.code(201).send({ card: cardDto(card, images, store.reminders.forCard(card.id)) });
    },
  );

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
    const card = store.cards.getAny(req.params.id);
    if (!card) return reply.code(404).send({ error: 'not_found' });
    if (!card.trashed_at) store.cards.trash(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/cards/:id/archive', async (req, reply) => {
    const store = storeFor(req);
    const card = store.cards.archive(req.params.id);
    if (!card) return reply.code(404).send({ error: 'not_found' });
    return { card: cardDto(card, store.images.forCard(card.id), store.reminders.forCard(card.id)) };
  });

  app.post<{ Params: { id: string } }>('/cards/:id/restore', async (req, reply) => {
    const store = storeFor(req);
    const card = store.cards.restore(req.params.id);
    if (!card) return reply.code(404).send({ error: 'not_found' });
    return { card: cardDto(card, store.images.forCard(card.id), store.reminders.forCard(card.id)) };
  });

  app.delete<{ Params: { id: string } }>('/cards/:id/permanent', async (req, reply) => {
    const store = storeFor(req);
    const card = store.cards.getAny(req.params.id);
    if (!card || !card.trashed_at) return reply.code(404).send({ error: 'not_found' });
    const images = store.cards.remove(req.params.id);
    await removeImageFiles(store.images.unreferenced(images));
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
