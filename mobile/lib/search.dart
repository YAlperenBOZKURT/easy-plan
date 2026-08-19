const minSearchQueryLength = 2;
const maxSearchQueryLength = 100;
const maxSearchResults = 50;

String normalizeSearchQuery(String value) =>
    value.trim().replaceAll(RegExp(r'\s+'), ' ');

bool cardTextMatches(String title, String note, String query) {
  final normalized = normalizeSearchQuery(query).toLowerCase();
  if (normalized.length < minSearchQueryLength) return false;
  final haystack = '$title\n$note'.toLowerCase();
  return normalized.split(' ').every(haystack.contains);
}
