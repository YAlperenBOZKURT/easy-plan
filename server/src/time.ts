/**
 * Saat dilimi yardımcıları — ek bağımlılık yok, Intl üzerinden.
 *
 * Kartın günü ('YYYY-MM-DD') ve saati ('HH:MM') kullanıcının kendi saat diliminde
 * yazılır; hatırlatma zamanı UTC'ye çevrilerek saklanır. Böylece sunucu nerede
 * çalışırsa çalışsın mail doğru anda gider.
 */

const partsFormatter = (tz: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function partsAt(date: Date, tz: string) {
  const parts = partsFormatter(tz).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24, // bazı ortamlar gece yarısını 24 olarak verir
    minute: get('minute'),
    second: get('second'),
  };
}

/** Verilen anda, o saat diliminin UTC'ye göre farkı (ms). */
function offsetAt(date: Date, tz: string): number {
  const p = partsAt(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** O saat diliminde bugünün tarihi: 'YYYY-MM-DD' */
export function today(tz: string, now = new Date()): string {
  const p = partsAt(now, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Yerel duvar saatini ('YYYY-MM-DD' + 'HH:MM') UTC anına çevirir. */
export function zonedToUtc(day: string, time: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const firstOffset = offsetAt(new Date(guess), tz);
  let stamp = guess - firstOffset;
  // Yaz saati geçişlerinde tek geçiş yetmez; ikinci düzeltme yapılır.
  const secondOffset = offsetAt(new Date(stamp), tz);
  if (secondOffset !== firstOffset) stamp = guess - secondOffset;
  return new Date(stamp);
}

/** 'YYYY-MM-DD' + n gün (takvim günü aritmetiği, saat dilimi bağımsız). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addYears(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y + n, m - 1, d));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Haftanın günü: 1 = Pazartesi … 7 = Pazar (davranışlarda kullanılan gösterim). */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Pazar
  return js === 0 ? 7 : js;
}

export const isValidDay = (day: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));

export const isValidTime = (time: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/** Saat dilimi içeren ISO-8601 anı. Tarih-only ve sunucu yerel saatine bağlı değerler kabul edilmez. */
export function isValidInstant(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, zone, , offsetHourRaw, offsetMinuteRaw] = match;
  const [year, month, day, hour, minute, second] = [
    yearRaw,
    monthRaw,
    dayRaw,
    hourRaw,
    minuteRaw,
    secondRaw ?? '0',
  ].map(Number);
  const calendar = new Date(Date.UTC(year!, month! - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month! - 1 ||
    calendar.getUTCDate() !== day ||
    hour! > 23 ||
    minute! > 59 ||
    second! > 59
  ) return false;
  if (zone !== 'Z') {
    const offsetHour = Number(offsetHourRaw);
    const offsetMinute = Number(offsetMinuteRaw);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

const pad = (n: number) => String(n).padStart(2, '0');
