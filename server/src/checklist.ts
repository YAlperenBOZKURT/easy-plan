import { newId } from './ids.ts';
import type { ChecklistItem } from './types.ts';

export const MAX_CHECKLIST_ITEMS = 50;
export const MAX_CHECKLIST_TEXT = 500;

export const isChecklistComplete = (items: ChecklistItem[]): boolean =>
  items.length > 0 && items.every((item) => item.done);

export function parseChecklist(value: string): ChecklistItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return sanitizeChecklist(parsed, false).items;
  } catch {
    return [];
  }
}

export function sanitizeChecklist(
  value: unknown,
  generateMissingIds = true,
): { valid: boolean; items: ChecklistItem[] } {
  if (!Array.isArray(value) || value.length > MAX_CHECKLIST_ITEMS) {
    return { valid: false, items: [] };
  }

  const ids = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { valid: false, items: [] };
    }
    const input = raw as Record<string, unknown>;
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (text.length === 0 || text.length > MAX_CHECKLIST_TEXT) {
      return { valid: false, items: [] };
    }

    let id = typeof input.id === 'string' ? input.id.trim() : '';
    if (id.length === 0 && generateMissingIds) id = newId();
    if (id.length === 0 || id.length > 100 || ids.has(id)) {
      return { valid: false, items: [] };
    }
    ids.add(id);
    items.push({ id, text, done: input.done === true });
  }
  return { valid: true, items };
}
