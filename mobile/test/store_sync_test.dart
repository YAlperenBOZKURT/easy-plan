import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:planner/api/api_client.dart';
import 'package:planner/api/models.dart';
import 'package:planner/cache.dart';
import 'package:planner/dates.dart';
import 'package:planner/store.dart';

PlannerCard _card({
  String id = 'card-1',
  String title = 'Local card',
  bool done = false,
}) => PlannerCard(
  id: id,
  day: todayKey(),
  title: title,
  note: '',
  startTime: null,
  endTime: null,
  color: 'blue',
  done: done,
  sortIndex: 100,
  manualSort: false,
  habitId: null,
  reminders: const [],
  images: const [],
  updatedAt: '2026-09-30T08:00:00.000Z',
);

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);

http.Response _delta({List<PlannerCard> cards = const []}) => _json({
  'serverTime': '2026-09-30T10:00:00.000Z',
  'cards': cards.map((card) => card.toJson()).toList(),
  'deletions': [],
});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late PlannerStore store;

  PlannerStore useClient(Future<http.Response> Function(http.Request) send) {
    store = PlannerStore()
      ..api = ApiClient(
        baseUrl: 'https://planner.example',
        client: MockClient(send),
      );
    return store;
  }

  setUpAll(() async => Cache.useInMemory());
  setUp(() async => Cache.instance.clear());
  tearDown(() {
    store.dispose();
    store.api.close();
  });

  for (final status in [
    400,
    401,
    403,
    404,
    408,
    409,
    422,
    429,
    500,
    502,
    503,
    504,
  ]) {
    test('HTTP $status preserves failed write and stops FIFO replay', () async {
      final requests = <String>[];
      useClient((request) async {
        requests.add('${request.method} ${request.url.path}');
        return _json({'error': 'rejected'}, status);
      });
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': 'First',
      });
      await Cache.instance.enqueue('PATCH', '/cards/card-2', {
        'title': 'Second',
      });
      await Cache.instance.setLastSync('2026-09-30T08:00:00.000Z');

      await store.syncNow();

      expect(requests, ['PATCH /api/v1/cards/card-1']);
      expect(await Cache.instance.pendingCount(), 2);
      expect(store.pendingWrites, 2);
      expect(store.offline, isTrue);
      expect(store.error, contains('rejected'));
      expect(await Cache.instance.lastSync, '2026-09-30T08:00:00.000Z');
    });
  }

  test(
    'recovery retries retained writes in order before fetching delta',
    () async {
      var available = false;
      final requests = <String>[];
      useClient((request) async {
        requests.add('${request.method} ${request.url.path}');
        if (!available) return _json({'error': 'unavailable'}, 503);
        return request.method == 'GET' ? _delta() : _json({'ok': true});
      });
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': 'First',
      });
      await Cache.instance.enqueue('PATCH', '/cards/card-2', {
        'title': 'Second',
      });
      await store.syncNow();
      available = true;

      await store.syncNow();

      expect(requests, [
        'PATCH /api/v1/cards/card-1',
        'PATCH /api/v1/cards/card-1',
        'PATCH /api/v1/cards/card-2',
        'GET /api/v1/changes',
      ]);
      expect(await Cache.instance.pendingCount(), 0);
      expect(store.pendingWrites, 0);
      expect(store.offline, isFalse);
      expect(store.error, isNull);
      expect(await Cache.instance.lastSync, '2026-09-30T10:00:00.000Z');
    },
  );

  test('network failure after partial replay updates pending count', () async {
    useClient((request) async {
      if (request.url.path.endsWith('card-2')) {
        throw TimeoutException('connection lost');
      }
      return _json({'ok': true});
    });
    await Cache.instance.enqueue('PATCH', '/cards/card-1', {'done': true});
    await Cache.instance.enqueue('PATCH', '/cards/card-2', {'done': true});

    await store.syncNow();

    expect(store.pendingWrites, 1);
    expect((await Cache.instance.pending()).single.path, '/cards/card-2');
    expect(store.offline, isTrue);
    expect(await Cache.instance.lastSync, isNull);
  });

  test('simultaneous sync calls deliver each queued write only once', () async {
    final response = Completer<http.Response>();
    final started = Completer<void>();
    var writes = 0;
    var deltas = 0;
    useClient((request) async {
      if (request.method == 'PATCH') {
        writes++;
        started.complete();
        return response.future;
      }
      deltas++;
      return _delta();
    });
    await Cache.instance.enqueue('PATCH', '/cards/card-1', {'done': true});
    final first = store.syncNow();
    await started.future;
    final second = store.syncNow();
    response.complete(_json({'ok': true}));

    await Future.wait([first, second]);

    expect(writes, 1);
    expect(deltas, 1);
    expect(store.pendingWrites, 0);
  });

  test(
    'new write is persisted before delivery and survives HTTP 503',
    () async {
      final card = _card();
      useClient((request) async {
        expect(request.method, 'PATCH');
        expect(await Cache.instance.pendingCount(), 1);
        final cached = await Cache.instance.cardsBetween(card.day, card.day);
        expect(cached.single.done, isTrue);
        return _json({'error': 'unavailable'}, 503);
      });

      await store.toggleDone(card);
      await store.loadRange();

      expect(store.cardsOf(card.day).single.done, isTrue);
      expect(store.pendingWrites, 1);
      expect((await Cache.instance.pending()).single.body, {'done': true});
    },
  );

  test('new writes cannot bypass an older failed write', () async {
    final sentTitles = <String>[];
    useClient((request) async {
      sentTitles.add((jsonDecode(request.body) as Map)['title'] as String);
      return _json({'error': 'unavailable'}, 503);
    });
    await Cache.instance.enqueue('PATCH', '/cards/card-1', {'title': 'First'});

    await store.saveCard(
      existing: _card(),
      day: todayKey(),
      title: 'Second',
      note: '',
      color: 'blue',
      priority: 'none',
      deadlineAt: null,
      tags: [],
      reminders: [],
      checklist: [],
    );

    expect(sentTitles, ['First']);
    expect(store.pendingWrites, 2);
    expect((await Cache.instance.pending()).last.body!['title'], 'Second');
    expect(store.cardsOf(todayKey()).single.title, 'Second');
  });

  test('late range response cannot overwrite a new pending edit', () async {
    final response = Completer<http.Response>();
    final started = Completer<void>();
    final card = _card();
    useClient((request) async {
      if (request.method == 'GET') {
        started.complete();
        return response.future;
      }
      return _json({'error': 'unavailable'}, 503);
    });
    final load = store.loadRange();
    await started.future;
    await store.toggleDone(card);
    response.complete(
      _json({
        'cards': [card.toJson()],
      }),
    );

    await load;

    expect(store.cardsOf(card.day).single.done, isTrue);
    expect(
      (await Cache.instance.cardsBetween(card.day, card.day)).single.done,
      isTrue,
    );
    expect(store.pendingWrites, 1);
  });

  test(
    'late delta cannot remove a new pending local edit or advance cursor',
    () async {
      final response = Completer<http.Response>();
      final started = Completer<void>();
      final card = _card();
      useClient((request) async {
        if (request.method == 'GET') {
          started.complete();
          return response.future;
        }
        return _json({'error': 'unavailable'}, 503);
      });
      final sync = store.syncNow();
      await started.future;
      await store.toggleDone(card);
      response.complete(
        _json({
          'serverTime': '2026-09-30T10:00:00.000Z',
          'cards': [card.toJson()],
          'deletions': [
            {'entity': 'card', 'id': card.id},
          ],
        }),
      );

      await sync;

      expect(
        (await Cache.instance.cardsBetween(card.day, card.day)).single.done,
        isTrue,
      );
      expect(await Cache.instance.lastSync, isNull);
      expect(store.pendingWrites, 1);
    },
  );

  test(
    'search keeps pending edits instead of replacing cache with server data',
    () async {
      final card = _card(title: 'Pending edit');
      useClient(
        (request) async => throw StateError('Server must not be called'),
      );
      await Cache.instance.saveCards([card]);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': card.title,
      });

      final result = await store.searchCards('Pending');

      expect(result.offline, isTrue);
      expect(result.cards.single.title, 'Pending edit');
      expect(await Cache.instance.pendingCount(), 1);
    },
  );

  test(
    'lost create response can be replayed before its dependent edit',
    () async {
      final requests = <String>[];
      useClient((request) async {
        requests.add(request.method);
        if (request.method == 'POST') {
          return _json({'error': 'already_exists'}, 409);
        }
        return request.method == 'GET' ? _delta() : _json({'ok': true});
      });
      await Cache.instance.enqueue('POST', '/cards', {'id': 'card-1'});
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {'done': true});

      await store.syncNow();

      expect(requests, ['POST', 'PATCH', 'GET']);
      expect(store.pendingWrites, 0);
    },
  );

  test(
    'lost delete response treats an already removed card as delivered',
    () async {
      useClient(
        (request) async => request.method == 'DELETE'
            ? _json({'error': 'not_found'}, 404)
            : _delta(),
      );
      await Cache.instance.enqueue('DELETE', '/cards/card-1', null);

      await store.syncNow();

      expect(await Cache.instance.pendingCount(), 0);
      expect(store.offline, isFalse);
    },
  );

  test(
    'server cache transaction protects pending cards and sync cursor',
    () async {
      useClient((request) async => _delta());
      final card = _card(title: 'Pending edit');
      await Cache.instance.saveCards([card]);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': card.title,
      });
      await Cache.instance.setLastSync('2026-09-30T08:00:00.000Z');

      final applied = await Cache.instance.applyServerChanges(
        [_card(title: 'Old server title')],
        deletions: [card.id],
        serverTime: '2026-09-30T10:00:00.000Z',
      );

      expect(applied, isFalse);
      expect(
        (await Cache.instance.cardsBetween(card.day, card.day)).single.title,
        'Pending edit',
      );
      expect(await Cache.instance.lastSync, '2026-09-30T08:00:00.000Z');
    },
  );

  test(
    'server cache transaction applies updates, deletions, and cursor together',
    () async {
      useClient((request) async => _delta());
      final card = _card();
      await Cache.instance.saveCards([card]);

      final applied = await Cache.instance.applyServerChanges(
        [_card(id: 'card-2', title: 'Server update')],
        deletions: [card.id],
        serverTime: '2026-09-30T10:00:00.000Z',
      );

      expect(applied, isTrue);
      final cards = await Cache.instance.cardsBetween(card.day, card.day);
      expect(cards.single.id, 'card-2');
      expect(cards.single.title, 'Server update');
      expect(await Cache.instance.lastSync, '2026-09-30T10:00:00.000Z');
    },
  );
}
