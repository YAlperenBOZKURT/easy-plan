export const MIN_SEARCH_QUERY_LENGTH = 2;
export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_SEARCH_RESULTS = 50;

export function readSearchQuery(value: unknown):
  | { valid: true; query: string; match: string }
  | { valid: false } {
  if (typeof value !== 'string') return { valid: false };
  const query = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (query.length < MIN_SEARCH_QUERY_LENGTH || query.length > MAX_SEARCH_QUERY_LENGTH) {
    return { valid: false };
  }

  // Her kelimeyi ayrı quoted-prefix terimine çevirerek FTS operatörü enjeksiyonunu
  // önler ve kullanıcı yazarken tamamlanmamış son kelimeyi de eşleştirir.
  const match = query
    .split(' ')
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' AND ');
  return { valid: true, query, match };
}
