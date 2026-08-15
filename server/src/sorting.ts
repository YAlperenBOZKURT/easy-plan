/**
 * Kart sıralamasının tek kaynağı.
 *
 * Kural: saatli kartlar gün içinde kronolojik sırayla en üstte durur (sort_index =
 * başlangıç dakikası, 0–1439), saatsiz kartlar 1440'ın altına, eklenme sırasıyla
 * dizilir. Kullanıcı bir kartı sürüklerse komşularının ortasına yerleşir ve
 * manual_sort=1 olur — bu kartın saati sonradan değişse bile sırası bozulmaz.
 */

export const UNTIMED_BASE = 1440;
const GAP = 10;

/** 'HH:MM' → gün içindeki dakika. Geçersiz/boş değer null döner. */
export function minutesOf(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Yeni kartın (veya saati değişen kartın) varsayılan sırası. */
export function defaultSortIndex(startTime: string | null | undefined, dayIndexes: number[]): number {
  const minutes = minutesOf(startTime);
  if (minutes !== null) return minutes;
  const maxUntimed = dayIndexes.reduce((max, i) => (i > max ? i : max), UNTIMED_BASE - GAP);
  return Math.max(maxUntimed, UNTIMED_BASE - GAP) + GAP;
}

/** Sürükle-bırak sonrası: bırakılan yerin komşularına göre yeni index. */
export function indexBetween(before: number | null, after: number | null): number {
  if (before !== null && after !== null) return (before + after) / 2;
  if (after !== null) return after - GAP;
  if (before !== null) return before + GAP;
  return UNTIMED_BASE;
}
