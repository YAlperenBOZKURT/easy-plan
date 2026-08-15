import { config } from './config.ts';
import type { Repo } from './repo.ts';
import { zonedToUtc } from './time.ts';
import { REMINDER_OFFSETS, type CardRow, type UserRow } from './types.ts';

/**
 * Hatırlatmanın tetikleneceği an = (kartın günü + başlangıç saati) − seçilen aralık.
 * Kartta saat yoksa o günün varsayılan saati (DEFAULT_CARD_TIME, öntanımlı 09:00)
 * baz alınır — böylece saatsiz işler için de hatırlatma kurulabilir.
 */
export function fireAtFor(card: Pick<CardRow, 'day' | 'start_time'>, user: Pick<UserRow, 'timezone'>, offsetMinutes: number): string {
  const time = card.start_time ?? config.defaultCardTime;
  const base = zonedToUtc(card.day, time, user.timezone || config.defaultTz);
  return new Date(base.getTime() - offsetMinutes * 60_000).toISOString();
}

/** İstemciden gelen listeyi temizler: bilinmeyen aralıklar atılır, tekrarlar teklenir. */
export function sanitizeOffsets(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<number>(REMINDER_OFFSETS);
  return [...new Set(input.map(Number).filter((n) => allowed.has(n)))].sort((a, b) => b - a);
}

/** Kartın hatırlatma setini kurar (saat/gün değişince yeniden çağrılır). */
export function applyReminders(
  store: Repo,
  card: Pick<CardRow, 'id' | 'day' | 'start_time'>,
  user: Pick<UserRow, 'timezone'>,
  offsets: number[],
) {
  store.reminders.replace(
    card.id,
    offsets.map((offset) => ({ offset, fireAt: fireAtFor(card, user, offset) })),
  );
}
