import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.ts';
import { config } from './config.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizedOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export async function registerSecurity(app: FastifyInstance) {
  await app.register(cookie);

  const trustedOrigins = new Set(
    [config.appUrl, ...config.allowedOrigins, ...(config.isProd ? [] : ['http://localhost:5173'])]
      .map(normalizedOrigin)
      .filter((value): value is string => value !== undefined),
  );

  if (config.allowedOrigins.length > 0 || !config.isProd) {
    await app.register(cors, {
      origin: [...trustedOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 600,
    });
  }

  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
  });

  await app.register(jwt, {
    namespace: 'access',
    secret: config.jwt.accessSecret,
    sign: {
      algorithm: 'HS256',
      expiresIn: `${config.jwt.accessMinutes}m`,
      iss: config.jwt.issuer,
      aud: config.jwt.audience,
    },
    verify: {
      algorithms: ['HS256'],
      allowedIss: config.jwt.issuer,
      allowedAud: config.jwt.audience,
    },
  });

  await app.register(jwt, {
    namespace: 'refresh',
    secret: config.jwt.refreshSecret,
    sign: {
      algorithm: 'HS256',
      expiresIn: `${config.jwt.refreshDays}d`,
      iss: config.jwt.issuer,
      aud: config.jwt.audience,
    },
    verify: {
      algorithms: ['HS256'],
      allowedIss: config.jwt.issuer,
      allowedAud: config.jwt.audience,
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('permissions-policy', 'camera=(), geolocation=(), microphone=()');

    if (SAFE_METHODS.has(req.method)) return;
    const usesBrowserCookies = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
    if (!usesBrowserCookies) return; // Native clients authenticate with Authorization: Bearer.

    const origin = typeof req.headers.origin === 'string' ? normalizedOrigin(req.headers.origin) : undefined;
    if (origin && trustedOrigins.has(origin)) return;

    req.log.warn({ origin: req.headers.origin, method: req.method, url: req.url }, 'untrusted cookie origin');
    return reply.code(403).send({ error: 'untrusted_origin' });
  });
}
