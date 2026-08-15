import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/dates.dart';
import 'package:planner/pages/planner_page.dart';
import 'package:planner/store.dart';
import 'package:planner/theme.dart';

PlannerCard _card(String id, String day) => PlannerCard(
  id: id,
  day: day,
  title: 'Taşınacak',
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
    user = PlannerUser(id: 'u1', email: 'a@b.c', name: 'T', role: 'user');
  }
  final Map<String, List<PlannerCard>> data = {};
  @override
  List<PlannerCard> cardsOf(String day) => data[day] ?? const [];
  @override
  Future<void> loadRange() async {}
  @override
  Future<void> syncNow() async {}
}

void main() {
  testWidgets('masaüstünde kartı kenara götürünce gün penceresi kayar', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    final store = _FakeStore();
    final today = todayKey();
    store.data[today] = [_card('c1', today)];
    final basla = store.anchor;

    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    // Kartı tut, ekranın SAĞ kenarına götür ve orada beklet
    final card = tester.getCenter(find.text('Taşınacak'));
    final gesture = await tester.startGesture(
      card,
      kind: PointerDeviceKind.mouse,
    );
    await tester.pump(const Duration(milliseconds: 60));
    await gesture.moveTo(Offset(1190, card.dy));
    await tester.pump();

    // Flutter web/masaüstü eski hızında kalır: her 650 ms'de yalnızca bir gün.
    await tester.pump(const Duration(milliseconds: 649));
    expect(store.anchor, basla, reason: 'kısa kenar teması günü değiştirmemeli');
    await tester.pump(const Duration(milliseconds: 1));
    expect(store.anchor, addDays(basla, 1));
    await tester.pump(const Duration(milliseconds: 649));
    expect(store.anchor, addDays(basla, 1));
    await tester.pump(const Duration(milliseconds: 1));
    final kenardaki = store.anchor;
    await gesture.up();
    await tester.pumpAndSettle();

    debugDefaultTargetPlatformOverride = null;
    expect(
      kenardaki,
      addDays(basla, 2),
      reason: 'ikinci gün yalnızca ikinci 650 ms süresinden sonra gelmeli',
    );
  });
}
