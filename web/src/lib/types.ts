export interface CardImage {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Card {
  id: string;
  day: string;
  title: string;
  note: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
  done: boolean;
  sortIndex: number;
  manualSort: boolean;
  habitId: string | null;
  checklist: ChecklistItem[];
  reminders: number[];
  images: CardImage[];
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  title: string;
  note: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
  weekdays: number[];
  reminders: number[];
  active: boolean;
  materializedUntil: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  timezone: string;
  dailySummary: boolean;
  createdAt: string;
}

export interface AdminUser extends User {
  active: boolean;
  lastLoginAt: string | null;
  cards: number;
  habits: number;
  images: number;
  bytes: number;
  pendingReminders: number;
  sessions: number;
}

export interface AdminStats {
  users: number;
  activeUsers: number;
  cards: number;
  habits: number;
  images: number;
  imageBytes: number;
  pendingReminders: number;
  dbBytes: number;
  mailEnabled: boolean;
  mailsByDay: { day: string; status: string; n: number }[];
}

export const CARD_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;

/** Hatırlatma seçenekleri: kartın başlangıcına ne kadar kala mail gelsin. */
export const REMINDER_OPTIONS = [
  { minutes: 1440, label: '1 gün' },
  { minutes: 720, label: '12 saat' },
  { minutes: 360, label: '6 saat' },
  { minutes: 180, label: '3 saat' },
  { minutes: 60, label: '1 saat' },
] as const;
