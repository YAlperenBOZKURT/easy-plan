import 'package:flutter_test/flutter_test.dart';
import 'package:planner/tags.dart';

void main() {
  test('etiketi temizler ve büyük-küçük harf tekrarını engeller', () {
    final added = addCardTag(const [], '  Backend   API  ');
    expect(added.error, isNull);
    expect(added.tags, ['Backend API']);

    final duplicate = addCardTag(added.tags, 'backend api');
    expect(duplicate.tags, added.tags);
    expect(duplicate.error, isNotNull);

    expect(addCardTag(const ['İş'], 'iş').error, isNotNull);
  });

  test('etiket uzunluğu ve kart başına etiket sayısı sınırlıdır', () {
    final long = addCardTag(
      const [],
      List.filled(maxTagLength + 1, 'x').join(),
    );
    expect(long.error, isNotNull);

    final full = List.generate(maxCardTags, (index) => 'tag-$index');
    final overflow = addCardTag(full, 'extra');
    expect(overflow.tags, full);
    expect(overflow.error, isNotNull);
  });

  test('etiket rengi aynı metin için kararlıdır', () {
    expect(tagColorIndex('Backend'), tagColorIndex('Backend'));
    expect(tagColorIndex('Backend'), inInclusiveRange(0, 7));
  });
}
