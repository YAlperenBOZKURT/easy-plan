import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysBetween,
  monthGridBounds,
  plannerRange,
  shiftPlannerAnchor,
} from './plannerViews.ts';

describe('planner views', () => {
  it('month navigation clamps the day at month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('month grid starts on Monday and ends on Sunday', () => {
    expect(monthGridBounds('2026-08-21')).toEqual({
      from: '2026-07-27',
      to: '2026-09-06',
    });
    expect(daysBetween('2026-07-27', '2026-09-06')).toHaveLength(42);
  });

  it('uses day navigation for week and month navigation for collection views', () => {
    expect(plannerRange('week', '2026-08-21', 7)).toEqual({
      from: '2026-08-21',
      to: '2026-08-27',
    });
    expect(shiftPlannerAnchor('week', '2026-08-21', 1)).toBe('2026-08-22');
    expect(shiftPlannerAnchor('agenda', '2026-08-21', 1)).toBe('2026-09-21');
  });
});
