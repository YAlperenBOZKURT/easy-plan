export const MAX_CARD_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

export const normalizeTag = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ');

export const tagKey = (value: string): string =>
  normalizeTag(value).replace(/[Iİ]/g, 'i').toLowerCase();

export function addTag(tags: string[], value: string): { tags: string[]; error?: string } {
  const tag = normalizeTag(value);
  if (tag.length === 0) return { tags, error: 'Etiket boş olamaz.' };
  if (tag.length > MAX_TAG_LENGTH) return { tags, error: 'Etiket en fazla 30 karakter olabilir.' };
  if (tags.length >= MAX_CARD_TAGS) return { tags, error: 'Bir karta en fazla 10 etiket eklenebilir.' };
  if (tags.some((current) => tagKey(current) === tagKey(tag))) {
    return { tags, error: 'Bu etiket zaten ekli.' };
  }
  return { tags: [...tags, tag] };
}

export function tagColorIndex(tag: string): number {
  let hash = 0;
  for (const character of tag) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash % 8;
}
