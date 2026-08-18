import type { CardImageRow, CardRow, HabitRow, ReminderRow, UserRow } from './types.ts';
import { parseChecklist } from './checklist.ts';
import { parseTags } from './tags.ts';

/** DB satırlarını istemcinin gördüğü şekle çevirir (camelCase, hash'siz, yol yerine URL). */

export const imageDto = (row: CardImageRow) => ({
  id: row.id,
  url: `/uploads/${row.file}`,
  thumbUrl: `/uploads/${row.thumb}`,
  width: row.width,
  height: row.height,
  bytes: row.bytes,
});

export function cardDto(card: CardRow, images: CardImageRow[] = [], reminders: ReminderRow[] = []) {
  return {
    id: card.id,
    day: card.day,
    title: card.title,
    note: card.note,
    startTime: card.start_time,
    endTime: card.end_time,
    color: card.color,
    done: card.done === 1,
    sortIndex: card.sort_index,
    manualSort: card.manual_sort === 1,
    habitId: card.habit_id,
    checklist: parseChecklist(card.checklist_json),
    priority: card.priority,
    deadlineAt: card.deadline_at,
    tags: parseTags(card.tags_json),
    reminders: reminders
      .filter((r) => r.card_id === card.id)
      .map((r) => r.offset_minutes)
      .sort((a, b) => b - a),
    images: images.filter((i) => i.card_id === card.id).map(imageDto),
    createdAt: card.created_at,
    updatedAt: card.updated_at,
  };
}

export const habitDto = (row: HabitRow) => ({
  id: row.id,
  title: row.title,
  note: row.note,
  startTime: row.start_time,
  endTime: row.end_time,
  color: row.color,
  weekdays: row.weekdays ? row.weekdays.split(',').map(Number) : [],
  reminders: row.reminders ? row.reminders.split(',').map(Number) : [],
  active: row.active === 1,
  materializedUntil: row.materialized_until,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const userDto = (row: UserRow) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  timezone: row.timezone,
  dailySummary: row.daily_summary === 1,
  createdAt: row.created_at,
});

export type CardDto = ReturnType<typeof cardDto>;
export type HabitDto = ReturnType<typeof habitDto>;
export type UserDto = ReturnType<typeof userDto>;
