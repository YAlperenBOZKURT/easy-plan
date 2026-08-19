import 'package:flutter_test/flutter_test.dart';
import 'package:planner/search.dart';

void main() {
  test('arama sorgusunu temizler ve tüm kelimeleri eşleştirir', () {
    expect(normalizeSearchQuery('  proje   sunumu '), 'proje sunumu');
    expect(
      cardTextMatches('Proje sunumu', 'Müşteri taslağı', 'proje müşteri'),
      isTrue,
    );
    expect(cardTextMatches('Proje sunumu', '', 'fatura'), isFalse);
    expect(cardTextMatches('A', '', 'a'), isFalse);
  });
}
