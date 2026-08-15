import { config } from './config.ts';
import { db, transaction, type Db } from './db.ts';
import { repo } from './repo.ts';
import { applyReminders } from './reminders.ts';
import { removeImageFiles } from './storage.ts';
import { addDays, addYears, today, weekdayOf } from './time.ts';
import type { HabitRow, UserRow } from './types.ts';

/**
 * Davranışlardan kart üretimi ve eski kayıtların temizliği.
 *
 * Üretim idempotenttir: her davranış "hangi güne kadar üretildiğini" (materialized_until)
 * hatırlar ve yalnızca ondan sonrasını üretir. Bu sayede kullanıcının sildiği bir kart
 * bir sonraki çalışmada geri gelmez.
 */

const parseWeekdays = (value: string): number[] =>
  value
    .split(',')
    .map(Number)
    .filter((n) => n >= 1 && n <= 7);

const parseReminders = (value: string): number[] =>
  value
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);

/** Bir davranış için ufka kadar eksik günlerin kartlarını üretir. Üretilen kart sayısını döner. */
export function materializeHabit(database: Db, user: UserRow, habit: HabitRow, now = new Date()): number {
  if (habit.active !== 1) return 0;
  const weekdays = parseWeekdays(habit.weekdays);
  if (weekdays.length === 0) return 0;

  const tz = user.timezone || config.defaultTz;
  const start = habit.materialized_until ? addDays(habit.materialized_until, 1) : today(tz, now);
  const horizon = addYears(today(tz, now), config.windowYears);
  if (start > horizon) return 0;

  const store = repo(database, user.id);
  const reminders = parseReminders(habit.reminders);
  let created = 0;

  transaction(database, () => {
    for (let day = start; day <= horizon; day = addDays(day, 1)) {
      if (!weekdays.includes(weekdayOf(day))) continue;
      // Üretilen kart tamamen bağımsızdır; habit_id yalnızca kökeni gösterir.
      const card = store.cards.create({
        day,
        title: habit.title,
        note: habit.note,
        startTime: habit.start_time,
        endTime: habit.end_time,
        color: habit.color,
        habitId: habit.id,
      });
      if (reminders.length > 0) applyReminders(store, card, user, reminders);
      created += 1;
    }
    store.habits.update(habit.id, { materializedUntil: horizon });
  });

  return created;
}

/** 1 yıldan eski davranış kartlarını siler. Elle yazılan kartlara dokunmaz. */
export async function purgeOldHabitCards(database: Db, user: UserRow, now = new Date()): Promise<number> {
  const cutoff = addYears(today(user.timezone || config.defaultTz, now), -config.windowYears);
  const doomed = database
    .prepare('SELECT id FROM cards WHERE user_id = ? AND habit_id IS NOT NULL AND day < ?')
    .all(user.id, cutoff) as { id: string }[];
  if (doomed.length === 0) return 0;

  const store = repo(database, user.id);
  const files = [];
  for (const row of doomed) files.push(...store.cards.remove(row.id));
  await removeImageFiles(files);
  return doomed.length;
}

export async function runMaintenance(database: Db = db(), now = new Date()) {
  const users = database.prepare('SELECT * FROM users WHERE active = 1').all() as unknown as UserRow[];
  let created = 0;
  let purged = 0;

  for (const user of users) {
    const habits = database
      .prepare('SELECT * FROM habits WHERE user_id = ? AND active = 1')
      .all(user.id) as unknown as HabitRow[];
    for (const habit of habits) created += materializeHabit(database, user, habit, now);
    purged += await purgeOldHabitCards(database, user, now);
  }

  database
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('last_maintenance', now.toISOString());

  return { created, purged, users: users.length };
}
