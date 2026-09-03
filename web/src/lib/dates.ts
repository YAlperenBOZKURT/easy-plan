/** Tarih yardımcıları — gün anahtarı her yerde 'YYYY-MM-DD'. */

const pad = (n: number) => String(n).padStart(2, '0');

export const toDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const todayKey = (): string => toDay(new Date());

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return toDay(date);
}

export function addYears(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return toDay(new Date(y + n, m - 1, d));
}

const asDate = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

import type { AppLocale } from './i18n.tsx';

const dayNames = {
  tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const monthsShort = {
  tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

// Kısaltmalar elle yazılır: ilk üç harf alınırsa Cuma/Cumartesi ve Pazar/Pazartesi karışır.
const dayNamesShort = {
  tr: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export const dayName = (day: string, locale: AppLocale = 'tr'): string => dayNames[locale][asDate(day).getDay()]!;
export const dayNameShort = (day: string, locale: AppLocale = 'tr'): string => dayNamesShort[locale][asDate(day).getDay()]!;
export const dayNumber = (day: string): number => asDate(day).getDate();

/** '13 Ağu' */
export const shortDate = (day: string, locale: AppLocale = 'tr'): string => {
  const date = asDate(day);
  return locale === 'tr'
    ? `${date.getDate()} ${monthsShort.tr[date.getMonth()]}`
    : `${monthsShort.en[date.getMonth()]} ${date.getDate()}`;
};

/** '13 Ağu – 19 Ağu 2026' */
export const rangeLabel = (from: string, to: string, locale: AppLocale = 'tr'): string =>
  `${shortDate(from, locale)} – ${shortDate(to, locale)} ${asDate(to).getFullYear()}`;

/** Haftanın günü: 1 = Pazartesi … 7 = Pazar */
export const weekdayOf = (day: string): number => {
  const js = asDate(day).getDay();
  return js === 0 ? 7 : js;
};

export const WEEKDAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Pzt' },
  { value: 2, label: 'Sal' },
  { value: 3, label: 'Çar' },
  { value: 4, label: 'Per' },
  { value: 5, label: 'Cum' },
  { value: 6, label: 'Cmt' },
  { value: 7, label: 'Paz' },
];

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export const formatDateTime = (iso: string | null, locale: AppLocale = 'tr'): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};
