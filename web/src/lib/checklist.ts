import type { ChecklistItem } from './types.ts';

export function normalizeChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items
    .slice(0, 50)
    .map((item) => ({ ...item, text: item.text.trim().slice(0, 500) }))
    .filter((item) => item.text.length > 0);
}

export function toggleChecklistItem(items: ChecklistItem[], itemId: string): ChecklistItem[] {
  return items.map((item) => item.id === itemId ? { ...item, done: !item.done } : item);
}

export const isChecklistComplete = (items: ChecklistItem[]): boolean =>
  items.length > 0 && items.every((item) => item.done);

export function checklistProgress(items: ChecklistItem[]) {
  const completed = items.filter((item) => item.done).length;
  return { completed, total: items.length, ratio: items.length === 0 ? 0 : completed / items.length };
}
