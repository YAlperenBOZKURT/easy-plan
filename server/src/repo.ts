import type { Db } from './db.ts';
import { newId, nowIso } from './ids.ts';
import { defaultSortIndex } from './sorting.ts';
import { parseTags, uniqueTags } from './tags.ts';
import { createPersonalBoard } from './boards.ts';
import type {
  CardImageRow,
  CardPriority,
  CardRow,
  CardTemplateRow,
  CardTemplateImageRow,
  BoardRole,
  ChecklistItem,
  HabitRow,
  ReminderRow,
} from './types.ts';

/**
 * Kullanıcıya bağlı veri erişimi.
 *
 * Uygulamanın hiçbir yerinde cards/habits/card_images tablolarına doğrudan
 * dokunulmaz; hepsi buradan geçer ve her sorgu user_id ile sınırlanır. Böylece
 * "WHERE user_id = ?" yazmayı unutmak mümkün değildir — çok kullanıcılı bir
 * kurulumda en kolay yapılan hata budur.
 */
export function repo(
  db: Db,
  userId: string,
  selectedBoardId?: string,
  boardRole: BoardRole = 'owner',
) {
  const boardId = selectedBoardId ?? createPersonalBoard(db, userId).id;
  const assertBoardWrite = () => {
    if (boardRole === 'viewer') {
      const error = new Error('board_forbidden') as Error & { statusCode: number; code: string };
      error.statusCode = 403;
      error.code = 'board_forbidden';
      throw error;
    }
  };
  const touch = (cardId: string, at = nowIso(), detachTemplate = true) =>
    db.prepare(
      `UPDATE cards SET updated_at = ?${detachTemplate ? ', template_id = NULL' : ''}
       WHERE id = ? AND board_id = ?`,
    ).run(at, cardId, boardId);

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
          `SELECT * FROM cards WHERE board_id = ? AND archived_at IS NULL AND trashed_at IS NULL
           AND day >= ? AND day <= ?
           ORDER BY day, sort_index, created_at`,
        )
        .all(boardId, from, to) as unknown as CardRow[];
    },

    search(match: string, limit: number): CardRow[] {
      return db
        .prepare(
          `SELECT c.* FROM card_search
           JOIN cards c ON c.id = card_search.card_id
           WHERE c.board_id = ? AND card_search MATCH ?
             AND c.archived_at IS NULL AND c.trashed_at IS NULL
           ORDER BY bm25(card_search), c.day DESC, c.sort_index, c.created_at
           LIMIT ?`,
        )
        .all(boardId, match, limit) as unknown as CardRow[];
    },

    get(id: string): CardRow | undefined {
      return db
        .prepare(
          'SELECT * FROM cards WHERE id = ? AND board_id = ? AND archived_at IS NULL AND trashed_at IS NULL',
        )
        .get(id, boardId) as
        | CardRow
        | undefined;
    },

    getAny(id: string): CardRow | undefined {
      return db.prepare('SELECT * FROM cards WHERE id = ? AND board_id = ?').get(id, boardId) as
        | CardRow
        | undefined;
    },

    lifecycle(state: 'archived' | 'trash'): CardRow[] {
      const column = state === 'archived' ? 'archived_at' : 'trashed_at';
      return db
        .prepare(
          `SELECT * FROM cards WHERE board_id = ? AND ${column} IS NOT NULL
           ORDER BY ${column} DESC, day DESC, sort_index`,
        )
        .all(boardId) as unknown as CardRow[];
    },

    /** O güne ait mevcut sort_index'ler — yeni kartın nereye gireceğini hesaplamak için. */
    dayIndexes(day: string): number[] {
      const rows = db
        .prepare(
          'SELECT sort_index FROM cards WHERE board_id = ? AND day = ? AND archived_at IS NULL AND trashed_at IS NULL',
        )
        .all(boardId, day) as { sort_index: number }[];
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
      templateId?: string | null;
      checklist?: ChecklistItem[];
      priority?: CardPriority;
      deadlineAt?: string | null;
      tags?: string[];
      sortIndex?: number;
      createdAt?: string;
    }): CardRow {
      assertBoardWrite();
      const at = input.createdAt ?? nowIso();
      const id = input.id ?? newId();
      const sortIndex =
        input.sortIndex ?? defaultSortIndex(input.startTime ?? null, cards.dayIndexes(input.day));
      db.prepare(
        `INSERT INTO cards (id, user_id, board_id, day, title, note, start_time, end_time, color, done,
                            sort_index, manual_sort, habit_id, template_id, checklist_json, priority, deadline_at,
                            tags_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        userId,
        boardId,
        input.day,
        input.title ?? '',
        input.note ?? '',
        input.startTime ?? null,
        input.endTime ?? null,
        input.color ?? 'red',
        input.done ? 1 : 0,
        sortIndex,
        input.habitId ?? null,
        input.templateId ?? null,
        JSON.stringify(input.checklist ?? []),
        input.priority ?? 'none',
        input.deadlineAt ?? null,
        JSON.stringify(input.tags ?? []),
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
        priority: CardPriority;
        deadlineAt: string | null;
        tags: string[];
      }>,
      options: { preserveTemplate?: boolean } = {},
    ): CardRow | undefined {
      assertBoardWrite();
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
        priority: 'priority',
        deadlineAt: 'deadline_at',
        tags: 'tags_json',
      };
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in patch)) continue;
        const raw = (patch as Record<string, unknown>)[key];
        sets.push(`${column} = ?`);
        if (key === 'checklist' || key === 'tags') values.push(JSON.stringify(raw));
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
      if (!options.preserveTemplate && current.template_id) sets.push('template_id = NULL');
      sets.push('updated_at = ?');
      values.push(nowIso(), id, boardId);
      db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ? AND board_id = ?`).run(...values);
      return cards.get(id);
    },

    /** Silinen kartın resim satırlarını döner — dosyaları çağıran taraf temizler. */
    remove(id: string): CardImageRow[] {
      assertBoardWrite();
      const card = cards.getAny(id);
      if (!card) return [];
      const files = images.forCard(id);
      db.prepare('DELETE FROM cards WHERE id = ? AND board_id = ?').run(id, boardId);
      tombstone('card', id);
      return files;
    },

    archive(id: string): CardRow | undefined {
      assertBoardWrite();
      const card = cards.get(id);
      if (!card) return undefined;
      const at = nowIso();
      db.prepare(
        'UPDATE cards SET archived_at = ?, trashed_at = NULL, template_id = NULL, updated_at = ? WHERE id = ? AND board_id = ?',
      ).run(at, at, id, boardId);
      tombstone('card', id, at);
      return cards.getAny(id);
    },

    trash(id: string): CardRow | undefined {
      assertBoardWrite();
      const card = cards.getAny(id);
      if (!card || card.trashed_at) return undefined;
      const at = nowIso();
      db.prepare(
        'UPDATE cards SET archived_at = NULL, trashed_at = ?, template_id = NULL, updated_at = ? WHERE id = ? AND board_id = ?',
      ).run(at, at, id, boardId);
      tombstone('card', id, at);
      return cards.getAny(id);
    },

    restore(id: string): CardRow | undefined {
      assertBoardWrite();
      const card = cards.getAny(id);
      if (!card || (!card.archived_at && !card.trashed_at)) return undefined;
      const at = nowIso();
      db.prepare(
        'UPDATE cards SET archived_at = NULL, trashed_at = NULL, updated_at = ? WHERE id = ? AND board_id = ?',
      ).run(at, id, boardId);
      db.prepare("DELETE FROM deletions WHERE entity = 'card' AND id = ? AND user_id = ?").run(id, userId);
      return cards.get(id);
    },

    changedSince(since: string): CardRow[] {
      return db
        .prepare(
          `SELECT * FROM cards WHERE board_id = ? AND updated_at > ?
           AND archived_at IS NULL AND trashed_at IS NULL ORDER BY updated_at`,
        )
        .all(boardId, since) as unknown as CardRow[];
    },

    linkedToTemplate(templateId: string): CardRow[] {
      return db
        .prepare(
          `SELECT * FROM cards WHERE user_id = ? AND template_id = ?
           AND archived_at IS NULL AND trashed_at IS NULL ORDER BY day, sort_index`,
        )
        .all(userId, templateId) as unknown as CardRow[];
    },

    linkTemplate(id: string, templateId: string): CardRow | undefined {
      assertBoardWrite();
      if (!cards.get(id)) return undefined;
      db.prepare(
        'UPDATE cards SET template_id = ?, updated_at = ? WHERE id = ? AND board_id = ?',
      ).run(templateId, nowIso(), id, boardId);
      return cards.get(id);
    },

    count(): number {
      const row = db
        .prepare(
          'SELECT COUNT(*) AS n FROM cards WHERE board_id = ? AND archived_at IS NULL AND trashed_at IS NULL',
        )
        .get(boardId) as {
        n: number;
      };
      return row.n;
    },

    allTags(): string[] {
      const rows = db
        .prepare(
          'SELECT tags_json FROM cards WHERE board_id = ? AND archived_at IS NULL AND trashed_at IS NULL',
        )
        .all(boardId) as { tags_json: string }[];
      return uniqueTags(rows.map((row) => parseTags(row.tags_json)));
    },

    touch,
  };

  const images = {
    forCard(cardId: string): CardImageRow[] {
      return db
        .prepare(
          `SELECT i.* FROM card_images i JOIN cards c ON c.id = i.card_id
           WHERE i.card_id = ? AND c.board_id = ? ORDER BY i.position, i.created_at`,
        )
        .all(cardId, boardId) as unknown as CardImageRow[];
    },

    forCards(cardIds: string[]): CardImageRow[] {
      if (cardIds.length === 0) return [];
      const holes = cardIds.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT i.* FROM card_images i JOIN cards c ON c.id = i.card_id
           WHERE c.board_id = ? AND i.card_id IN (${holes}) ORDER BY i.position, i.created_at`,
        )
        .all(boardId, ...cardIds) as unknown as CardImageRow[];
    },

    get(id: string): CardImageRow | undefined {
      return db.prepare(
        `SELECT i.* FROM card_images i JOIN cards c ON c.id = i.card_id
         WHERE i.id = ? AND c.board_id = ?`,
      ).get(id, boardId) as
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
      assertBoardWrite();
      const id = newId();
      const at = nowIso();
      const maxRow = db
        .prepare('SELECT MAX(position) AS max FROM card_images WHERE card_id = ?')
        .get(input.cardId) as { max: number | null };
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

    /** Aynı fiziksel dosyayı yeni karta bağlar; dosya diskte yeniden üretilmez. */
    cloneForCard(
      cardId: string,
      sources: Array<Pick<CardImageRow | CardTemplateImageRow, 'file' | 'thumb' | 'bytes' | 'width' | 'height' | 'position'>>,
    ): CardImageRow[] {
      assertBoardWrite();
      const seen = new Set<string>();
      for (const source of sources) {
        if (seen.has(source.file)) continue;
        seen.add(source.file);
        const id = newId();
        db.prepare(
          `INSERT INTO card_images
             (id, card_id, user_id, file, thumb, bytes, width, height, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, cardId, userId, source.file, source.thumb, source.bytes,
          source.width, source.height, source.position, nowIso(),
        );
      }
      if (seen.size > 0) touch(cardId, nowIso(), false);
      return images.forCard(cardId);
    },

    /** Şablon yayılımında görsel bağlantılarını, fiziksel dosyaları kopyalamadan yeniler. */
    replaceForCard(
      cardId: string,
      sources: Array<Pick<CardImageRow | CardTemplateImageRow, 'file' | 'thumb' | 'bytes' | 'width' | 'height' | 'position'>>,
    ): CardImageRow[] {
      assertBoardWrite();
      const removed = images.forCard(cardId);
      db.prepare('DELETE FROM card_images WHERE card_id = ?').run(cardId);
      images.cloneForCard(cardId, sources);
      if (sources.length === 0) touch(cardId, nowIso(), false);
      return removed;
    },

    /** Kart veya şablon bağlantısı kalmayan fiziksel dosyaları döndürür. */
    unreferenced<T extends Pick<CardImageRow, 'file' | 'thumb'>>(rows: T[]): T[] {
      const unique = new Map(rows.map((row) => [row.file, row]));
      return [...unique.values()].filter((row) => {
        const usedByCard = db
          .prepare('SELECT 1 FROM card_images WHERE file = ? LIMIT 1')
          .get(row.file);
        const usedByTemplate = db
          .prepare('SELECT 1 FROM card_template_images WHERE user_id = ? AND file = ? LIMIT 1')
          .get(userId, row.file);
        return !usedByCard && !usedByTemplate;
      });
    },

    remove(id: string): CardImageRow | undefined {
      assertBoardWrite();
      const image = images.get(id);
      if (!image) return undefined;
      db.prepare('DELETE FROM card_images WHERE id = ?').run(id);
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
        .prepare(
          `SELECT r.* FROM card_reminders r JOIN cards c ON c.id = r.card_id
           WHERE c.board_id = ? AND r.card_id IN (${holes})`,
        )
        .all(boardId, ...cardIds) as unknown as ReminderRow[];
    },

    forCard(cardId: string): ReminderRow[] {
      return db
        .prepare(
          `SELECT r.* FROM card_reminders r JOIN cards c ON c.id = r.card_id
           WHERE c.board_id = ? AND r.card_id = ? ORDER BY r.offset_minutes DESC`,
        )
        .all(boardId, cardId) as unknown as ReminderRow[];
    },

    /**
     * Kartın hatırlatma setini istenen hâle getirir. Zaten gönderilmiş satırların
     * zamanı güncellenmez — aynı hatırlatma ikinci kez gitmesin diye.
     */
    replace(cardId: string, wanted: { offset: number; fireAt: string }[]) {
      assertBoardWrite();
      const existing = reminders.forCard(cardId);
      const reminderOwner = cards.getAny(cardId)?.user_id ?? userId;
      const wantedOffsets = new Set(wanted.map((w) => w.offset));

      for (const row of existing) {
        if (!wantedOffsets.has(row.offset_minutes)) {
          db.prepare('DELETE FROM card_reminders WHERE id = ?').run(row.id);
        }
      }
      for (const item of wanted) {
        const found = existing.find((r) => r.offset_minutes === item.offset);
        if (!found) {
          db.prepare(
            `INSERT INTO card_reminders (id, card_id, user_id, offset_minutes, fire_at, sent_at, status)
             VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
          ).run(newId(), cardId, reminderOwner, item.offset, item.fireAt);
        } else if (found.fire_at !== item.fireAt && found.sent_at === null) {
          db.prepare('UPDATE card_reminders SET fire_at = ? WHERE id = ?').run(
            item.fireAt,
            found.id,
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

  const templates = {
    list(): CardTemplateRow[] {
      return db
        .prepare('SELECT * FROM card_templates WHERE user_id = ? ORDER BY updated_at DESC, name')
        .all(userId) as unknown as CardTemplateRow[];
    },

    get(id: string): CardTemplateRow | undefined {
      return db.prepare('SELECT * FROM card_templates WHERE id = ? AND user_id = ?').get(id, userId) as
        | CardTemplateRow
        | undefined;
    },

    create(input: {
      name: string;
      title?: string;
      note?: string;
      startTime?: string | null;
      endTime?: string | null;
      color?: string;
      checklist?: ChecklistItem[];
      priority?: CardPriority;
      tags?: string[];
      reminders?: number[];
      images?: CardImageRow[];
    }): CardTemplateRow {
      const id = newId();
      const at = nowIso();
      db.prepare(
        `INSERT INTO card_templates
           (id, user_id, name, title, note, start_time, end_time, color, checklist_json,
            priority, tags_json, reminders, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        userId,
        input.name,
        input.title ?? '',
        input.note ?? '',
        input.startTime ?? null,
        input.endTime ?? null,
        input.color ?? 'blue',
        JSON.stringify(input.checklist ?? []),
        input.priority ?? 'none',
        JSON.stringify(input.tags ?? []),
        (input.reminders ?? []).join(','),
        at,
        at,
      );
      const seen = new Set<string>();
      for (const image of input.images ?? []) {
        if (seen.has(image.file)) continue;
        seen.add(image.file);
        db.prepare(
          `INSERT INTO card_template_images
             (id, template_id, user_id, file, thumb, bytes, width, height, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId(), id, userId, image.file, image.thumb, image.bytes,
          image.width, image.height, image.position, at,
        );
      }
      return templates.get(id)!;
    },

    images(id: string): CardTemplateImageRow[] {
      return db
        .prepare(
          'SELECT * FROM card_template_images WHERE template_id = ? AND user_id = ? ORDER BY position, created_at',
        )
        .all(id, userId) as unknown as CardTemplateImageRow[];
    },

    image(id: string): CardTemplateImageRow | undefined {
      return db
        .prepare('SELECT * FROM card_template_images WHERE id = ? AND user_id = ?')
        .get(id, userId) as CardTemplateImageRow | undefined;
    },

    addImage(
      templateId: string,
      input: Pick<CardImageRow, 'file' | 'thumb' | 'bytes' | 'width' | 'height'>,
    ): CardTemplateImageRow | undefined {
      if (!templates.get(templateId)) return undefined;
      const existing = templates.images(templateId).find((image) => image.file === input.file);
      if (existing) return existing;
      const id = newId();
      const max = templates.images(templateId).reduce((value, image) => Math.max(value, image.position), -1);
      db.prepare(
        `INSERT INTO card_template_images
           (id, template_id, user_id, file, thumb, bytes, width, height, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, templateId, userId, input.file, input.thumb, input.bytes,
        input.width, input.height, max + 1, nowIso(),
      );
      db.prepare('UPDATE card_templates SET updated_at = ? WHERE id = ? AND user_id = ?').run(
        nowIso(), templateId, userId,
      );
      return templates.image(id);
    },

    removeImage(id: string): CardTemplateImageRow | undefined {
      const image = templates.image(id);
      if (!image) return undefined;
      db.prepare('DELETE FROM card_template_images WHERE id = ? AND user_id = ?').run(id, userId);
      db.prepare('UPDATE card_templates SET updated_at = ? WHERE id = ? AND user_id = ?').run(
        nowIso(), image.template_id, userId,
      );
      return image;
    },

    update(
      id: string,
      patch: Partial<{
        name: string;
        title: string;
        note: string;
        startTime: string | null;
        endTime: string | null;
        color: string;
        checklist: ChecklistItem[];
        priority: CardPriority;
        tags: string[];
        reminders: number[];
      }>,
    ): CardTemplateRow | undefined {
      if (!templates.get(id)) return undefined;
      const columns: Record<string, string> = {
        name: 'name', title: 'title', note: 'note', startTime: 'start_time', endTime: 'end_time',
        color: 'color', checklist: 'checklist_json', priority: 'priority', tags: 'tags_json',
        reminders: 'reminders',
      };
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in patch)) continue;
        const raw = (patch as Record<string, unknown>)[key];
        sets.push(`${column} = ?`);
        if (key === 'checklist' || key === 'tags') values.push(JSON.stringify(raw));
        else if (key === 'reminders') values.push((raw as number[]).join(','));
        else values.push(raw as string | number | null);
      }
      if (sets.length === 0) return templates.get(id);
      sets.push('updated_at = ?');
      values.push(nowIso(), id, userId);
      db.prepare(`UPDATE card_templates SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
      return templates.get(id);
    },

    remove(id: string): CardTemplateImageRow[] | undefined {
      if (!templates.get(id)) return undefined;
      const files = templates.images(id);
      db.prepare('DELETE FROM card_templates WHERE id = ? AND user_id = ?').run(id, userId);
      return files;
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

  return { userId, cards, images, habits, reminders, templates, deletions };
}

export type Repo = ReturnType<typeof repo>;
