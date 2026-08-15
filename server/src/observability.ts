import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { config } from './config.ts';

export function loggerOptions(): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'password',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.accessToken',
        'req.body.refreshToken',
      ],
      censor: '[REDACTED]',
    },
  };
}

export function requestId(headers: Record<string, unknown>): string {
  const incoming = headers['x-request-id'];
  if (typeof incoming === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming)) return incoming;
  return randomUUID();
}

export function registerObservability(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.addHook('onResponse', async (req, reply) => {
    if (reply.elapsedTime >= config.slowRequestMs) {
      req.log.warn(
        { method: req.method, url: req.url, statusCode: reply.statusCode, durationMs: reply.elapsedTime },
        'slow request',
      );
    }
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number; code?: string; validation?: unknown };
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    const validation = err.validation;

    if (statusCode >= 500) {
      req.log.error({ err, requestId: req.id }, 'request failed');
    } else {
      req.log.warn({ err, requestId: req.id }, 'request rejected');
    }

    if (reply.sent) return;
    return reply.code(validation ? 400 : statusCode).send({
      error: validation ? 'validation_error' : statusCode >= 500 ? 'internal_error' : err.code ?? 'request_error',
      requestId: req.id,
      ...(validation ? { details: validation } : {}),
    });
  });
}
