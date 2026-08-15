import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { config, rootDir } from './config.ts';
import { db } from './db.ts';
import { requireUser, seedAdmin } from './auth.ts';
import { resolveOwnedUpload } from './storage.ts';
import { startScheduler } from './scheduler.ts';
import { authRoutes } from './routes/auth.ts';
import { adminRoutes } from './routes/admin.ts';
import { cardRoutes } from './routes/cards.ts';
import { habitRoutes } from './routes/habits.ts';
import { imageRoutes } from './routes/images.ts';
import { mailRoutes } from './routes/mail.ts';
import { syncRoutes } from './routes/sync.ts';
import { registerOpenApi } from './openapi.ts';
import { loggerOptions, registerObservability, requestId } from './observability.ts';
import { registerSecurity } from './security.ts';

export async function buildServer(options: { logger?: boolean; docs?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger === false ? false : loggerOptions(),
    genReqId: (req) => requestId(req.headers),
    trustProxy: config.isProd,
    bodyLimit: 25 * 1024 * 1024,
  });

  registerObservability(app);
  await registerSecurity(app);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 10 } });
  await registerOpenApi(app, options.docs ?? config.docsEnabled);

  const live = async () => ({
    ok: true,
    status: 'ok',
    time: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
  app.get('/api/v1/health', { logLevel: 'silent' }, live);
  app.get('/api/v1/health/live', { logLevel: 'silent' }, live);
  app.get('/api/v1/health/ready', { logLevel: 'silent' }, async (_req, reply) => {
    try {
      db().prepare('SELECT 1').get();
      return { ...(await live()), database: 'ready' };
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ ok: false, status: 'unavailable', database: 'unavailable' });
    }
  });

  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  await app.register(cardRoutes, { prefix: '/api/v1' });
  await app.register(imageRoutes, { prefix: '/api/v1' });
  await app.register(habitRoutes, { prefix: '/api/v1' });
  await app.register(mailRoutes, { prefix: '/api/v1' });
  await app.register(syncRoutes, { prefix: '/api/v1' });

  /**
   * Görseller oturum arkasında ve sahiplik kontrollü servis edilir: URL'i bilmek
   * başkasının resmini açmaya yetmez.
   */
  mkdirSync(config.uploadsDir, { recursive: true }); // statik eklenti kökün var olmasını ister
  await app.register(fastifyStatic, {
    root: config.uploadsDir,
    serve: false,
    decorateReply: true,
  });
  app.get<{ Params: { '*': string } }>('/uploads/*', { preHandler: requireUser }, async (req, reply) => {
    const relative = req.params['*'];
    if (!resolveOwnedUpload(req.user!.id, relative)) return reply.code(403).send({ error: 'forbidden' });
    return reply.sendFile(relative, config.uploadsDir, {
      cacheControl: true,
      maxAge: '7d',
      immutable: true,
    });
  });

  // Üretimde derlenmiş arayüz aynı sunucudan servis edilir (tek container).
  const webDist = resolve(rootDir, 'web/dist');
  const hasWebBuild = existsSync(webDist);
  if (hasWebBuild) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: false });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/uploads') || !hasWebBuild) {
      return reply.code(404).send({ error: 'not_found', requestId: req.id });
    }
    return reply.sendFile('index.html', webDist); // SPA yönlendirmesi
  });

  return app;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''));

if (invokedDirectly) {
  db(); // şema göçlerini çalıştırır
  const app = await buildServer();
  seedAdmin(app.log);
  let stopScheduler = () => {};
  app.addHook('onClose', async () => stopScheduler());
  await app.listen({ port: config.port, host: '0.0.0.0' });
  stopScheduler = startScheduler(db(), app.log);
  app.log.info(
    { port: config.port, docs: config.docsEnabled ? '/documentation' : 'disabled' },
    'Planner server started',
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'graceful shutdown started');
    await app.close();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}
