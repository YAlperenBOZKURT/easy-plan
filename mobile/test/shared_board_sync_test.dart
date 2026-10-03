import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:planner/api/api_client.dart';
import 'package:planner/api/models.dart';
import 'package:planner/cache.dart';
import 'package:planner/dates.dart';
import 'package:planner/store.dart';

PlannerCard sharedCard(String id) => PlannerCard(
  id: id,
  boardId: 'shared-board',
  day: todayKey(),
  title: 'Created by another member',
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
  updatedAt: '2026-10-03T08:00:00.000Z',
);

http.Response jsonResponse(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late PlannerStore store;

  setUpAll(() async => Cache.useInMemory());
  setUp(() async {
    await Cache.instance.clear();
    store = PlannerStore();
  });
  tearDown(() {
    store.dispose();
    store.api.close();
  });

  test(
    'shared archive/trash removes cached cards and a restore reappears after restart',
    () async {
      final archived = sharedCard('archived-card');
      final trashed = sharedCard('trashed-card');
      final unchanged = sharedCard('unchanged-card');
      await Cache.instance.saveCards([archived, trashed, unchanged]);
      const oldCursor = '2026-10-03T08:00:00.000Z';
      const hiddenCursor = '2026-10-03T09:00:00.000Z';
      await Cache.instance.setLastSync(oldCursor);
      store.api = ApiClient(
        baseUrl: 'https://planner.example',
        activeBoardId: 'shared-board',
        client: MockClient((request) async {
          expect(request.url.path, '/api/v1/changes');
          expect(request.headers['x-board-id'], 'shared-board');
          expect(request.url.queryParameters['since'], oldCursor);
          return jsonResponse({
            'serverTime': hiddenCursor,
            'cards': [],
            'deletions': [
              {'entity': 'card', 'id': archived.id, 'deletedAt': hiddenCursor},
              {'entity': 'card', 'id': trashed.id, 'deletedAt': hiddenCursor},
              // Private habit events must never remove a card with the same ID.
              {
                'entity': 'habit',
                'id': unchanged.id,
                'deletedAt': hiddenCursor,
              },
            ],
          });
        }),
      );

      await store.syncNow();

      expect(
        (await Cache.instance.cardsBetween(
          todayKey(),
          todayKey(),
        )).map((card) => card.id),
        [unchanged.id],
      );
      expect(await Cache.instance.lastSync, hiddenCursor);
      store.dispose();
      store.api.close();
      store = PlannerStore()
        ..api = ApiClient(
          baseUrl: 'https://planner.example',
          activeBoardId: 'shared-board',
          client: MockClient((request) async {
            expect(request.headers['x-board-id'], 'shared-board');
            expect(request.url.queryParameters['since'], hiddenCursor);
            return jsonResponse({
              'serverTime': '2026-10-03T10:00:00.000Z',
              'cards': [
                archived
                    .copyWith(updatedAt: '2026-10-03T09:30:00.000Z')
                    .toJson(),
              ],
              'deletions': [],
            });
          }),
        );

      await store.syncNow();

      final cached = await Cache.instance.cardsBetween(todayKey(), todayKey());
      expect(cached.map((card) => card.id).toSet(), {
        archived.id,
        unchanged.id,
      });
      expect(cached.every((card) => card.boardId == 'shared-board'), isTrue);
      expect(await Cache.instance.lastSync, '2026-10-03T10:00:00.000Z');
    },
  );

  test(
    'revoked board access does not advance the cursor; rejoining receives missed deletions',
    () async {
      final card = sharedCard('deleted-while-away');
      await Cache.instance.saveCards([card]);
      const oldCursor = '2026-10-03T08:00:00.000Z';
      await Cache.instance.setLastSync(oldCursor);
      var member = false;
      store.api = ApiClient(
        baseUrl: 'https://planner.example',
        activeBoardId: 'shared-board',
        client: MockClient((request) async {
          expect(request.url.queryParameters['since'], oldCursor);
          if (!member) return jsonResponse({'error': 'board_forbidden'}, 403);
          return jsonResponse({
            'serverTime': '2026-10-03T10:00:00.000Z',
            'cards': [],
            'deletions': [
              {
                'entity': 'card',
                'id': card.id,
                'deletedAt': '2026-10-03T09:00:00.000Z',
              },
            ],
          });
        }),
      );

      await store.syncNow();
      expect(await Cache.instance.lastSync, oldCursor);
      member = true;
      await store.syncNow();
      expect(
        await Cache.instance.cardsBetween(todayKey(), todayKey()),
        isEmpty,
      );
      expect(await Cache.instance.lastSync, '2026-10-03T10:00:00.000Z');
    },
  );
}
