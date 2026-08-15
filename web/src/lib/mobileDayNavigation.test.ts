import { describe, expect, it } from 'vitest';
import {
  centeredColumnScrollLeft,
  closestDayToViewportCenter,
} from './mobileDayNavigation.ts';

describe('mobile day navigation', () => {
  it('ekran merkezindeki gerçek kolonu gün olarak seçer', () => {
    const day = closestDayToViewportCenter(0, 390, [
      { day: '2026-08-17', left: -390, width: 366 },
      { day: '2026-08-18', left: 12, width: 366 },
      { day: '2026-08-19', left: 390, width: 366 },
    ]);

    expect(day).toBe('2026-08-18');
  });

  it('padding ve gap olsa da hedef kolonu tam ortaya taşıyan konumu hesaplar', () => {
    expect(centeredColumnScrollLeft(0, 0, 390, 390, 366)).toBe(378);
    expect(centeredColumnScrollLeft(378, 0, 390, 12, 366)).toBe(378);
  });

  it('kolon yoksa aktif gün üretmez', () => {
    expect(closestDayToViewportCenter(0, 390, [])).toBeNull();
  });
});
