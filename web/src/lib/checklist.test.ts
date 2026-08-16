import { describe, expect, it } from 'vitest';
import {
  checklistProgress,
  isChecklistComplete,
  normalizeChecklist,
  toggleChecklistItem,
} from './checklist.ts';

describe('card checklist', () => {
  const items = [
    { id: 'a', text: ' İlk iş ', done: false },
    { id: 'b', text: 'İkinci iş', done: true },
  ];

  it('boş maddeleri atar ve metni temizler', () => {
    expect(normalizeChecklist([...items, { id: 'c', text: '   ', done: false }])).toEqual([
      { id: 'a', text: 'İlk iş', done: false },
      { id: 'b', text: 'İkinci iş', done: true },
    ]);
  });

  it('yalnızca hedef maddeyi değiştirir ve ilerlemeyi hesaplar', () => {
    const toggled = toggleChecklistItem(items, 'a');
    expect(toggled.every((item) => item.done)).toBe(true);
    expect(checklistProgress(toggled)).toEqual({ completed: 2, total: 2, ratio: 1 });
    expect(isChecklistComplete(toggled)).toBe(true);
    expect(isChecklistComplete([])).toBe(false);
    expect(items[0]?.done).toBe(false);
  });
});
