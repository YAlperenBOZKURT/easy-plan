export const MAX_CARD_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

const tagKey = (tag: string): string => tag.toLocaleLowerCase('tr-TR');

export function sanitizeTags(value: unknown): { valid: boolean; tags: string[] } {
  if (!Array.isArray(value) || value.length > MAX_CARD_TAGS) {
    return { valid: false, tags: [] };
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return { valid: false, tags: [] };
    const tag = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
    const key = tagKey(tag);
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH || seen.has(key)) {
      return { valid: false, tags: [] };
    }
    seen.add(key);
    tags.push(tag);
  }
  return { valid: true, tags };
}

export function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return sanitizeTags(parsed).tags;
  } catch {
    return [];
  }
}

export function uniqueTags(groups: Iterable<string[]>): string[] {
  const values = new Map<string, string>();
  for (const tags of groups) {
    for (const tag of tags) values.set(tagKey(tag), values.get(tagKey(tag)) ?? tag);
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b, 'tr-TR'));
}
