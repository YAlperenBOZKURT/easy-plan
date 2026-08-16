import type { Db } from './db.ts';
import { newId, nowIso } from './ids.ts';
import { defaultSortIndex } from './sorting.ts';
import type { CardImageRow, CardRow, ChecklistItem, HabitRow, ReminderRow } from './types.ts';

/**
 * Kullanıcıya bağlı veri erişimi.
 *
 * Uygulamanın hiçbir yerinde cards/habits/card_images tablolarına doğrudan
 * dokunulmaz; hepsi buradan geçer ve her sorgu user_id ile sınırlanır. Böylece
 * "WHERE user_id = ?" yazmayı unutmak mümkün değildir — çok kullanıcılı bir
 * kurulumda en kolay yapılan hata budur.
 */
export function repo(db: Db, userId: string) {
  const touch = (cardId: string, at = nowIso()) =>
    db.prepare('UPDATE cards SET updated_at = ? WHERE id = ? AND user_id = ?').run(at, cardId, userId);

  const tombstone = (entity: 'card' | 'habit', id: string, at = nowIso()) =>
    db
      .prepare(
        `INSERT INTO deletions (entity, id, user_id, deleted_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(entity, id) DO UPDATE SET deleted_at = excluded.deleted_at`,
      )
      .run(entity, id, userId, at);

  const cards = {
    range(from: string, to: string): CardRow[] {
      return db
        .prepare(
          `SELECT * FROM cards WHERE user_id = ? AND day >= ? AND day <= ?
           ORDER BY day, sort_index, created_at`,
        )
        .all(userId, from, to) as unknown as CardRow[];
    },

    get(id: string): CardRow | undefined {
      return db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(id, userId) as
        | CardRow
        | undefined;
    },

    /** O güne ait mevcut sort_index'ler — yeni kartın nereye gireceğini hesaplamak için. */
    dayIndexes(day: string): number[] {
      const rows = db
        .prepare('SELECT sort_index FROM cards WHERE user_id = ? AND day = ?')
        .all(userId, day) as { sort_index: number }[];
      return rows.map((r) => r.sort_index);
    },

    create(input: {
      id?: string;
      day: string;
      title?: string;
      note?: string;
      startTime?: string | null;
      endTime?: string | null;
      color?: string;
      done?: boolean;
      habitId?: string | null;
      checklist?: ChecklistItem[];
      sortIndex?: number;
      createdAt?: string;
    }): CardRow {
      const at = input.createdAt ?? nowIso();
      const id = input.id ?? newId();
      const sortIndex =
        input.sortIndex ?? defaultSortIndex(input.startTime ?? null, cards.dayIndexes(input.day));
      db.prepare(
        `INSERT INTO cards (id, user_id, day, title, note, start_time, end_time, color, done,
                            sort_index, manual_sort, habit_id, checklist_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        id,
        userId,
        input.day,
        input.title ?? '',
        input.note ?? '',
        input.startTime ?? null,
        input.endTime ?? null,
        input.color ?? 'red',
        input.done ? 1 : 0,
        sortIndex,
        input.habitId ?? null,
        JSON.stringify(input.checklist ?? []),
        at,
        at,
      );
      return cards.get(id)!;
    },

    update(
      id: string,
      patch: Partial<{
        day: string;
        title: string;
        note: string;
        startTime: string | null;
        endTime: string | null;
        color: string;
        done: boolean;
        sortIndex: number;
        manualSort: boolean;
        checklist: ChecklistItem[];
      }>,
    ): CardRow | undefined {
      const current = cards.get(id);
      if (!current) return undefined;

      const columns: Record<string, string> = {
        day: 'day',
        title: 'title',
        note: 'note',
        startTime: 'start_time',
        endTime: 'end_time',
        color: 'color',
        done: 'done',
        sortIndex: 'sort_index',
        manualSort: 'manual_sort',
        checklist: 'checklist_json',
      };
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in patch)) continue;
        const raw = (patch as Record<string, unknown>)[key];
        sets.push(`${column} = ?`);
        if (key === 'checklist') values.push(JSON.stringify(raw));
        else values.push(typeof raw === 'boolean' ? (raw ? 1 : 0) : (raw as string | number | null));
      }

      // Saati ya da günü değişen, elle taşınmamış kartın sırası saate göre yeniden kurulur.
      // manualSort:false gönderilirse kullanıcı "saate göre sırala"yı seçmiştir; sıra sıfırlanır.
      const timeChanged = 'startTime' in patch && patch.startTime !== current.start_time;
      const dayChanged = 'day' in patch && patch.day !== current.day;
      const resetOrder = patch.manualSort === false;
      const recompute = resetOrder || ((timeChanged || dayChanged) && !current.manual_sort);
      if (recompute && patch.sortIndex === undefined) {
        const day = patch.day ?? current.day;
        const startTime = 'startTime' in patch ? (patch.startTime ?? null) : current.start_time;
        sets.push('sort_index = ?');
        values.push(defaultSortIndex(startTime, cards.dayIndexes(day)));
      }

      if (sets.length === 0) return current;
      sets.push('updated_at = ?');
      values.push(nowIso(), id, userId);
      db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
      return cards.get(id);
    },

    /** Silinen kartın resim satırlarını döner — dosyaları çağıran taraf temizler. */
    remove(id: string): CardImageRow[] {
      const card = cards.get(id);
      if (!card) return [];
      const files = images.forCard(id);
      db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(id, userId);
      tombstone('card', id);
      return files;
    },

    changedSince(since: string): CardRow[] {
      return db
        .prepare('SELECT * FROM cards WHERE user_id = ? AND updated_at > ? ORDER BY updated_at')
        .all(userId, since) as unknown as CardRow[];
    },

    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?').get(userId) as {
        n: number;
      };
      return row.n;
    },

    touch,
  };

  const images = {
    forCard(cardId: string): CardImageRow[] {
      return db
        .prepare(
          'SELECT * FROM card_images WHERE card_id = ? AND user_id = ? ORDER BY position, created_at',
        )
        .all(cardId, userId) as unknown as CardImageRow[];
    },

    forCards(cardIds: string[]): CardImageRow[] {
      if (cardIds.length === 0) return [];
      const holes = cardIds.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT * FROM card_images WHERE user_id = ? AND card_id IN (${holes})
           ORDER BY position, created_at`,
        )
        .all(userId, ...cardIds) as unknown as CardImageRow[];
    },

    get(id: string): CardImageRow | undefined {
      return db.prepare('SELECT * FROM card_images WHERE id = ? AND user_id = ?').get(id, userId) as
        | CardImageRow
        | undefined;
    },

    add(input: {
      cardId: string;
      file: string;
      thumb: string;
      bytes: number;
      width: number;
      height: number;
    }): CardImageRow {
      const id = newId();
      const at = nowIso();
      const maxRow = db
        .prepare('SELECT MAX(position) AS max FROM card_images WHERE card_id = ? AND user_id = ?')
        .get(input.cardId, userId) as { max: number | null };
      db.prepare(
        `INSERT INTO card_images (id, card_id, user_id, file, thumb, bytes, width, height, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.cardId,
        userId,
        input.file,
        input.thumb,
        input.bytes,
        input.width,
        input.height,
        (maxRow.max ?? -1) + 1,
        at,
      );
      touch(input.cardId, at); // senkron birimi karttır: resim değişince kart da tazelenir
      return images.get(id)!;
    },

    remove(id: string): CardImageRow | undefined {
      const image = images.get(id);
      if (!image) return undefined;
      db.prepare('DELETE FROM card_images WHERE id = ? AND user_id = ?').run(id, userId);
      touch(image.card_id);
      return image;
    },

    totalBytes(): number {
      const row = db
        .prepare('SELECT COALESCE(SUM(bytes), 0) AS total FROM card_images WHERE user_id = ?')
        .get(userId) as { total: number };
      return row.total ?? 0;
    },

    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM card_images WHERE user_id = ?').get(userId) as {
        n: number;
      };
      return row.n;
    },
  };

  const habits = {
    list(): HabitRow[] {
      return db.prepare('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at').all(userId) as unknown as HabitRow[];
    },

    get(id: string): HabitRow | undefined {
      return db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(id, userId) as
        | HabitRow
        | undefined;
    },

    create(input: {
      id?: string;
      title?: string;
      note?: string;
      startTime?: string | null;
      endTime?: string | null;
      color?: string;
      weekdays: number[];
      reminders: number[];
    }): HabitRow {
      const id = input.id ?? newId();
      const at = nowIso();
      db.prepare(
        `INSERT INTO habits (id, user_id, title, note, start_time, end_time, color, weekdays,
                             reminders, active, materialized_until, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
      ).run(
        id,
        userId,
        input.title ?? '',
        input.note ?? '',
        input.startTime ?? null,
        input.endTime ?? null,
        input.color ?? 'red',
        input.weekdays.join(','),
        input.reminders.join(','),
        at,
        at,
      );
      return habits.get(id)!;
    },

    update(
      id: string,
      patch: Partial<{
        title: string;
        note: string;
        startTime: string | null;
        endTime: string | null;
        color: string;
        weekdays: number[];
        reminders: number[];
        active: boolean;
        materializedUntil: string | null;
      }>,
    ): HabitRow | undefined {
      if (!habits.get(id)) return undefined;
      const columns: Record<string, string> = {
        title: 'title',
        note: 'note',
        startTime: 'start_time',
        endTime: 'end_time',
        color: 'color',
        weekdays: 'weekdays',
        reminders: 'reminders',
        active: 'active',
        materializedUntil: 'materialized_until',
      };
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in patch)) continue;
        const raw = (patch as Record<string, unknown>)[key];
        sets.push(`${column} = ?`);
        if (Array.isArray(raw)) values.push(raw.join(','));
        else if (typeof raw === 'boolean') values.push(raw ? 1 : 0);
        else values.push(raw as string | number | null);
      }
      if (sets.length === 0) return habits.get(id);
      sets.push('updated_at = ?');
      values.push(nowIso(), id, userId);
      db.prepare(`UPDATE habits SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
      return habits.get(id);
    },

    /** Davranışı siler. Ondan türemiş kartlara dokunmaz — hepsi bağımsızdır. */
    remove(id: string): boolean {
      if (!habits.get(id)) return false;
      db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(id, userId);
      tombstone('habit', id);
      return true;
    },

    changedSince(since: string): HabitRow[] {
      return db
        .prepare('SELECT * FROM habits WHERE user_id = ? AND updated_at > ? ORDER BY updated_at')
        .all(userId, since) as unknown as HabitRow[];
    },
  };

  const reminders = {
    forCards(cardIds: string[]): ReminderRow[] {
      if (cardIds.length === 0) return [];
      const holes = cardIds.map(() => '?').join(',');
      return db
        .prepare(`SELECT * FROM card_reminders WHERE user_id = ? AND card_id IN (${holes})`)
        .all(userId, ...cardIds) as unknown as ReminderRow[];
    },

    forCard(cardId: string): ReminderRow[] {
      return db
        .prepare(
          'SELECT * FROM card_reminders WHERE user_id = ? AND card_id = ? ORDER BY offset_minutes DESC',
        )
        .all(userId, cardId) as unknown as ReminderRow[];
    },

    /**
     * Kartın hatırlatma setini istenen hâle getirir. Zaten gönderilmiş satırların
     * zamanı güncellenmez — aynı hatırlatma ikinci kez gitmesin diye.
     */
    replace(cardId: string, wanted: { offset: number; fireAt: string }[]) {
      const existing = reminders.forCard(cardId);
      const wantedOffsets = new Set(wanted.map((w) => w.offset));

      for (const row of existing) {
        if (!wantedOffsets.has(row.offset_minutes)) {
          db.prepare('DELETE FROM card_reminders WHERE id = ? AND user_id = ?').run(row.id, userId);
        }
      }
      for (const item of wanted) {
        const found = existing.find((r) => r.offset_minutes === item.offset);
        if (!found) {
          db.prepare(
            `INSERT INTO card_reminders (id, card_id, user_id, offset_minutes, fire_at, sent_at, status)
             VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
          ).run(newId(), cardId, userId, item.offset, item.fireAt);
        } else if (found.fire_at !== item.fireAt && found.sent_at === null) {
          db.prepare('UPDATE card_reminders SET fire_at = ? WHERE id = ? AND user_id = ?').run(
            item.fireAt,
            found.id,
            userId,
          );
        }
      }
    },

    pendingCount(): number {
      const row = db
        .prepare('SELECT COUNT(*) AS n FROM card_reminders WHERE user_id = ? AND sent_at IS NULL')
        .get(userId) as { n: number };
      return row.n;
    },
  };

  const deletions = {
    since(at: string) {
      return db
        .prepare(
          `SELECT entity, id, deleted_at FROM deletions WHERE user_id = ? AND deleted_at > ?
           ORDER BY deleted_at`,
        )
        .all(userId, at) as { entity: string; id: string; deleted_at: string }[];
    },
  };

  return { userId, cards, images, habits, reminders, deletions };
}

export type Repo = ReturnType<typeof repo>;
