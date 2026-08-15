import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { imageDto } from '../dto.ts';
import { removeImageFiles, saveImage } from '../storage.ts';
import { storeFor } from './cards.ts';

const ACCEPTED = /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/i;

export async function imageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** Karta görsel ekler. Tarayıcıdan dosya seçme, Ctrl+V yapıştırma ve telefon kamerası aynı ucu kullanır. */
  app.post<{ Params: { id: string } }>('/cards/:id/images', async (req, reply) => {
    const store = storeFor(req);
    const card = store.cards.get(req.params.id);
    if (!card) return reply.code(404).send({ error: 'not_found' });

    const uploaded = [];
    for await (const part of req.files()) {
      if (!ACCEPTED.test(part.mimetype)) return reply.code(415).send({ error: 'unsupported_type' });
      const buffer = await part.toBuffer();
      const saved = await saveImage(req.user!.id, buffer);
      uploaded.push(imageDto(store.images.add({ cardId: card.id, ...saved })));
    }
    if (uploaded.length === 0) return reply.code(400).send({ error: 'no_file' });
    return reply.code(201).send({ images: uploaded });
  });

  app.delete<{ Params: { id: string } }>('/images/:id', async (req, reply) => {
    const store = storeFor(req);
    const removed = store.images.remove(req.params.id);
    if (!removed) return reply.code(404).send({ error: 'not_found' });
    await removeImageFiles([removed]);
    return { ok: true };
  });
}
