import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { sanitizeChecklist } from '../checklist.ts';
import { cardDto, cardTemplateDto, imageDto } from '../dto.ts';
import { db, transaction } from '../db.ts';
import { newId } from '../ids.ts';
import { applyReminders, sanitizeOffsets } from '../reminders.ts';
import { sanitizeTags } from '../tags.ts';
import { isValidDay, isValidTime } from '../time.ts';
import { CARD_COLORS, CARD_PRIORITIES } from '../types.ts';
import { removeImageFiles, saveImage } from '../storage.ts';
import { repo } from '../repo.ts';
import { syncLinkedCards } from '../template-sync.ts';
import { storeFor, withinWindow } from './cards.ts';

const ACCEPTED_IMAGE = /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i;

function readTemplateBody(body: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  if (!body) return { out, errors };

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) errors.push('name');
    else out.name = name;
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
  if ('color' in body) {
    if (typeof body.color === 'string' && (CARD_COLORS as readonly string[]).includes(body.color)) {
      out.color = body.color;
    } else errors.push('color');
  }
  if ('priority' in body) {
    if (typeof body.priority === 'string' && (CARD_PRIORITIES as readonly string[]).includes(body.priority)) {
      out.priority = body.priority;
    } else errors.push('priority');
  }
  if ('tags' in body) {
    const tags = sanitizeTags(body.tags);
    if (tags.valid) out.tags = tags.tags;
    else errors.push('tags');
  }
  if ('checklist' in body) {
    const checklist = sanitizeChecklist(body.checklist);
    if (checklist.valid) {
      out.checklist = checklist.items.map((item) => ({ ...item, done: false }));
    } else errors.push('checklist');
  }
  if ('reminders' in body) out.reminders = sanitizeOffsets(body.reminders);
  return { out, errors };
}

export async function cardTemplateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/card-templates', async (req) => ({
    templates: (() => {
      const store = storeFor(req);
      return store.templates.list().map((template) => cardTemplateDto(template, store.templates.images(template.id)));
    })(),
  }));

  app.post<{ Body: Record<string, unknown> }>('/card-templates', async (req, reply) => {
    const { out, errors } = readTemplateBody(req.body);
    if (errors.length > 0) return reply.code(400).send({ error: 'invalid_fields', fields: errors });
    if (typeof out.name !== 'string') return reply.code(400).send({ error: 'name_required' });
    const template = storeFor(req).templates.create(out as Parameters<ReturnType<typeof storeFor>['templates']['create']>[0]);
    return reply.code(201).send({ template: cardTemplateDto(template) });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/card-templates/:id',
    async (req, reply) => {
      const { out, errors } = readTemplateBody(req.body);
      if (errors.length > 0) return reply.code(400).send({ error: 'invalid_fields', fields: errors });
      const database = db();
      const store = repo(database, req.user!.id);
      if (!store.templates.get(req.params.id)) return reply.code(404).send({ error: 'not_found' });
      let removed = [] as ReturnType<typeof syncLinkedCards>;
      const template = transaction(database, () => {
        const updated = store.templates.update(req.params.id, out)!;
        removed = syncLinkedCards(store, updated.id, req.user!);
        return updated;
      });
      await removeImageFiles(removed);
      return { template: cardTemplateDto(template, store.templates.images(template.id)) };
    },
  );

  app.delete<{ Params: { id: string } }>('/card-templates/:id', async (req, reply) => {
    const store = storeFor(req);
    const images = store.templates.remove(req.params.id);
    if (!images) return reply.code(404).send({ error: 'not_found' });
    await removeImageFiles(store.images.unreferenced(images));
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { name?: unknown } }>(
    '/cards/:id/template',
    async (req, reply) => {
      const store = storeFor(req);
      const card = store.cards.get(req.params.id);
      if (!card) return reply.code(404).send({ error: 'not_found' });
      const { out, errors } = readTemplateBody({
        name: req.body?.name,
        title: card.title,
        note: card.note,
        startTime: card.start_time,
        endTime: card.end_time,
        color: card.color,
        priority: card.priority,
        tags: cardDto(card).tags,
        checklist: cardDto(card).checklist.map((item) => ({ ...item, done: false })),
        reminders: store.reminders.forCard(card.id).map((row) => row.offset_minutes),
      });
      if (errors.length > 0) return reply.code(400).send({ error: 'invalid_fields', fields: errors });
      const template = store.templates.create({
        ...(out as Parameters<typeof store.templates.create>[0]),
        images: store.images.forCard(card.id),
      });
      store.cards.linkTemplate(card.id, template.id);
      return reply.code(201).send({ template: cardTemplateDto(template, store.templates.images(template.id)) });
    },
  );

  app.post<{ Params: { id: string }; Body: { day?: unknown } }>(
    '/card-templates/:id/create-card',
    async (req, reply) => {
      const store = storeFor(req);
      const template = store.templates.get(req.params.id);
      if (!template) return reply.code(404).send({ error: 'not_found' });
      const day = req.body?.day;
      if (typeof day !== 'string' || !isValidDay(day)) return reply.code(400).send({ error: 'invalid_day' });
      if (!withinWindow(day, req.user!.timezone)) return reply.code(400).send({ error: 'out_of_window' });

      const dto = cardTemplateDto(template);
      const card = store.cards.create({
        day,
        title: dto.title,
        note: dto.note,
        startTime: dto.startTime,
        endTime: dto.endTime,
        color: dto.color,
        priority: dto.priority,
        tags: dto.tags,
        checklist: dto.checklist.map((item) => ({ id: newId(), text: item.text, done: false })),
        templateId: template.id,
      });
      const images = store.images.cloneForCard(card.id, store.templates.images(template.id));
      applyReminders(store, card, req.user!, dto.reminders);
      return reply.code(201).send({ card: cardDto(card, images, store.reminders.forCard(card.id)) });
    },
  );

  app.post<{ Params: { id: string } }>('/card-templates/:id/images', async (req, reply) => {
    const store = storeFor(req);
    if (!store.templates.get(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const uploaded = [];
    for await (const part of req.files()) {
      if (!ACCEPTED_IMAGE.test(part.mimetype)) {
        return reply.code(415).send({ error: 'unsupported_type' });
      }
      const saved = await saveImage(req.user!.id, await part.toBuffer());
      const image = store.templates.addImage(req.params.id, saved);
      if (image) uploaded.push(imageDto(image));
    }
    if (uploaded.length === 0) return reply.code(400).send({ error: 'no_file' });
    const removed = transaction(db(), () => syncLinkedCards(store, req.params.id, req.user!));
    await removeImageFiles(removed);
    return reply.code(201).send({ images: uploaded });
  });

  app.delete<{ Params: { id: string } }>('/card-template-images/:id', async (req, reply) => {
    const store = storeFor(req);
    const image = store.templates.removeImage(req.params.id);
    if (!image) return reply.code(404).send({ error: 'not_found' });
    const removed = transaction(db(), () => syncLinkedCards(store, image.template_id, req.user!));
    await removeImageFiles(store.images.unreferenced([image, ...removed]));
    return { ok: true };
  });
}
