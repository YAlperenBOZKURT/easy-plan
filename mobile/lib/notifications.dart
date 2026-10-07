import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;
import 'api/models.dart';
import 'app_logger.dart';
import 'reminder_schedule.dart';

abstract class NotificationDriver {
  Future<void> initialize();
  Future<Map<int, String?>> pending();
  Future<void> schedule(ScheduledReminder reminder);
  Future<void> cancel(int id);
  Future<void> clear();
}

/// Reconciles durable OS alarms against a complete cached board snapshot.
/// Requests are serialized; a newer snapshot invalidates an older in-flight one.
class Notifications {
  Notifications({
    required this.driver,
    this.enabled = true,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;
  static final instance = Notifications(
    driver: _PlatformNotificationDriver(),
    enabled: supported,
  );
  static bool get supported =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);
  static const defaultHour = 9;
  final NotificationDriver driver;
  final bool enabled;
  final DateTime Function() _now;
  bool _ready = false;
  Future<void>? _initializing;
  Future<void> _tail = Future.value();
  int _generation = 0;

  Future<void> init() {
    if (!enabled || _ready) return Future.value();
    return _initializing ??= _initialize().whenComplete(
      () => _initializing = null,
    );
  }

  Future<void> _initialize() async {
    try {
      tzdata.initializeTimeZones();
      await driver.initialize();
      _ready = true;
    } catch (error, stack) {
      AppLogger.error('notifications_init_failed', error, stack);
    }
  }

  Future<int> _enqueue(Future<int> Function() action) {
    final result = _tail.then((_) async {
      if (!enabled) return 0;
      await init();
      if (!_ready) return 0;
      try {
        return await action();
      } catch (error, stack) {
        AppLogger.error('notifications_schedule_failed', error, stack);
        return 0;
      }
    });
    _tail = result.then<void>((_) {});
    return result;
  }

  Future<int> reconcile(
    Iterable<PlannerCard> cards,
    ReminderSettings settings, {
    String language = 'tr',
  }) {
    final generation = ++_generation;
    final snapshot = List<PlannerCard>.of(cards);
    return _enqueue(() async {
      if (generation != _generation) return 0;
      final desired = buildReminderSchedule(
        snapshot,
        settings,
        _now(),
        language: language,
      );
      final wanted = {for (final reminder in desired) reminder.id: reminder};
      final pending = await driver.pending();
      if (generation != _generation) return 0;
      for (final entry in pending.entries) {
        if (wanted[entry.key]?.payload == entry.value) continue;
        await driver.cancel(entry.key);
        if (generation != _generation) return 0;
      }
      for (final reminder in desired) {
        if (generation != _generation) return 0;
        if (pending[reminder.id] == reminder.payload) continue;
        // Time may have advanced while a platform operation was pending.
        if (!reminder.at.isAfter(_now())) continue;
        await driver.schedule(reminder);
      }
      return desired.length;
    });
  }

  Future<void> clear() async {
    ++_generation;
    await _enqueue(() async {
      await driver.clear();
      return 0;
    });
  }

  static tz.TZDateTime fireAtFor(
    PlannerCard card,
    int offsetMinutes, {
    String? timezone,
    String defaultCardTime = '09:00',
  }) => reminderFireAt(
    card,
    offsetMinutes,
    location: timezone == null ? null : tz.getLocation(timezone),
    defaultCardTime: defaultCardTime,
  );
}

class _PlatformNotificationDriver implements NotificationDriver {
  final _plugin = FlutterLocalNotificationsPlugin();
  @override
  Future<void> initialize() async {
    final zone = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(zone.identifier));
    final initialized = await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: true,
          requestBadgePermission: false,
          requestSoundPermission: true,
        ),
      ),
    );
    if (initialized == false) {
      throw StateError('Notification initialization failed');
    }
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
  }

  @override
  Future<Map<int, String?>> pending() async => {
    for (final request in await _plugin.pendingNotificationRequests())
      request.id: request.payload,
  };
  @override
  Future<void> cancel(int id) => _plugin.cancel(id: id);
  @override
  Future<void> clear() => _plugin.cancelAll();
  @override
  Future<void> schedule(ScheduledReminder reminder) => _plugin.zonedSchedule(
    id: reminder.id,
    title: reminder.title,
    body: reminder.body,
    scheduledDate: reminder.at,
    payload: reminder.payload,
    androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        'reminders',
        'Hatırlatmalar',
        channelDescription: 'Kart hatırlatmaları',
        importance: Importance.high,
        priority: Priority.high,
        styleInformation: reminder.note.isEmpty
            ? null
            : BigTextStyleInformation(reminder.note),
      ),
      iOS: const DarwinNotificationDetails(),
    ),
  );
}
