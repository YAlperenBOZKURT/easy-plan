import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/dates.dart';
import 'package:planner/pages/planner_page.dart';
import 'package:planner/store.dart';
import 'package:planner/theme.dart';

PlannerCard _card(String id, String day, String title) => PlannerCard(
  id: id,
  day: day,
  title: title,
  note: '',
  startTime: null,
  endTime: null,
  color: 'blue',
  done: false,
  sortIndex: 100,
  manualSort: false,
  habitId: null,
  reminders: const [],
  images: const [],
  updatedAt: '',
);

class _FakeStore extends PlannerStore {
  _FakeStore() {
    booting = false;
    user = PlannerUser(id: 'u1', email: 'a@b.c', name: 'Test', role: 'user');
  }

  final Map<String, List<PlannerCard>> data = {};
  ({String cardId, String day})? lastMove;

  @override
  List<PlannerCard> cardsOf(String day) => data[day] ?? const [];

  @override
  Future<void> loadRange() async {}

  @override
  Future<void> moveCard(
    PlannerCard card, {
    required String day,
    String? beforeId,
    String? afterId,
  }) async {
    lastMove = (cardId: card.id, day: day);
  }
}

void main() {
  testWidgets('son güne gelince pencere kayar (hafta sınırı yok)', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;

    final store = _FakeStore();
    final baslangic = store.anchor;

    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    // Şeritteki son güne dokun → sayfa 6'ya gider → pencere bir gün ileri kayar
    final sonGun = store.days.last;
    await tester.tap(find.text('${dayNumber(sonGun)}').first);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpAndSettle();

    final sonrakiAnchor = store.anchor;
    debugDefaultTargetPlatformOverride = null;

    expect(
      sonrakiAnchor,
      addDays(baslangic, 1),
      reason: 'son sayfaya gelince 7 günlük pencere ileri kaymalıydı',
    );
  });

  testWidgets('telefonda kart gün şeridindeki güne bırakılınca taşınır', (
    tester,
  ) async {
    // Dokunmatik yol: basılı tutunca sürükleme başlar.
    debugDefaultTargetPlatformOverride = TargetPlatform.android;

    final store = _FakeStore();
    final today = todayKey();
    final target = addDays(today, 3);
    store.data[today] = [_card('c1', today, 'Taşınacak')];

    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    // Şeritte 4. gün (bugün + 3) kutusunun ortası
    final stripDay = tester.getCenter(find.text('${dayNumber(target)}').first);
    final card = tester.getCenter(find.text('Taşınacak'));

    final gesture = await tester.startGesture(card);
    // Uzun basış eşiğini geç
    await tester.pump(const Duration(milliseconds: 400));
    for (var i = 1; i <= 10; i++) {
      await gesture.moveTo(
        Offset(
          card.dx + (stripDay.dx - card.dx) * i / 10,
          card.dy + (stripDay.dy - card.dy) * i / 10,
        ),
      );
      await tester.pump(const Duration(milliseconds: 24));
    }
    await gesture.up();
    await tester.pumpAndSettle();

    final move = store.lastMove;
    debugDefaultTargetPlatformOverride = null;

    expect(move, isNotNull, reason: 'şeride bırakma taşıma üretmedi');
    expect(move!.cardId, 'c1');
    expect(move.day, target, reason: 'kart şeritte seçilen güne gitmeliydi');
  });
}
