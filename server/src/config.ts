import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(here, '../..');

// .env varsa yükle (Node'un dahili yükleyicisi, ek bağımlılık yok)
const envFile = resolve(rootDir, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : v === 'true' || v === '1';

const positiveInteger = (name: string, value: string | undefined, fallback: number, maximum: number) => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
};

export const config = {
  // API_PORT önce gelir: bazı ortamlar PORT değişkenini kendi amacıyla ayarlıyor.
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  isProd: process.env.NODE_ENV === 'production',
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  slowRequestMs: Math.max(1, Number(process.env.SLOW_REQUEST_MS ?? 1000)),
  docsEnabled: bool(process.env.API_DOCS, process.env.NODE_ENV !== 'production'),

  dataDir: process.env.DATA_DIR ?? resolve(rootDir, 'data'),
  get dbFile() {
    return resolve(this.dataDir, 'planner.db');
  },
  get uploadsDir() {
    return resolve(this.dataDir, 'uploads');
  },

  defaultTz: process.env.DEFAULT_TZ ?? 'Europe/Istanbul',
  /** Saatsiz kartların hatırlatma hesabında baz alınan saat */
  defaultCardTime: process.env.DEFAULT_CARD_TIME ?? '09:00',

  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ?? 'development-access-secret-change-before-production-32-bytes',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ?? 'development-refresh-secret-change-before-production-32-bytes',
    issuer: process.env.JWT_ISSUER ?? 'planner-api',
    audience: process.env.JWT_AUDIENCE ?? 'planner-clients',
    accessMinutes: positiveInteger('JWT_ACCESS_MINUTES', process.env.JWT_ACCESS_MINUTES, 15, 1_440),
    refreshDays: positiveInteger('JWT_REFRESH_DAYS', process.env.JWT_REFRESH_DAYS, 30, 365),
  },
  inviteDays: 7,
  resetHours: 1,

  adminEmail: process.env.ADMIN_EMAIL ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? '',
  },
  get mailEnabled() {
    return Boolean(this.smtp.host && this.smtp.user && this.smtp.pass && this.smtp.from);
  },

  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Gezinme ve veri saklama penceresi */
  windowYears: 1,
};

if (config.isProd) {
  const invalidSecret = (secret: string) =>
    secret.length < 32 || secret.startsWith('development-') || secret.startsWith('replace-');
  if (invalidSecret(config.jwt.accessSecret) || invalidSecret(config.jwt.refreshSecret)) {
    throw new Error('Production requires unique JWT_ACCESS_SECRET and JWT_REFRESH_SECRET values of at least 32 characters.');
  }
  if (config.jwt.accessSecret === config.jwt.refreshSecret) {
    throw new Error('JWT access and refresh secrets must be different.');
  }
  if (!config.appUrl.startsWith('https://')) {
    throw new Error('Production APP_URL must use HTTPS.');
  }
}
