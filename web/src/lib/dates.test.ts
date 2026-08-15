import { describe, expect, it } from 'vitest';
import {
  addDays,
  addYears,
  dayName,
  dayNameShort,
  formatBytes,
  rangeLabel,
  shortDate,
  weekdayOf,
} from './dates.ts';

describe('date helpers', () => {
  it('ay ve yıl sınırlarında gün ekler', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addYears('2026-08-15', 1)).toBe('2027-08-15');
  });

  it('Türkçe gün ve tarih etiketleri üretir', () => {
    expect(dayName('2026-08-15')).toBe('Cumartesi');
    expect(dayNameShort('2026-08-15')).toBe('Cmt');
    expect(weekdayOf('2026-08-16')).toBe(7);
    expect(shortDate('2026-08-15')).toBe('15 Ağu');
    expect(rangeLabel('2026-08-15', '2026-08-21')).toBe('15 Ağu – 21 Ağu 2026');
  });

  it('dosya boyutlarını okunabilir biçime çevirir', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
    expect(formatBytes(2_147_483_648)).toBe('2.00 GB');
  });
});
