import { describe, expect, it } from 'vitest';
import { addTag, normalizeTag, tagColorIndex } from './tags.ts';

describe('card tags', () => {
  it('etiketi normalize eder ve Türkçe büyük-küçük harf tekrarını engeller', () => {
    expect(normalizeTag('  Kolay   İş ')).toBe('Kolay İş');
    expect(addTag(['İş'], 'iş').error).toBe('Bu etiket zaten ekli.');
    expect(addTag(['Backend API'], 'backend api').error).toBe('Bu etiket zaten ekli.');
    expect(addTag(['Backend'], ' API ').tags).toEqual(['Backend', 'API']);
  });

  it('uzunluk ve adet sınırını uygular, rengi kararlı üretir', () => {
    expect(addTag([], 'x'.repeat(31)).error).toContain('30');
    expect(addTag(Array.from({ length: 10 }, (_, i) => `tag-${i}`), 'fazla').error).toContain('10');
    expect(tagColorIndex('Backend')).toBe(tagColorIndex('Backend'));
    expect(tagColorIndex('Backend')).toBeGreaterThanOrEqual(0);
    expect(tagColorIndex('Backend')).toBeLessThan(8);
  });
});
