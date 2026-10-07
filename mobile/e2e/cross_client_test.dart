import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:planner/api/api_client.dart';
import 'package:planner/api/models.dart';
import 'package:planner/cache.dart';
import 'package:planner/dates.dart';
import 'package:planner/notifications.dart';
import 'package:planner/store.dart';
import '../test/support/fake_notifications.dart';

class SwitchableClient extends http.BaseClient {
  final inner = http.Client();
  bool offline = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (offline) throw const SocketException('E2E simulated disconnect');
    return inner.send(request);
  }

  @override
  void close() => inner.close();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // This explicitly-invoked integration suite uses the runner's loopback API.
  // Widget suites retain Flutter's default network-blocking override.
  HttpOverrides.global = null;
  final env = Platform.environment;
  test(
    'web/native offline recovery, conflicts, images and shared lifecycle',
    () async {
      for (final key in [
        'E2E_URL',
        'E2E_CONTROL',
        'E2E_EMAIL',
        'E2E_PASSWORD',
        'E2E_BOARD',
        'E2E_CARD',
        'E2E_DAY',
      ]) {
        expect(
          env[key],
          isNotEmpty,
          reason: 'Run npm run test:e2e from the repo root.',
        );
      }
      await Cache.useInMemory();
      const channel = MethodChannel(
        'plugins.it_nomads.com/flutter_secure_storage',
      );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => null);
      final transport = SwitchableClient();
      final driver = FakeNotificationDriver();
      final store = PlannerStore(notifications: Notifications(driver: driver))
        ..api = ApiClient(
          baseUrl: env['E2E_URL']!,
          client: transport,
          activeBoardId: env['E2E_BOARD'],
        );
      final controlClient = http.Client();
      addTearDown(() async {
        store.dispose();
        store.api.close();
        controlClient.close();
        await Cache.instance.clear();
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
      });
      Future<Map<String, dynamic>> web(
        String action, [
        Map<String, dynamic> args = const {},
      ]) async {
        final response = await controlClient.post(
          Uri.parse(env['E2E_CONTROL']!),
          headers: {'content-type': 'application/json'},
          body: jsonEncode({'action': action, ...args}),
        );
        expect(response.statusCode, 200, reason: 'Web action: $action');
        return jsonDecode(response.body) as Map<String, dynamic>;
      }

      final session = await store.api.login(
        env['E2E_EMAIL']!,
        env['E2E_PASSWORD']!,
      );
      store.user = session.user;
      store.api.accessToken = session.accessToken;
      store.api.refreshToken = session.refreshToken;
      await store.loadBoards(preferredId: env['E2E_BOARD']);
      await store.syncNow();
      await store.setPlannerRange(anchorDay: env['E2E_DAY']!);
      final initial = store.cardsOf(env['E2E_DAY']!).single;
      expect(initial.id, env['E2E_CARD']);
      expect(initial.title, 'Web initial');
      expect(initial.creatorId, isNot(session.user.id));
      expect(
        driver.alarms,
        isEmpty,
        reason: 'Editor must not inherit creator reminders.',
      );
      expect(
        (await store.api.changes()).reminderSettings!.timezone,
        'America/New_York',
      );

      // Queue an actual Store edit while HTTP is disconnected; the web user edits
      // the same server version before reconnecting the native client.
      transport.offline = true;
      await store.saveCard(
        existing: initial,
        day: initial.day,
        title: 'Native draft',
        note: initial.note,
        startTime: initial.startTime,
        color: initial.color,
        priority: initial.priority,
        deadlineAt: null,
        tags: [],
        reminders: [60],
        checklist: [],
      );
      expect(store.pendingWrites, 1);
      await web('edit', {'title': 'Web concurrent'});
      transport.offline = false;
      await store.syncNow();
      final conflict = (await Cache.instance.pending()).single;
      expect(conflict.conflict, isTrue);
      expect(conflict.serverCard!.title, 'Web concurrent');
      expect(store.cardsOf(initial.day).single.title, 'Native draft');
      await store.keepLocalWrite(conflict.id);
      expect(store.pendingWrites, 0);
      await web('assert-card', {'id': initial.id, 'title': 'Native draft'});

      // Offline completion is delivered once to the web client after reconnect.
      transport.offline = true;
      await store.toggleDone(store.cardsOf(initial.day).single);
      expect(store.pendingWrites, 1);
      transport.offline = false;
      await store.refreshFromServer();
      expect(store.pendingWrites, 0);
      await web('assert-card', {
        'id': initial.id,
        'title': 'Native draft',
        'done': true,
      });

      final png = base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      );
      final images = await store.api.uploadImages(initial.id, [
        (name: 'e2e.png', bytes: png),
      ]);
      expect(images, hasLength(1));
      await web('assert-image', {'id': initial.id, 'count': 1});
      await store.api.deleteImage(images.single.id);
      await web('assert-image', {'id': initial.id, 'count': 0});

      // Web lifecycle changes remove and restore the native cached card via delta.
      await web('archive');
      await store.syncNow();
      expect((await Cache.instance.reminderSnapshot()).cards, isEmpty);
      await web('restore');
      await store.syncNow();
      expect(
        (await Cache.instance.reminderSnapshot()).cards.single.id,
        initial.id,
      );
      await web('delete');
      await store.syncNow();
      expect((await Cache.instance.reminderSnapshot()).cards, isEmpty);

      // A native-created offline card gets its own reminder and never borrows the
      // owner's recipient. Membership revocation cancels it on online refresh.
      transport.offline = true;
      final nativeCard = await store.saveCard(
        day: addDays(initial.day, 2),
        title: 'Native future',
        note: '',
        startTime: '12:00',
        color: 'blue',
        priority: 'none',
        deadlineAt: null,
        tags: [],
        reminders: [60],
        checklist: [],
      );
      expect(nativeCard, isNotNull);
      expect(driver.alarms, hasLength(1));
      transport.offline = false;
      await store.syncNow();
      expect(store.pendingWrites, 0);
      expect(driver.alarms, hasLength(1));
      await web('revoke');
      await store.syncNow();
      expect(driver.alarms, isEmpty);
      await expectLater(
        store.api.cards(initial.day, initial.day),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 403)),
      );
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
