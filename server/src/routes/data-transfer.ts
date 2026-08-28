import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { cardDto } from '../dto.ts';
import { db, transaction } from '../db.ts';
import {
  exportCards,
  formatFromFile,
  importCards,
  MAX_IMPORT_BYTES,
  TRANSFER_FORMATS,
  type TransferFormat,
} from '../data-transfer.ts';
import { applyReminders } from '../reminders.ts';
import { isValidDay } from '../time.ts';
import { storeFor, withinWindow } from './cards.ts';

const contentTypes: Record<TransferFormat, string> = {
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
};

export async function dataTransferRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get<{ Querystring: { format?: string; from?: string; to?: string } }>(
    '/data/export',
    async (req, reply) => {
      const { format, from, to } = req.query;
      if (!format || !(TRANSFER_FORMATS as readonly string[]).includes(format)) {
        return reply.code(400).send({ error: 'invalid_format' });
      }
      if (!from || !to || !isValidDay(from) || !isValidDay(to) || from > to) {
        return reply.code(400).send({ error: 'invalid_range' });
      }
      if (!withinWindow(from, req.user!.timezone) || !withinWindow(to, req.user!.timezone)) {
        return reply.code(400).send({ error: 'out_of_window' });
      }
      const store = storeFor(req);
      const cards = store.cards.range(from, to);
      const ids = cards.map((card) => card.id);
      const images = store.images.forCards(ids);
      const reminders = store.reminders.forCards(ids);
      const body = exportCards(
        cards.map((card) => cardDto(card, images, reminders)),
        format as TransferFormat,
      );
      const filename = `easy-plan-${from}-${to}.${format}`;
      return reply
        .header('content-type', contentTypes[format as TransferFormat])
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'no-store')
        .send(body);
    },
  );

  app.post('/data/import', {
    schema: {
      consumes: ['multipart/form-data'],
    },
  }, async (req, reply) => {
    const part = await req.file({ limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });
    if (!part) return reply.code(400).send({ error: 'file_required' });
    const format = formatFromFile(part.filename, part.mimetype);
    if (!format) return reply.code(415).send({ error: 'unsupported_format' });
    let parsed;
    try {
      parsed = importCards(await part.toBuffer(), format);
    } catch {
      return reply.code(400).send({ error: 'invalid_file' });
    }
    const allowed = parsed.cards.filter((card) => withinWindow(card.day, req.user!.timezone));
    const outOfWindow = parsed.cards.length - allowed.length;
    const store = storeFor(req);
    transaction(db(), () => {
      for (const input of allowed) {
        const card = store.cards.create(input);
        applyReminders(store, card, req.user!, input.reminders);
      }
    });
    return reply.code(201).send({
      imported: allowed.length,
      skipped: parsed.errors.length + outOfWindow,
      errors: [
        ...parsed.errors,
        ...(outOfWindow > 0 ? [{ row: 0, error: 'out_of_window', count: outOfWindow }] : []),
      ],
    });
  });
}
