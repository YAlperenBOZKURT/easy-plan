import { describe, expect, it } from 'vitest';
import { deadlineFromInput, deadlineState, deadlineToInput } from './deadline.ts';

describe('card deadline', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');

  it('yaklaşan, geciken ve tamamlanan durumları ayırır', () => {
    expect(deadlineState(null, false, now)).toBe('none');
    expect(deadlineState('2026-08-20T15:00:00.000Z', false, now)).toBe('soon');
    expect(deadlineState('2026-08-22T15:00:00.000Z', false, now)).toBe('upcoming');
    expect(deadlineState('2026-08-20T10:00:00.000Z', false, now)).toBe('overdue');
    expect(deadlineState('2026-08-20T10:00:00.000Z', true, now)).toBe('completed');
  });

  it('yerel form değeri ile UTC API değeri arasında dönüşür', () => {
    const local = '2026-08-20T18:30';
    const expected = new Date(2026, 7, 20, 18, 30).toISOString();
    expect(deadlineFromInput(local)).toBe(expected);
    expect(deadlineToInput(expected)).toBe(local);
    expect(deadlineFromInput('')).toBeNull();
  });
});
