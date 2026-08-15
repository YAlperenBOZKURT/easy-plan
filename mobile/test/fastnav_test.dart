import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/dates.dart';
import 'package:planner/pages/card_view.dart';
import 'package:planner/pages/planner_page.dart';
import 'package:planner/store.dart';
import 'package:planner/theme.dart';

PlannerCard _card(String id, String day, String title) => PlannerCard(
  id: id,
  day: day,
  title: title,
  note: 'ayrıntılı not',
  startTime: '09:00',
  endTime: '10:00',
  color: 'blue',
  done: false,
  sortIndex: 540,
  manualSort: false,
  habitId: null,
  reminders: const [60],
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
}

void main() {
  testWidgets('masaüstünde hızlı gezme açıkken sürükleme günü değiştirir', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    final store = _FakeStore();
    final basla = store.anchor;

    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: PlannerPage(store: store),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Hızlı gezme'));
    await tester.pumpAndSettle();

    // Panoyu sağa sürükle → ileri gitmeli
    await tester.drag(find.byType(PlannerPage), const Offset(200, 0));
    await tester.pumpAndSettle();

    final sonra = store.anchor;
    debugDefaultTargetPlatformOverride = null;

    expect(
      sonra.compareTo(basla) > 0,
      isTrue,
      reason: 'sağa sürüklemek ileri günlere gitmeliydi ($basla → $sonra)',
    );
  });

  testWidgets('İncele penceresi kartın tamamını gösterir', (tester) async {
    final store = _FakeStore();
    final today = todayKey();
    final card = _card('c1', today, 'İncelenecek kart');

    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.dark),
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () =>
                    showCardView(context, store: store, card: card),
                child: const Text('aç'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('aç'));
    await tester.pumpAndSettle();

    expect(find.text('İncele'), findsOneWidget);
    expect(find.text('İncelenecek kart'), findsOneWidget);
    expect(find.text('ayrıntılı not'), findsOneWidget);
    expect(find.text('09:00 - 10:00'), findsOneWidget);
    expect(find.text('1 saat'), findsOneWidget); // hatırlatma özeti
    expect(find.text('Düzenle'), findsOneWidget);
  });
}
