import type { Db } from './db.ts';
import { newId, nowIso } from './ids.ts';
import type { CardActivityAction, CardActivityRow } from './types.ts';

export function recordCardActivity(
  database: Db,
  input: {
    boardId: string;
    cardId: string;
    actorUserId: string;
    action: CardActivityAction;
    cardTitle?: string;
    details?: Record<string, unknown>;
  },
): CardActivityRow {
  const id = newId();
  database
    .prepare(
      `INSERT INTO card_activity
         (id, board_id, card_id, actor_user_id, action, card_title, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.boardId,
      input.cardId,
      input.actorUserId,
      input.action,
      input.cardTitle?.slice(0, 200) ?? '',
      JSON.stringify(input.details ?? {}),
      nowIso(),
    );
  return database.prepare('SELECT * FROM card_activity WHERE id = ?').get(id) as unknown as CardActivityRow;
}

export function changedCardFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  requested: Record<string, unknown>,
): string[] {
  const map: Record<string, string> = {
    day: 'day',
    title: 'title',
    note: 'note',
    startTime: 'start_time',
    endTime: 'end_time',
    color: 'color',
    done: 'done',
    checklist: 'checklist_json',
    priority: 'priority',
    deadlineAt: 'deadline_at',
    tags: 'tags_json',
  };
  return Object.entries(map)
    .filter(([inputKey, column]) => inputKey in requested && before[column] !== after[column])
    .map(([inputKey]) => inputKey);
}
