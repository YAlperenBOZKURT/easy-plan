import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/dates.dart';
import 'package:planner/pages/card_editor.dart';
import 'package:planner/pages/planner_page.dart';
import 'package:planner/store.dart';
import 'package:planner/theme.dart';

PlannerCard _card(String id, String day, String title, {double sort = 100}) =>
    PlannerCard(
      id: id,
      day: day,
      title: title,
      note: '',
      startTime: null,
      endTime: null,
      color: 'blue',
      done: false,
      sortIndex: sort,
      manualSort: false,
      habitId: null,
      reminders: const [],
      images: const [],
      updatedAt: '',
    );

/// Sunucuya çıkmayan sahte depo: taşıma çağrısını kaydeder.
class _FakeStore extends PlannerStore {
  _FakeStore() {
    booting = false;
    user = PlannerUser(id: 'u1', email: 'a@b.c', name: 'Test', role: 'user');
  }

  final Map<String, List<PlannerCard>> data = {};
  ({String cardId, String day, String? beforeId, String? afterId})? lastMove;

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
    lastMove = (
      cardId: card.id,
      day: day,
      beforeId: beforeId,
      afterId: afterId,
    );
  }
}

void main() {
  testWidgets('kart fareyle başka güne sürüklenince taşıma isteği çıkar', (
    tester,
  ) async {
    // Masaüstü yolunu sına: fareyle doğrudan sürükleme.
    // Bayrak test bitmeden sıfırlanmalı, yoksa çerçeve şikayet ediyor.
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    final store = _FakeStore();
    final today = todayKey();
    final tomorrow = addDays(today, 1);
    store.data[today] = [_card('c1', today, 'Taşınacak')];
    store.data[tomorrow] = [];

    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.light),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Taşınacak'), findsOneWidget);

    // Kartı yakala, yarınki kolonun bırakma bölgesine taşı.
    final card = tester.getCenter(find.text('Taşınacak'));
    // Hedef: yarınki kolonun başlığının biraz altı — orada bırakma bölgesi var.
    final header = tester.getCenter(find.text(dayName(tomorrow)));
    final targetColumn = Offset(header.dx, header.dy + 60);

    final gesture = await tester.startGesture(card);
    await tester.pump(const Duration(milliseconds: 100));
    // Adım adım hareket: DragTarget'ın imleci görmesi için
    for (var i = 1; i <= 8; i++) {
      await gesture.moveTo(
        Offset(
          card.dx + (targetColumn.dx - card.dx) * i / 8,
          card.dy + (targetColumn.dy - card.dy) * i / 8,
        ),
      );
      await tester.pump(const Duration(milliseconds: 20));
    }
    await gesture.up();
    await tester.pumpAndSettle();

    final move = store.lastMove;
    debugDefaultTargetPlatformOverride = null;

    expect(move, isNotNull, reason: 'taşıma isteği hiç oluşmadı');
    expect(move!.cardId, 'c1');
    expect(move.day, tomorrow, reason: 'kart yarına taşınmalıydı');
  });

  testWidgets(
    'geniş ekranda düzenleyici tam sayfa değil, pencere olarak açılır',
    (tester) async {
      final store = _FakeStore();
      final today = todayKey();
      store.data[today] = [];

      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(Brightness.light),
          home: PlannerPage(store: store),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('+ Ekle').first);
      await tester.pumpAndSettle();

      expect(find.byType(Dialog), findsOneWidget);
      expect(find.text('Yeni kart'), findsOneWidget);

      // İçerik ekranın tamamını kaplamamalı: ortada duran bir pencere olmalı
      final editor = tester.getSize(find.byType(CardEditor));
      expect(editor.width, lessThan(600));
      expect(editor.height, lessThan(1000));
    },
  );
}
