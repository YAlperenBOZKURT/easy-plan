export type Role = 'admin' | 'user';
export type BoardRole = 'owner' | 'editor' | 'viewer';
export type CardActivityAction =
  | 'created'
  | 'updated'
  | 'moved'
  | 'completed'
  | 'reopened'
  | 'archived'
  | 'trashed'
  | 'restored'
  | 'deleted'
  | 'duplicated';

export interface CardActivityRow {
  id: string;
  board_id: string;
  card_id: string;
  actor_user_id: string | null;
  action: CardActivityAction;
  card_title: string;
  details_json: string;
  created_at: string;
}

export interface BoardRow {
  id: string;
  owner_id: string;
  name: string;
  is_personal: number;
  created_at: string;
  updated_at: string;
}

export interface BoardMemberRow {
  board_id: string;
  user_id: string;
  role: BoardRole;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  timezone: string;
  daily_summary: number;
  last_summary_day: string | null;
  active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardRow {
  id: string;
  user_id: string;
  board_id: string;
  day: string;
  title: string;
  note: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  done: number;
  sort_index: number;
  manual_sort: number;
  habit_id: string | null;
  template_id: string | null;
  checklist_json: string;
  priority: CardPriority;
  deadline_at: string | null;
  tags_json: string;
  archived_at: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardImageRow {
  id: string;
  card_id: string;
  user_id: string;
  file: string;
  thumb: string;
  bytes: number;
  width: number;
  height: number;
  position: number;
  created_at: string;
}

export interface HabitRow {
  id: string;
  user_id: string;
  title: string;
  note: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  weekdays: string;
  reminders: string;
  active: number;
  materialized_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderRow {
  id: string;
  card_id: string;
  user_id: string;
  offset_minutes: number;
  fire_at: string;
  sent_at: string | null;
  status: string | null;
}

export interface CardTemplateRow {
  id: string;
  user_id: string;
  name: string;
  title: string;
  note: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  checklist_json: string;
  priority: CardPriority;
  tags_json: string;
  reminders: string;
  created_at: string;
  updated_at: string;
}

export interface CardTemplateImageRow {
  id: string;
  template_id: string;
  user_id: string;
  file: string;
  thumb: string;
  bytes: number;
  width: number;
  height: number;
  position: number;
  created_at: string;
}

/** Kullanıcının seçebileceği hatırlatma aralıkları (dakika) */
export const REMINDER_OFFSETS = [1440, 720, 360, 180, 60] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

export const CARD_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export const CARD_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type CardPriority = (typeof CARD_PRIORITIES)[number];
