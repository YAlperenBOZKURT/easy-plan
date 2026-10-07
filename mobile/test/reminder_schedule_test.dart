import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;
import 'package:planner/api/models.dart';
import 'package:planner/notifications.dart';
import 'package:planner/reminder_schedule.dart';
import 'support/fake_notifications.dart';

const settings = ReminderSettings(
  userId: 'user-1',
  boardId: 'board-1',
  timezone: 'Europe/Istanbul',
  defaultCardTime: '10:30',
);
PlannerCard card({
  String id = 'card-1',
  String day = '2026-10-09',
  String? start = '12:00',
  String board = 'board-1',
  String creator = 'user-1',
  bool done = false,
  String? archived,
  String? trashed,
  List<int> offsets = const [60],
}) => PlannerCard.fromJson({
  'id': id,
  'day': day,
  'title': 'Plan',
  'boardId': board,
  'creatorId': creator,
  'startTime': start,
  'done': done,
  'archivedAt': archived,
  'trashedAt': trashed,
  'reminders': offsets,
});

void main() {
  final now = DateTime.utc(2026, 10, 7);
  setUpAll(() {
    tzdata.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('UTC'));
  });

  test('plans the complete board and isolates recipient and lifecycle', () {
    final plan = buildReminderSchedule(
      [
        card(day: '2026-11-20'),
        card(id: 'another-board', board: 'board-2'),
        card(id: 'another-creator', creator: 'user-2'),
        card(id: 'done', done: true),
        card(id: 'archive', archived: '2026-10-07'),
        card(id: 'trash', trashed: '2026-10-07'),
        card(id: 'past', day: '2026-10-01'),
      ],
      settings,
      now,
    );
    expect(plan, hasLength(1));
    expect(plan.single.at.toUtc(), DateTime.utc(2026, 11, 20, 8));
  });
  test(
    'account timezone and configured untimed default override device timezone',
    () {
      final plan = buildReminderSchedule([card(start: null)], settings, now);
      expect(plan.single.at.toUtc(), DateTime.utc(2026, 10, 9, 6, 30));
    },
  );
  test(
    'DST countdown subtracts elapsed time across the spring clock change',
    () {
      final at = Notifications.fireAtFor(
        card(day: '2026-03-08', start: '03:30'),
        60,
        timezone: 'America/New_York',
      );
      expect(at.toUtc(), DateTime.utc(2026, 3, 8, 6, 30));
      expect(at.hour, 1);
    },
  );
  test('keeps the nearest 64 reminders in deterministic order', () {
    final cards = List.generate(
      80,
      (i) => card(
        id: 'card-$i',
        day: DateTime.utc(
          2026,
          10,
          9,
        ).add(Duration(days: i)).toIso8601String().substring(0, 10),
      ),
    );
    final plan = buildReminderSchedule(cards.reversed, settings, now);
    expect(plan, hasLength(64));
    expect(plan.first.at.day, 9);
    expect(
      plan.map((item) => item.payload),
      buildReminderSchedule(cards, settings, now).map((item) => item.payload),
    );
  });
  test(
    'duplicate offsets do not duplicate alarms; IDs have a stable known hash',
    () {
      expect(
        buildReminderSchedule(
          [
            card(offsets: [60, 60]),
          ],
          settings,
          now,
        ),
        hasLength(1),
      );
      expect(reminderId('hello'), 0x4f9f2cab);
    },
  );
  test('scope and language are part of the durable schedule', () {
    final tr = buildReminderSchedule([card()], settings, now).single;
    final en = buildReminderSchedule(
      [card()],
      settings,
      now,
      language: 'en',
    ).single;
    expect(tr.id, en.id);
    expect(tr.payload, isNot(en.payload));
    expect(en.title, '1 hour remaining');
    const other = ReminderSettings(
      userId: 'user-2',
      boardId: 'board-1',
      timezone: 'Europe/Istanbul',
      defaultCardTime: '10:30',
    );
    expect(
      buildReminderSchedule([card(creator: 'user-2')], other, now).single.id,
      isNot(tr.id),
    );
  });

  test(
    'unchanged snapshots and a process restart preserve existing OS alarms',
    () async {
      final driver = FakeNotificationDriver();
      final service = Notifications(driver: driver, now: () => now);
      await service.reconcile([card()], settings);
      await service.reconcile([card()], settings);
      await Notifications(
        driver: driver,
        now: () => now,
      ).reconcile([card()], settings);
      expect(driver.scheduled, hasLength(1));
      expect(driver.cancelled, isEmpty);
      expect(driver.clears, 0);
    },
  );
  test(
    'completion, removal and editing only cancel or replace affected alarms',
    () async {
      final driver = FakeNotificationDriver();
      final service = Notifications(driver: driver, now: () => now);
      await service.reconcile([card(), card(id: 'other')], settings);
      await service.reconcile([
        card(start: '15:00'),
        card(id: 'other'),
      ], settings);
      expect(driver.scheduled, hasLength(3));
      expect(driver.cancelled, hasLength(1));
      await service.reconcile([card(done: true), card(id: 'other')], settings);
      expect(driver.alarms, hasLength(1));
      await service.reconcile([], settings);
      expect(driver.alarms, isEmpty);
    },
  );
  test(
    'logout waits for an in-flight platform write and leaves no alarms',
    () async {
      final gate = Completer<void>();
      final started = Completer<void>();
      final driver = FakeNotificationDriver()
        ..scheduleGate = gate.future
        ..onSchedule = () {
          if (!started.isCompleted) started.complete();
        };
      final service = Notifications(driver: driver, now: () => now);
      final scheduling = service.reconcile([
        card(),
        card(id: 'second'),
      ], settings);
      await started.future;
      final clearing = service.clear();
      gate.complete();
      await Future.wait([scheduling, clearing]);
      expect(driver.scheduled, hasLength(1));
      expect(driver.alarms, isEmpty);
    },
  );
  test('a newer board snapshot supersedes a slow previous one', () async {
    final gate = Completer<void>();
    final started = Completer<void>();
    final driver = FakeNotificationDriver()
      ..scheduleGate = gate.future
      ..onSchedule = () {
        if (!started.isCompleted) started.complete();
      };
    final service = Notifications(driver: driver, now: () => now);
    final first = service.reconcile([card(), card(id: 'second')], settings);
    await started.future;
    const other = ReminderSettings(
      userId: 'user-1',
      boardId: 'board-2',
      timezone: 'UTC',
      defaultCardTime: '09:00',
    );
    final next = service.reconcile([card(id: 'next', board: 'board-2')], other);
    gate.complete();
    await Future.wait([first, next]);
    expect(driver.alarms, hasLength(1));
    expect(driver.alarms.values.single.payload, contains('next'));
  });
  test(
    'platform failures can be retried without poisoning the serial queue',
    () async {
      final driver = FakeNotificationDriver()..failSchedule = true;
      final service = Notifications(driver: driver, now: () => now);
      expect(await service.reconcile([card()], settings), 0);
      driver.failSchedule = false;
      expect(await service.reconcile([card()], settings), 1);
      expect(driver.alarms, hasLength(1));
    },
  );
  test('expired alarms make room for the next upcoming reminder', () async {
    var clock = now;
    final driver = FakeNotificationDriver();
    final service = Notifications(driver: driver, now: () => clock);
    await service.reconcile([
      card(),
      card(id: 'later', day: '2026-10-11'),
    ], settings);
    clock = DateTime.utc(2026, 10, 10);
    await service.reconcile([
      card(),
      card(id: 'later', day: '2026-10-11'),
    ], settings);
    expect(driver.alarms, hasLength(1));
    expect(driver.alarms.values.single.payload, contains('later'));
  });
}
