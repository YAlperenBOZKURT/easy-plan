import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/planner_views.dart';
import 'package:planner/store.dart';
import 'package:planner/theme.dart';
import 'package:planner/widgets/planner_collection_view.dart';

PlannerCard _card({
  String id = 'card-1',
  String title = 'Planı tamamla',
  bool done = false,
}) => PlannerCard(
  id: id,
  day: '2026-08-21',
  title: title,
  note: '',
  startTime: '10:00',
  endTime: null,
  color: 'blue',
  done: done,
  sortIndex: 1,
  manualSort: false,
  habitId: null,
  reminders: const [],
  images: const [],
  updatedAt: '2026-08-21T08:00:00Z',
);

Widget _app(Widget child) => MaterialApp(
  theme: buildTheme(Brightness.light),
  home: Scaffold(body: child),
);

void main() {
  testWidgets('ay görünümünden kart açılır ve güne kart eklenir', (tester) async {
    PlannerCard? opened;
    String? addDay;
    final card = _card();

    await tester.pumpWidget(
      _app(
        PlannerCollectionView(
          view: PlannerViewMode.month,
          anchor: '2026-08-21',
          days: const ['2026-08-21'],
          cards: [card],
          store: PlannerStore(),
          onAdd: (day) => addDay = day,
          onCard: (value) => opened = value,
        ),
      ),
    );

    await tester.tap(find.text('Planı tamamla'));
    await tester.tap(find.byTooltip('21 Ağu için kart ekle'));
    expect(opened?.id, 'card-1');
    expect(addDay, '2026-08-21');
  });

  testWidgets('tamamlananlar yalnızca biten kartları gösterir', (tester) async {
    await tester.pumpWidget(
      _app(
        PlannerCollectionView(
          view: PlannerViewMode.completed,
          anchor: '2026-08-21',
          days: const [],
          cards: [_card(), _card(id: 'done', title: 'Bitti', done: true)],
          store: PlannerStore(),
          onAdd: (_) {},
          onCard: (_) {},
        ),
      ),
    );

    expect(find.text('Bitti'), findsOneWidget);
    expect(find.text('Planı tamamla'), findsNothing);
  });

  testWidgets('mobil ay görünümü üç büyük sütunla dikey kayar', (tester) async {
    tester.view.physicalSize = const Size(526, 700);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.25;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(
      tester.platformDispatcher.clearTextScaleFactorTestValue,
    );

    await tester.pumpWidget(
      _app(
        PlannerCollectionView(
          view: PlannerViewMode.month,
          anchor: '2026-08-21',
          days: daysBetween('2026-07-27', '2026-09-06'),
          cards: [_card()],
          store: PlannerStore(),
          onAdd: (_) {},
          onCard: (_) {},
        ),
      ),
    );

    expect(find.byType(SingleChildScrollView), findsNothing);
    expect(find.text('Pzt'), findsWidgets);
    expect(find.text('Paz'), findsWidgets);
    final grid = tester.widget<GridView>(find.byType(GridView));
    expect(grid.scrollDirection, Axis.vertical);
    expect(
      (grid.gridDelegate as SliverGridDelegateWithFixedCrossAxisCount)
          .crossAxisCount,
      3,
    );
    await tester.scrollUntilVisible(
      find.text('Planı tamamla'),
      250,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Planı tamamla'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('dar mobil ay görünümü kartları ezmeden iki sütuna düşer', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 700);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 1.25;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(
      tester.platformDispatcher.clearTextScaleFactorTestValue,
    );

    await tester.pumpWidget(
      _app(
        PlannerCollectionView(
          view: PlannerViewMode.month,
          anchor: '2026-08-21',
          days: daysBetween('2026-07-27', '2026-09-06'),
          cards: [_card()],
          store: PlannerStore(),
          onAdd: (_) {},
          onCard: (_) {},
        ),
      ),
    );

    final grid = tester.widget<GridView>(find.byType(GridView));
    expect(
      (grid.gridDelegate as SliverGridDelegateWithFixedCrossAxisCount)
          .crossAxisCount,
      2,
    );
    expect(tester.takeException(), isNull);
  });
}
