import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance, FastifySchema, RouteOptions } from 'fastify';

type JsonSchema = Record<string, unknown>;
type OperationDoc = {
  summary: string;
  tag: string;
  description?: string;
  public?: boolean;
  security?: Array<Record<string, never[]>>;
  body?: JsonSchema;
  querystring?: JsonSchema;
};

const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length > 0 ? { required } : {}),
});

const string = (extra: JsonSchema = {}): JsonSchema => ({ type: 'string', ...extra });
const password = (minimum = 0): JsonSchema => string({
  format: 'password',
  ...(minimum > 0 ? { minLength: minimum } : {}),
  maxLength: 256,
});
const boolean = (): JsonSchema => ({ type: 'boolean' });
const stringArray = (): JsonSchema => ({ type: 'array', items: { type: 'string' } });
const numberArray = (): JsonSchema => ({ type: 'array', items: { type: 'integer' } });
const checklist = (): JsonSchema => ({
  type: 'array',
  maxItems: 50,
  items: object(
    {
      id: string({ maxLength: 100 }),
      text: string({ minLength: 1, maxLength: 500 }),
      done: boolean(),
    },
    ['text'],
  ),
});

const cardBody = object({
  id: string({ format: 'uuid' }),
  day: string({ format: 'date' }),
  title: string({ maxLength: 200 }),
  note: string({ maxLength: 5000 }),
  startTime: { anyOf: [string({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { type: 'null' }] },
  endTime: { anyOf: [string({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { type: 'null' }] },
  color: string(),
  done: boolean(),
  manualSort: boolean(),
  reminders: numberArray(),
  checklist: checklist(),
  updatedAt: string({ format: 'date-time' }),
});

const habitBody = object({
  title: string({ maxLength: 200 }),
  note: string({ maxLength: 5000 }),
  startTime: { anyOf: [string({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { type: 'null' }] },
  endTime: { anyOf: [string({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { type: 'null' }] },
  color: string(),
  weekdays: numberArray(),
  reminders: numberArray(),
  active: boolean(),
});

const operations: Record<string, OperationDoc> = {
  'GET /api/v1/health': { summary: 'Servis durumunu döndürür', tag: 'System', public: true },
  'GET /api/v1/health/live': { summary: 'Sürecin çalıştığını doğrular', tag: 'System', public: true },
  'GET /api/v1/health/ready': { summary: 'Veritabanı hazırlığını doğrular', tag: 'System', public: true },
  'POST /api/v1/auth/login': {
    summary: 'Web oturumu açar', tag: 'Authentication', public: true,
    body: object({ email: string({ format: 'email', maxLength: 320 }), password: password() }, ['email', 'password']),
  },
  'POST /api/v1/auth/token': {
    summary: 'Native istemci için JWT access/refresh çifti üretir', tag: 'Authentication', public: true,
    body: object(
      { email: string({ format: 'email', maxLength: 320 }), password: password(), device: string({ maxLength: 200 }) },
      ['email', 'password'],
    ),
  },
  'POST /api/v1/auth/refresh': {
    summary: 'Refresh JWT döndürerek yeni token çifti üretir', tag: 'Authentication',
    description: 'Web istemcileri HttpOnly refresh cookie kullanır. Native istemciler refresh JWT\'yi Bearer başlığında veya refreshToken JSON alanında gönderebilir.',
    security: [{ refreshCookie: [] }, { refreshBearer: [] }],
  },
  'POST /api/v1/auth/logout': {
    summary: 'Geçerli JWT oturumunu iptal eder', tag: 'Authentication',
    security: [{ accessCookie: [] }, { refreshCookie: [] }, { bearerAuth: [] }],
  },
  'GET /api/v1/auth/me': { summary: 'Geçerli kullanıcıyı döndürür', tag: 'Authentication' },
  'GET /api/v1/auth/invite/:token': { summary: 'Davet jetonunu doğrular', tag: 'Authentication', public: true },
  'POST /api/v1/auth/invite/:token': {
    summary: 'Davetle hesap oluşturur', tag: 'Authentication', public: true,
    body: object({ name: string({ maxLength: 80 }), password: password(12) }, ['password']),
  },
  'POST /api/v1/auth/forgot': {
    summary: 'Şifre sıfırlama isteği oluşturur', tag: 'Authentication', public: true,
    body: object({ email: string({ format: 'email', maxLength: 320 }) }, ['email']),
  },
  'POST /api/v1/auth/reset/:token': {
    summary: 'Şifreyi sıfırlar', tag: 'Authentication', public: true,
    body: object({ password: password(12) }, ['password']),
  },
  'PATCH /api/v1/me': {
    summary: 'Kullanıcı profilini günceller', tag: 'Profile',
    body: object({ name: string(), timezone: string(), dailySummary: boolean(), currentPassword: password(), newPassword: password(12) }),
  },
  'POST /api/v1/me/logout-all': { summary: 'Tüm cihazlardaki oturumları kapatır', tag: 'Profile' },
  'GET /api/v1/cards': {
    summary: 'Tarih aralığındaki kartları listeler', tag: 'Cards',
    querystring: object({ from: string({ format: 'date' }), to: string({ format: 'date' }) }, ['from', 'to']),
  },
  'POST /api/v1/cards': { summary: 'Kart oluşturur', tag: 'Cards', body: { ...cardBody, required: ['day'] } },
  'PATCH /api/v1/cards/:id': { summary: 'Kartı günceller', tag: 'Cards', body: cardBody },
  'DELETE /api/v1/cards/:id': { summary: 'Kartı siler', tag: 'Cards' },
  'PATCH /api/v1/cards/:id/move': {
    summary: 'Kartı gün veya sıra içinde taşır', tag: 'Cards',
    body: object({
      day: string({ format: 'date' }),
      beforeId: { anyOf: [string(), { type: 'null' }] },
      afterId: { anyOf: [string(), { type: 'null' }] },
    }),
  },
  'POST /api/v1/cards/:id/images': { summary: 'Karta görsel yükler', tag: 'Images' },
  'DELETE /api/v1/images/:id': { summary: 'Görseli siler', tag: 'Images' },
  'GET /api/v1/habits': { summary: 'Davranışları listeler', tag: 'Habits' },
  'POST /api/v1/habits': { summary: 'Davranış oluşturur', tag: 'Habits', body: { ...habitBody, required: ['weekdays'] } },
  'PATCH /api/v1/habits/:id': { summary: 'Davranışı günceller', tag: 'Habits', body: habitBody },
  'DELETE /api/v1/habits/:id': { summary: 'Davranışı siler', tag: 'Habits' },
  'POST /api/v1/maintenance/run': { summary: 'Bakım görevlerini çalıştırır', tag: 'System' },
  'GET /api/v1/changes': {
    summary: 'Native istemci için delta senkron verisi döndürür', tag: 'Sync',
    querystring: object({ since: string({ format: 'date-time' }) }),
  },
  'POST /api/v1/mail/test': { summary: 'Test e-postası gönderir', tag: 'Mail' },
  'GET /api/v1/mail/log': { summary: 'Kullanıcının e-posta geçmişini döndürür', tag: 'Mail' },
  'POST /api/v1/mail/run-scheduler': { summary: 'E-posta zamanlayıcısını tetikler', tag: 'Mail' },
  'GET /api/v1/admin/stats': { summary: 'Yönetim istatistiklerini döndürür', tag: 'Admin' },
  'GET /api/v1/admin/users': { summary: 'Kullanıcıları listeler', tag: 'Admin' },
  'GET /api/v1/admin/invites': { summary: 'Aktif davetleri listeler', tag: 'Admin' },
  'POST /api/v1/admin/invites': {
    summary: 'Yeni davet oluşturur', tag: 'Admin',
    body: object({ email: string({ format: 'email', maxLength: 320 }) }, ['email']),
  },
  'PATCH /api/v1/admin/users/:id': {
    summary: 'Kullanıcı rolünü veya durumunu günceller', tag: 'Admin',
    body: object({ role: string({ enum: ['admin', 'user'] }), active: boolean() }),
  },
  'DELETE /api/v1/admin/users/:id': { summary: 'Kullanıcıyı siler', tag: 'Admin' },
  'GET /api/v1/admin/mail-log': { summary: 'Sistem e-posta geçmişini döndürür', tag: 'Admin' },
};

function methodsOf(method: RouteOptions['method']): string[] {
  return (Array.isArray(method) ? method : [method]).map((value) => String(value).toUpperCase());
}

function paramsFor(url: string): JsonSchema | undefined {
  const names = [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
  if (names.length === 0) return undefined;
  return {
    type: 'object',
    required: names,
    properties: Object.fromEntries(names.map((name) => [name, string()])),
  };
}

function operationId(method: string, url: string): string {
  const path = url.replace(/^\/api\/v1\//, '').replace(/:([A-Za-z0-9_]+)/g, 'by_$1');
  return `${method.toLowerCase()}_${path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

/** Route sözleşmelerini tek yerde tamamlar; çalışma zamanı davranışını değiştirmez. */
function addDocumentationDefaults(route: RouteOptions) {
  if (!route.url.startsWith('/api/') && !route.url.startsWith('/uploads/')) return;
  const method = methodsOf(route.method)[0]!;
  const doc = operations[`${method} ${route.url}`];
  const schema: FastifySchema = { ...(route.schema ?? {}) };
  schema.summary ??= doc?.summary ?? `${method} ${route.url}`;
  schema.description ??= doc?.description;
  schema.operationId ??= operationId(method, route.url);
  schema.tags ??= [doc?.tag ?? 'Other'];
  schema.security ??= doc?.security ?? (doc?.public ? [] : [{ accessCookie: [] }, { bearerAuth: [] }]);
  const params = paramsFor(route.url);
  if (schema.params === undefined && params !== undefined) schema.params = params;
  if (schema.body === undefined && doc?.body !== undefined) schema.body = doc.body;
  if (schema.querystring === undefined && doc?.querystring !== undefined) schema.querystring = doc.querystring;
  route.schema = schema;
}

export async function registerOpenApi(app: FastifyInstance, uiEnabled: boolean) {
  // Swagger kendi onRoute hook'unu kurmadan önce sözleşme varsayımlarını ekle.
  app.addHook('onRoute', addDocumentationDefaults);

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Planner API',
        description: 'Planner web, mobil ve masaüstü istemcilerinin ortak HTTP API sözleşmesi.',
        version: '1.0.0',
      },
      tags: [
        { name: 'System', description: 'Sağlık ve bakım uçları' },
        { name: 'Authentication', description: 'Kimlik doğrulama ve oturumlar' },
        { name: 'Profile', description: 'Kullanıcı profili' },
        { name: 'Cards', description: 'Plan kartları' },
        { name: 'Images', description: 'Kart görselleri' },
        { name: 'Habits', description: 'Tekrarlanan davranışlar' },
        { name: 'Sync', description: 'Native istemci senkronizasyonu' },
        { name: 'Mail', description: 'E-posta ve hatırlatmalar' },
        { name: 'Admin', description: 'Yönetim işlemleri' },
      ],
      components: {
        securitySchemes: {
          accessCookie: { type: 'apiKey', in: 'cookie', name: 'planner_access', description: 'Short-lived web access JWT' },
          refreshCookie: { type: 'apiKey', in: 'cookie', name: 'planner_refresh', description: 'Rotating web refresh JWT' },
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          refreshBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Native refresh JWT; accepted only by the refresh endpoint' },
        },
      },
    },
  });

  if (uiEnabled) {
    await app.register(swaggerUi, {
      routePrefix: '/documentation',
      uiConfig: { docExpansion: 'list', deepLinking: true },
      staticCSP: true,
    });
  }
}
