import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/localization.dart';
import 'package:planner/pages/sync_queue.dart';
import 'package:planner/store.dart';
import 'package:planner/sync_queue.dart';

class _Store extends PlannerStore {
  int? kept;
  int? discarded;
  @override
  Future<void> keepLocalWrite(int id) async {
    kept = id;
  }

  @override
  Future<void> discardCardWrites(int id) async {
    discarded = id;
  }
}

void main() {
  final original = PlannerCard.fromJson({
    'id': 'card-1',
    'day': '2026-09-30',
    'title': 'Original',
    'updatedAt': '2026-09-30T08:00:00.000Z',
  });
  _Store store() => _Store()
    ..pendingQueue = [
      PendingWrite(
        id: 7,
        method: 'PATCH',
        path: '/cards/card-1',
        body: {'title': 'Local draft', 'updatedAt': original.updatedAt},
        baseCard: original.toJson(),
        failure: {
          'error': 'stale_write',
          'card': original
              .copyWith(
                title: 'Remote title',
                updatedAt: '2026-09-30T09:00:00.000Z',
              )
              .toJson(),
        },
      ),
    ];

  testWidgets(
    'narrow queue view compares versions and sends an explicit keep decision',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final state = store();
      addTearDown(state.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: SyncQueueSheet(store: state)),
        ),
      );
      expect(find.text('Local draft'), findsNWidgets(2));
      expect(find.text('Remote title'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Benim değişikliklerimi kaydet'));
      await tester.pumpAndSettle();
      expect(state.kept, 7);
      expect(state.discarded, isNull);
    },
  );

  testWidgets(
    'server choice explicitly confirms removal of all dependent writes',
    (tester) async {
      final state = store();
      addTearDown(state.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: AppLanguageScope(
            locale: const Locale('en'),
            child: Scaffold(body: SyncQueueSheet(store: state)),
          ),
        ),
      );
      await tester.tap(find.text('Use server version'));
      await tester.pumpAndSettle();
      expect(state.discarded, isNull);
      expect(
        find.text(
          'All pending changes to this card will be removed. Continue?',
        ),
        findsOneWidget,
      );
      await tester.tap(
        find.widgetWithText(
          TextButton,
          'Cancel all pending changes to this card',
        ),
      );
      await tester.pumpAndSettle();
      expect(state.discarded, 7);
    },
  );
}
