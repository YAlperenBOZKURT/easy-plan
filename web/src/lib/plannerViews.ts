import { addDays } from './dates.ts';

export type PlannerView = 'week' | 'month' | 'agenda' | 'completed';

export const PLANNER_VIEWS: ReadonlyArray<{ value: PlannerView; label: string }> = [
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Ay' },
  { value: 'agenda', label: 'Ajanda' },
  { value: 'completed', label: 'Tamamlananlar' },
];

const pad = (value: number) => String(value).padStart(2, '0');

const parseDay = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
};

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function addMonths(day: string, amount: number): string {
  const date = parseDay(day);
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return dayKey(target);
}

export function monthBounds(day: string): { from: string; to: string } {
  const date = parseDay(day);
  return {
    from: dayKey(new Date(date.getFullYear(), date.getMonth(), 1)),
    to: dayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

export function monthGridBounds(day: string): { from: string; to: string } {
  const month = monthBounds(day);
  const first = parseDay(month.from);
  const last = parseDay(month.to);
  const before = (first.getDay() + 6) % 7;
  const after = 6 - ((last.getDay() + 6) % 7);
  return { from: addDays(month.from, -before), to: addDays(month.to, after) };
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function plannerRange(
  view: PlannerView,
  anchor: string,
  visibleDays: number,
): { from: string; to: string } {
  if (view === 'week') return { from: anchor, to: addDays(anchor, visibleDays - 1) };
  return view === 'month' ? monthGridBounds(anchor) : monthBounds(anchor);
}

export function shiftPlannerAnchor(view: PlannerView, anchor: string, delta: number): string {
  return view === 'week' ? addDays(anchor, delta) : addMonths(anchor, delta);
}

const months = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

export function monthLabel(day: string): string {
  const date = parseDay(day);
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}
