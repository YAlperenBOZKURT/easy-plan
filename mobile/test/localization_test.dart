import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/dates.dart';
import 'package:planner/accessibility.dart';
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

  test('erişilebilirlik tercihleri güvenli ayrıştırılır ve çözülür', () {
    expect(motionPreferenceFromStorage('invalid'), MotionPreference.system);
    expect(motionPreferenceFromStorage('reduce'), MotionPreference.reduce);
    expect(textDensityFromStorage('comfortable'), TextDensity.comfortable);
    expect(TextDensity.compact.scaleFactor, .9);
    expect(
      MotionPreference.system.resolve(systemReducedMotion: true),
      isTrue,
    );
    expect(MotionPreference.full.resolve(systemReducedMotion: true), isFalse);
  });

  testWidgets('uygulama hareket ve metin yoğunluğu tercihini MediaQuery ile uygular', (
    tester,
  ) async {
    final store = PlannerStore()
      ..booting = false
      ..motionPreference = MotionPreference.reduce
      ..textDensity = TextDensity.comfortable;

    await tester.pumpWidget(PlannerApp(store: store));

    final context = tester.element(find.text('Giriş yap'));
    final media = MediaQuery.of(context);
    expect(media.disableAnimations, isTrue);
    expect(media.textScaler.scale(1), closeTo(1.15, .001));
  });
}

