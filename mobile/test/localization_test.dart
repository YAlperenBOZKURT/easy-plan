import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/dates.dart';
import 'package:planner/localization.dart';
import 'package:planner/main.dart';
import 'package:planner/planner_views.dart';
import 'package:planner/store.dart';

void main() {
  test('Türkçe ve İngilizce katalogları doğru metni döndürür', () {
    expect(const AppStrings(Locale('tr')).text('planner.today'), 'Bugün');
    expect(const AppStrings(Locale('en')).text('planner.today'), 'Today');
    expect(dayName('2026-08-15', languageCode: 'en'), 'Saturday');
    expect(shortDate('2026-08-15', languageCode: 'en'), 'Aug 15');
    expect(
      plannerViewLabel(PlannerViewMode.completed, languageCode: 'en'),
      'Completed',
    );
  });

  testWidgets('uygulama seçili İngilizce dili giriş ekranına uygular', (
    tester,
  ) async {
    final store = PlannerStore()
      ..booting = false
      ..appLocale = const Locale('en');

    await tester.pumpWidget(PlannerApp(store: store));

    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Devam etmek için giriş yap.'), findsNothing);
  });
}

