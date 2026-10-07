import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:planner/api/api_client.dart';
import 'package:planner/api/models.dart';
import 'package:planner/cache.dart';
import 'package:planner/notifications.dart';
import 'package:planner/reminder_schedule.dart';
import 'package:planner/store.dart';
import 'support/fake_notifications.dart';

const settings = ReminderSettings(
  userId: 'user-1',
  boardId: 'board-1',
  timezone: 'Europe/Istanbul',
  defaultCardTime: '09:00',
);
PlannerCard card({
  String id = 'card-1',
  String day = '2026-11-20',
  String board = 'board-1',
}) => PlannerCard.fromJson({
  'id': id,
  'boardId': board,
  'creatorId': 'user-1',
  'day': day,
  'title': 'Reminder',
  'reminders': [60],
  'startTime': '12:00',
  'updatedAt': '2026-10-07T08:00:00.000Z',
});
http.Response jsonResponse(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);
http.Response delta(
  List<PlannerCard> cards, {
  ReminderSettings context = settings,
  List<String> deleted = const [],
}) => jsonResponse({
  'serverTime': '2026-10-07T10:00:00.000Z',
  'cards': cards.map((c) => c.toJson()).toList(),
  'deletions': deleted.map((id) => {'entity': 'card', 'id': id}).toList(),
  'reminderSettings': context.toJson(),
});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late PlannerStore store;
  late FakeNotificationDriver driver;
  const storageChannel = MethodChannel(
    'plugins.it_nomads.com/flutter_secure_storage',
  );
  setUpAll(() async => Cache.useInMemory());
  setUp(() async {
    await Cache.instance.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, (_) async => null);
    driver = FakeNotificationDriver();
    store = PlannerStore(
      notifications: Notifications(
        driver: driver,
        now: () => DateTime.utc(2026, 10, 7),
      ),
    )..user = PlannerUser(id: 'user-1', email: '', name: '', role: 'user');
  });
  tearDown(() {
    store.dispose();
    store.api.close();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, null);
  });
  void client(Future<http.Response> Function(http.Request) send) {
    store.api = ApiClient(
      baseUrl: 'https://planner.example',
      activeBoardId: 'board-1',
      client: MockClient(send),
    );
  }

  test(
    'delta schedules unseen dates; visiting an empty week leaves them intact',
    () async {
      client(
        (request) async => request.url.path.endsWith('/changes')
            ? delta([card()])
            : jsonResponse({'cards': []}),
      );
      await store.syncNow();
      expect(driver.alarms, hasLength(1));
      await store.loadRange();
      await store.setPlannerRange(anchorDay: '2026-10-21');
      expect(driver.scheduled, hasLength(1));
      expect(driver.cancelled, isEmpty);
    },
  );
  test(
    'offline completion and deletion immediately cancel local alarms',
    () async {
      client((request) async => jsonResponse({'error': 'unavailable'}, 503));
      final original = card();
      await Cache.instance.applyServerChanges([
        original,
      ], reminderSettings: settings);
      await store.refreshNotifications();
      await store.toggleDone(original);
      expect(driver.alarms, isEmpty);
      expect(store.pendingWrites, 1);
      final other = card(id: 'other');
      await Cache.instance.saveCards([other]);
      await store.refreshNotifications();
      expect(driver.alarms, hasLength(1));
      await store.deleteCard(other);
      expect(driver.alarms, isEmpty);
      expect(store.pendingWrites, 2);
    },
  );
  test(
    'delta deletion removes alarms even when the card is outside the viewport',
    () async {
      var removed = false;
      client(
        (request) async =>
            delta(removed ? [] : [card()], deleted: removed ? ['card-1'] : []),
      );
      await store.syncNow();
      removed = true;
      await store.syncNow();
      expect(driver.alarms, isEmpty);
    },
  );
  test('restart schedules the durable snapshot with no range fetch', () async {
    client((request) async => throw StateError('Network must not be needed'));
    await Cache.instance.applyServerChanges([
      card(),
    ], reminderSettings: settings);
    await store.refreshNotifications();
    store.dispose();
    store.api.close();
    store = PlannerStore(
      notifications: Notifications(
        driver: driver,
        now: () => DateTime.utc(2026, 10, 7),
      ),
    )..user = PlannerUser(id: 'user-1', email: '', name: '', role: 'user');
    client((request) async => throw StateError('Network must not be needed'));
    await store.refreshNotifications();
    expect(driver.scheduled, hasLength(1));
  });
  test(
    'offline startup can restore alarms from the authenticated cached scope',
    () async {
      client((request) async => throw StateError('No network'));
      store.user = null;
      store.api.refreshToken = 'saved-refresh-token';
      await Cache.instance.applyServerChanges([
        card(),
      ], reminderSettings: settings);
      await store.refreshNotifications(restoreCachedSession: true);
      expect(driver.alarms, hasLength(1));
      store.api.activeBoardId = 'different-board';
      await store.refreshNotifications(restoreCachedSession: true);
      expect(driver.alarms, isEmpty);
    },
  );

  test('logout clears alarms before a slow network logout finishes', () async {
    final response = Completer<http.Response>();
    final started = Completer<void>();
    client((request) async {
      started.complete();
      return response.future;
    });
    await Cache.instance.applyServerChanges([
      card(),
    ], reminderSettings: settings);
    await store.refreshNotifications();
    final logout = store.logout();
    await started.future;
    expect(driver.alarms, isEmpty);
    await store.refreshNotifications();
    expect(driver.alarms, isEmpty);
    response.complete(jsonResponse({'ok': true}));
    await logout;
    expect((await Cache.instance.reminderSnapshot()).settings, isNull);
  });
  test(
    'membership revocation clears alarms and cached data cannot recreate them',
    () async {
      client(
        (request) async => jsonResponse({'error': 'board_forbidden'}, 403),
      );
      await Cache.instance.applyServerChanges([
        card(),
      ], reminderSettings: settings);
      await store.refreshNotifications();
      await store.syncNow();
      await store.loadRange();
      await store.refreshNotifications();
      expect(driver.alarms, isEmpty);
    },
  );
  test('another account never inherits cached alarms', () async {
    client((request) async => jsonResponse({'cards': []}));
    await Cache.instance.applyServerChanges([
      card(),
    ], reminderSettings: settings);
    await store.refreshNotifications();
    store.user = PlannerUser(id: 'user-2', email: '', name: '', role: 'user');
    await store.refreshNotifications();
    expect(driver.alarms, isEmpty);
  });
  test(
    'board switch clears the previous scope and plans the new complete snapshot',
    () async {
      const next = ReminderSettings(
        userId: 'user-1',
        boardId: 'board-2',
        timezone: 'UTC',
        defaultCardTime: '09:00',
      );
      client(
        (request) async => request.url.path.endsWith('/changes')
            ? delta([card(id: 'next-card', board: 'board-2')], context: next)
            : jsonResponse({'cards': []}),
      );
      await Cache.instance.applyServerChanges([
        card(),
      ], reminderSettings: settings);
      await store.refreshNotifications();
      final board = PlannerBoard.fromJson({
        'id': 'board-2',
        'name': 'Other',
        'role': 'owner',
        'personal': false,
        'memberCount': 1,
      });
      expect(await store.switchBoard(board), isTrue);
      expect(driver.alarms, hasLength(1));
      expect(driver.alarms.values.single.payload, contains('next-card'));
      expect(
        (await Cache.instance.reminderSnapshot()).cards.every(
          (c) => c.boardId == 'board-2',
        ),
        isTrue,
      );
    },
  );
  test(
    'late range response after logout cannot recreate an alarm or repopulate cache',
    () async {
      final response = Completer<http.Response>();
      final started = Completer<void>();
      client((request) async {
        if (request.method == 'POST') return jsonResponse({'ok': true});
        started.complete();
        return response.future;
      });
      await Cache.instance.applyServerChanges([
        card(),
      ], reminderSettings: settings);
      await store.refreshNotifications();
      final loading = store.loadRange();
      await started.future;
      await store.logout();
      response.complete(
        jsonResponse({
          'cards': [card().toJson()],
        }),
      );
      await loading;
      expect(driver.alarms, isEmpty);
      expect((await Cache.instance.reminderSnapshot()).cards, isEmpty);
    },
  );
}
