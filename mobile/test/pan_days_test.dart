import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/pages/planner_page.dart';
import 'package:planner/store.dart';
import 'package:planner/theme.dart';

class _FakeStore extends PlannerStore {
  _FakeStore() {
    booting = false;
    user = PlannerUser(id: 'u1', email: 'a@b.c', name: 'T', role: 'user');
  }
  @override
  List<PlannerCard> cardsOf(String day) => const [];
  @override
  Future<void> loadRange() async {}
  @override
  Future<void> syncNow() async {}
}

void main() {
  testWidgets('hızlı gezme kapalıyken de fareyle sürükleyince gün değişir', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    final store = _FakeStore();
    final basla = store.anchor;

    tester.view.physicalSize = const Size(1600, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    // Kolonların boş alanında fareyle sağa sürükle
    final board = tester.getCenter(find.byType(PlannerPage));
    final gesture = await tester.startGesture(
      Offset(board.dx, board.dy + 200),
      kind: PointerDeviceKind.mouse,
    );
    for (var i = 0; i < 12; i++) {
      await gesture.moveBy(const Offset(30, 0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await gesture.up();
    await tester.pumpAndSettle();

    final sonra = store.anchor;
    debugDefaultTargetPlatformOverride = null;
    expect(
      sonra.compareTo(basla) > 0,
      isTrue,
      reason: 'sağa sürükleme ileri gitmeliydi ($basla → $sonra)',
    );
  });

  testWidgets('dar ekranda gün sayısı azalır', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    final store = _FakeStore();

    tester.view.physicalSize = const Size(900, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    final darGun = store.visibleDays;

    tester.view.physicalSize = const Size(1800, 800);
    await tester.pumpAndSettle();
    final genisGun = store.visibleDays;

    debugDefaultTargetPlatformOverride = null;
    expect(darGun, lessThan(7), reason: '900px ekranda 7 gün sığmamalı');
    expect(
      genisGun,
      greaterThan(darGun),
      reason: 'ekran genişleyince gün sayısı artmalı',
    );
  });

  testWidgets('844px pencerede web ile aynı gün sayısı çıkar', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    final store = _FakeStore();

    tester.view.physicalSize = const Size(844, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    final gun = store.visibleDays;
    debugDefaultTargetPlatformOverride = null;
    // (844 + 12) / (190 + 12) = 4.23 → 4 gün, web ile birebir
    expect(gun, 4, reason: '844px ekranda 4 gün görünmeli, 7 değil');
  });
}
