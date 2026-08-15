import { resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.ts';
import { db, type Db } from './db.ts';
import { nowIso } from './ids.ts';
import { runMaintenance } from './maintenance.ts';
import { escapeHtml, layout, sendMail } from './mailer.ts';
import { repo } from './repo.ts';
import { today } from './time.ts';
import type { CardImageRow, CardRow, UserRow } from './types.ts';

/**
 * Dakikada bir çalışan zamanlayıcı:
 *  1. vakti gelen hatırlatma maillerini gönderir,
 *  2. sabah 08:00'de (kullanıcının kendi saat diliminde) günlük özeti yollar,
 *  3. günde bir kez davranış üretimi + eski kart temizliğini tetikler.
 */

const TICK_MS = 60_000;
/** Sunucu kapalı kaldıysa: bu kadar geciken hatırlatma artık gönderilmez. */
const MISSED_AFTER_MS = 60 * 60_000;
const SUMMARY_HOUR = 8;

export const offsetLabel = (minutes: number): string => {
  if (minutes % 1440 === 0) return `${minutes / 1440} gün`;
  return `${minutes / 60} saat`;
};

const COLOR_HEX: Record<string, string> = {
  red: '#e5484d',
  orange: '#f76b15',
  amber: '#ffb224',
  green: '#30a46c',
  teal: '#12a594',
  blue: '#0091ff',
  violet: '#8e4ec6',
  pink: '#d6409f',
};

function timeBadge(card: Pick<CardRow, 'start_time' | 'end_time' | 'color'>): string {
  if (!card.start_time) return '';
  const hex = COLOR_HEX[card.color] ?? COLOR_HEX.red;
  const range = card.end_time ? `${card.start_time} - ${card.end_time}` : card.start_time;
  return `<span style="display:inline-block;background:${hex}1a;color:${hex};border-radius:6px;padding:4px 9px;font-size:12px;font-weight:600;letter-spacing:.2px">${range}</span>`;
}

function cardHtml(card: CardRow, images: CardImageRow[]): string {
  const pictures = images
    .map(
      (img, i) =>
        `<img src="cid:img${i}" alt="" style="max-width:100%;border-radius:10px;margin-top:12px;display:block" />`,
    )
    .join('');
  return `${timeBadge(card)}
    <h2 style="margin:12px 0 0;font-size:17px;font-weight:600">${escapeHtml(card.title || '(başlıksız)')}</h2>
    ${card.note ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(card.note)}</p>` : ''}
    ${pictures}`;
}

const attachmentsFor = (images: CardImageRow[]) =>
  images.slice(0, 4).map((img, i) => ({
    filename: `gorsel-${i + 1}.webp`,
    path: resolve(config.uploadsDir, img.thumb),
    cid: `img${i}`,
  }));

/* ------------------------------------------------------------- hatırlatmalar */

export async function processReminders(database: Db = db(), now = new Date()) {
  // SMTP kapalıyken hatırlatmalar tüketilmez: kayıtlar bekler, mail günlüğü şişmez.
  if (!config.mailEnabled) return { sent: 0, skipped: 0, missed: 0, due: 0, disabled: true };

  const due = database
    .prepare(
      `SELECT r.id, r.card_id, r.user_id, r.offset_minutes, r.fire_at
       FROM card_reminders r WHERE r.sent_at IS NULL AND r.fire_at <= ?
       ORDER BY r.fire_at LIMIT 200`,
    )
    .all(now.toISOString()) as { id: string; card_id: string; user_id: string; offset_minutes: number; fire_at: string }[];

  const mark = (id: string, status: string) =>
    database
      .prepare('UPDATE card_reminders SET sent_at = ?, status = ? WHERE id = ?')
      .run(nowIso(), status, id);

  let sent = 0;
  let skipped = 0;
  let missed = 0;

  for (const row of due) {
    // Sunucu uzun süre kapalı kaldıysa geçmiş hatırlatmalar toplu mail yağmuruna dönüşmesin.
    if (now.getTime() - new Date(row.fire_at).getTime() > MISSED_AFTER_MS) {
      mark(row.id, 'missed');
      missed += 1;
      continue;
    }

    const user = database.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as
      | UserRow
      | undefined;
    const store = user ? repo(database, user.id) : undefined;
    const card = store?.cards.get(row.card_id);
    if (!user || !card || user.active !== 1) {
      mark(row.id, 'skipped');
      skipped += 1;
      continue;
    }
    // Kart tamamlandıysa hatırlatma gönderilmez.
    if (card.done === 1) {
      mark(row.id, 'skipped');
      skipped += 1;
      continue;
    }

    const images = store!.images.forCard(card.id);
    const label = offsetLabel(row.offset_minutes);
    const result = await sendMail({
      to: user.email,
      subject: `⏰ ${label} kaldı · ${card.title || 'Planner'}`,
      kind: 'reminder',
      userId: user.id,
      cardId: card.id,
      html: layout(`${label} kaldı`, cardHtml(card, images)),
      attachments: attachmentsFor(images),
    });
    mark(row.id, result.sent ? 'sent' : 'error');
    if (result.sent) sent += 1;
  }

  return { sent, skipped, missed, due: due.length };
}

/* -------------------------------------------------------------- günlük özet */

export async function sendDailySummaries(database: Db = db(), now = new Date()) {
  if (!config.mailEnabled) return { sent: 0, users: 0, disabled: true };

  const users = database
    .prepare('SELECT * FROM users WHERE active = 1 AND daily_summary = 1')
    .all() as unknown as UserRow[];
  let sent = 0;

  for (const user of users) {
    const tz = user.timezone || config.defaultTz;
    const day = today(tz, now);
    if (user.last_summary_day === day) continue;

    const localHour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now),
    ) % 24;
    if (localHour < SUMMARY_HOUR) continue;

    const store = repo(database, user.id);
    const cards = store.cards.range(day, day);
    database.prepare('UPDATE users SET last_summary_day = ? WHERE id = ?').run(day, user.id);
    if (cards.length === 0) continue;

    const rows = cards
      .map(
        (card) => `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f3">
          ${timeBadge(card)}
          <div style="margin-top:6px;font-size:15px;${card.done ? 'color:#8a8a8e;text-decoration:line-through' : 'font-weight:500'}">${escapeHtml(card.title || '(başlıksız)')}</div>
          ${card.note ? `<div style="margin-top:2px;font-size:13px;color:#6b6b70;white-space:pre-wrap">${escapeHtml(card.note)}</div>` : ''}
        </td></tr>`,
      )
      .join('');

    const result = await sendMail({
      to: user.email,
      subject: `📋 Bugün · ${cards.length} kart`,
      kind: 'daily',
      userId: user.id,
      html: layout('Bugünün planı', `<table style="width:100%;border-collapse:collapse">${rows}</table>`),
    });
    if (result.sent) sent += 1;
  }

  return { sent, users: users.length };
}

/* ------------------------------------------------------------------ döngü */

async function tick(database: Db, now = new Date()) {
  await processReminders(database, now);
  await sendDailySummaries(database, now);

  const last = database.prepare("SELECT value FROM meta WHERE key = 'last_maintenance'").get() as
    | { value: string }
    | undefined;
  const lastDay = last?.value?.slice(0, 10);
  if (lastDay !== now.toISOString().slice(0, 10)) await runMaintenance(database, now);
}

export function startScheduler(
  database: Db = db(),
  log: Pick<FastifyBaseLogger, 'error' | 'debug'> = console,
) {
  const run = () => {
    const startedAt = Date.now();
    tick(database)
      .then(() => log.debug({ durationMs: Date.now() - startedAt }, 'scheduler tick completed'))
      .catch((err) => log.error({ err }, 'scheduler tick failed'));
  };
  run();
  const timer = setInterval(run, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
