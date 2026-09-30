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
      expect(store.error, isNotEmpty);
      expect(
        (await Cache.instance.pending()).first.failure!['error'],
        'rejected',
      );
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
      expect((await Cache.instance.pending()).single.body, {
        'done': true,
        'updatedAt': card.updatedAt,
      });
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
        if (request.method == 'GET' &&
            request.url.path.endsWith('/cards/card-1')) {
          return _json({'card': _card().toJson()});
        }
        return request.method == 'GET' ? _delta() : _json({'ok': true});
      });
      await Cache.instance.enqueue('POST', '/cards', {'id': 'card-1'});
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {'done': true});

      await store.syncNow();

      expect(requests, ['POST', 'GET', 'PATCH', 'GET']);
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
    'conflict survives a store restart and only explicit resolution retries',
    () async {
      final original = _card();
      var remote = original.copyWith(
        title: 'Remote',
        updatedAt: '2026-09-30T09:00:00.000Z',
      );
      var writes = 0;
      final versions = <String>[];
      useClient((request) async {
        if (request.method == 'PATCH') {
          writes++;
          versions.add(
            (jsonDecode(request.body) as Map)['updatedAt'] as String,
          );
          return _json({'error': 'stale_write', 'card': remote.toJson()}, 409);
        }
        return _delta();
      });
      await Cache.instance.saveCards([original]);
      await store.toggleDone(original);
      expect(store.pendingQueue.single.conflict, isTrue);
      expect(store.pendingQueue.single.draft!.done, isTrue);
      expect(store.pendingQueue.single.serverCard!.title, 'Remote');
      store.dispose();
      store.api.close();
      useClient((request) async {
        if (request.method == 'PATCH') {
          writes++;
          versions.add(
            (jsonDecode(request.body) as Map)['updatedAt'] as String,
          );
          return _json({'error': 'stale_write', 'card': remote.toJson()}, 409);
        }
        return _delta();
      });
      await store.syncNow();
      expect(writes, 1);
      expect(store.pendingQueue.single.original!.updatedAt, original.updatedAt);
      final id = store.pendingQueue.single.id;
      remote = remote.copyWith(
        title: 'Remote again',
        updatedAt: '2026-09-30T09:30:00.000Z',
      );
      await store.keepLocalWrite(id);
      expect(versions, [original.updatedAt, '2026-09-30T09:00:00.000Z']);
      expect(store.pendingQueue.single.serverCard!.title, 'Remote again');
      expect(
        (await Cache.instance.cardsBetween(
          original.day,
          original.day,
        )).single.done,
        isTrue,
      );
      expect(await Cache.instance.pendingCount(), 1);
    },
  );

  test(
    'sequential offline edits rebase only their dependent card versions',
    () async {
      final original = _card();
      final unrelated = _card(id: 'card-2');
      final received = <String>[];
      var current = original;
      useClient((request) async {
        if (request.method == 'PATCH') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          received.add(body['updatedAt'] as String);
          current = current.copyWith(
            title: body['title'] as String?,
            done: body['done'] as bool?,
            updatedAt: received.length == 1
                ? '2026-09-30T09:00:00.000Z'
                : '2026-09-30T09:01:00.000Z',
          );
          return _json({'card': current.toJson()});
        }
        return _delta(cards: [current]);
      });
      await Cache.instance.saveCards([
        original.copyWith(title: 'Second', done: true),
      ]);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': 'First',
        'updatedAt': original.updatedAt,
      }, baseCard: original);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': 'Second',
        'updatedAt': original.updatedAt,
      }, baseCard: original);
      // Unrelated versions are never changed by another card's acknowledgement.
      await Cache.instance.enqueue('PATCH', '/cards/card-2', {
        'done': true,
        'updatedAt': unrelated.updatedAt,
      }, baseCard: unrelated);
      await store.syncNow();
      expect(received, [
        original.updatedAt,
        '2026-09-30T09:00:00.000Z',
        unrelated.updatedAt,
      ]);
      expect(await Cache.instance.pendingCount(), 0);
    },
  );

  test('resolution and automatic sync share one replay lock', () async {
    final original = _card();
    var remote = original.copyWith(
      title: 'Remote title',
      updatedAt: '2026-09-30T09:00:00.000Z',
    );
    final started = Completer<void>();
    final response = Completer<http.Response>();
    var writes = 0;
    useClient((request) async {
      if (request.method == 'PATCH') {
        writes++;
        if (writes == 1) {
          return _json({'error': 'stale_write', 'card': remote.toJson()}, 409);
        }
        expect(
          (jsonDecode(request.body) as Map)['updatedAt'],
          remote.updatedAt,
        );
        started.complete();
        return response.future;
      }
      return request.url.path.endsWith('/sync/changes')
          ? _delta(cards: [remote])
          : _json({
              'cards': [remote.toJson()],
            });
    });
    await Cache.instance.saveCards([original]);
    await store.toggleDone(original);
    final id = store.pendingQueue.single.id;
    final decision = store.keepLocalWrite(id);
    await started.future;
    final sync = store.syncNow();
    final repeatedDecision = store.keepLocalWrite(id);
    remote = remote.copyWith(done: true, updatedAt: '2026-09-30T09:01:00.000Z');
    response.complete(_json({'card': remote.toJson()}));
    await Future.wait([decision, sync, repeatedDecision]);
    expect(writes, 2);
    expect(store.pendingWrites, 0);
    expect(store.cardsOf(original.day).single.title, 'Remote title');
    expect(store.cardsOf(original.day).single.done, isTrue);
  });

  test(
    'offline create acknowledgement supplies the first edit version',
    () async {
      final original = _card().copyWith(updatedAt: '');
      String? editVersion;
      useClient((request) async {
        if (request.method == 'POST') {
          return _json({
            'card': original
                .copyWith(updatedAt: '2026-09-30T09:00:00.000Z')
                .toJson(),
          });
        }
        if (request.method == 'PATCH') {
          editVersion =
              (jsonDecode(request.body) as Map)['updatedAt'] as String;
          return _json({
            'card': original
                .copyWith(done: true, updatedAt: '2026-09-30T09:01:00.000Z')
                .toJson(),
          });
        }
        return _delta();
      });
      await Cache.instance.saveCards([original.copyWith(done: true)]);
      await Cache.instance.enqueue('POST', '/cards', {
        'id': original.id,
        'day': original.day,
        'title': original.title,
      });
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'done': true,
        'updatedAt': '',
      }, baseCard: original);
      await store.syncNow();
      expect(editVersion, '2026-09-30T09:00:00.000Z');
      expect(await Cache.instance.pendingCount(), 0);
    },
  );

  test(
    'discard removes all card dependents, preserves unrelated writes and restores remote',
    () async {
      final original = _card();
      final remote = original.copyWith(
        title: 'Remote',
        updatedAt: '2026-09-30T09:00:00.000Z',
      );
      useClient((request) async => _json({'error': 'unavailable'}, 503));
      await Cache.instance.saveCards([original.copyWith(title: 'Draft')]);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': 'Draft',
        'updatedAt': original.updatedAt,
      }, baseCard: original);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'done': true,
        'updatedAt': original.updatedAt,
      }, baseCard: original);
      await Cache.instance.enqueue('PATCH', '/cards/card-2', {'done': true});
      final first = (await Cache.instance.pending()).first;
      await Cache.instance.recordFailure(first.id, {
        'error': 'stale_write',
        'card': remote.toJson(),
      });
      await store.discardCardWrites(first.id);
      expect((await Cache.instance.pending()).single.cardId, 'card-2');
      expect(
        (await Cache.instance.cardsBetween(
          original.day,
          original.day,
        )).single.title,
        'Remote',
      );
      expect(await Cache.instance.lastSync, isNull);
    },
  );

  test(
    'discard after a partial replay restores the acknowledged baseline',
    () async {
      final original = _card();
      final saved = original.copyWith(
        title: 'Acknowledged',
        updatedAt: '2026-09-30T09:00:00.000Z',
      );
      useClient((request) async => _json({'error': 'unavailable'}, 503));
      await Cache.instance.saveCards([original.copyWith(title: 'Pending')]);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': saved.title,
        'updatedAt': original.updatedAt,
      }, baseCard: original);
      await Cache.instance.enqueue('PATCH', '/cards/card-1', {
        'title': 'Pending',
        'updatedAt': original.updatedAt,
      }, baseCard: original);
      await Cache.instance.completeWrite(
        (await Cache.instance.pending()).first,
        saved,
      );
      final remaining = (await Cache.instance.pending()).single;
      await store.discardCardWrites(remaining.id);
      expect(
        (await Cache.instance.cardsBetween(
          original.day,
          original.day,
        )).single.title,
        saved.title,
      );
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
