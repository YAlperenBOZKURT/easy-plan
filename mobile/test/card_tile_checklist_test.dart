import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/theme.dart';
import 'package:planner/widgets/card_tile.dart';

void main() {
  testWidgets('karttaki checklist maddesi kart menüsünü açmadan tıklanır', (
    tester,
  ) async {
    String? toggledId;
    var cardTaps = 0;
    final card = PlannerCard(
      id: 'card-1',
      day: '2026-08-16',
      title: 'Plan',
      note: '',
      startTime: null,
      endTime: null,
      color: 'blue',
      done: false,
      sortIndex: 0,
      manualSort: false,
      habitId: null,
      checklist: const [
        ChecklistItem(id: 'item-1', text: 'İlk iş', done: false),
      ],
      priority: 'urgent',
      reminders: const [],
      images: const [],
      updatedAt: '',
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.light),
        home: Scaffold(
          body: CardTile(
            card: card,
            imageHeaders: const {},
            imageUrl: (path) => path,
            onTap: () => cardTaps += 1,
            onToggleChecklist: (id) => toggledId = id,
          ),
        ),
      ),
    );

    await tester.tap(find.text('İlk iş'));
    await tester.pump();

    expect(toggledId, 'item-1');
    expect(cardTaps, 0);
    expect(find.text('Acil'), findsOneWidget);
  });
}
