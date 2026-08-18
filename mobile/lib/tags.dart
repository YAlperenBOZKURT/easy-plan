const maxCardTags = 10;
const maxTagLength = 30;

String normalizeTag(String value) =>
    value.trim().replaceAll(RegExp(r'\s+'), ' ');

({List<String> tags, String? error}) addCardTag(
  List<String> tags,
  String value,
) {
  final tag = normalizeTag(value);
  if (tag.isEmpty) return (tags: tags, error: 'Etiket boş olamaz.');
  if (tag.length > maxTagLength) {
    return (tags: tags, error: 'Etiket en fazla 30 karakter olabilir.');
  }
  if (tags.length >= maxCardTags) {
    return (tags: tags, error: 'Bir karta en fazla 10 etiket eklenebilir.');
  }
  if (tags.any((current) => current.toLowerCase() == tag.toLowerCase())) {
    return (tags: tags, error: 'Bu etiket zaten ekli.');
  }
  return (tags: [...tags, tag], error: null);
}

int tagColorIndex(String tag) {
  var hash = 0;
  for (final rune in tag.runes) {
    hash = (hash * 31 + rune) & 0x7fffffff;
  }
  return hash % 8;
}
