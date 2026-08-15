export type Role = 'admin' | 'user';

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

/** Kullanıcının seçebileceği hatırlatma aralıkları (dakika) */
export const REMINDER_OFFSETS = [1440, 720, 360, 180, 60] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

export const CARD_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type CardColor = (typeof CARD_COLORS)[number];
