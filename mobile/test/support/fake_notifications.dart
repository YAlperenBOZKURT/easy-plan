import 'package:planner/notifications.dart';
import 'package:planner/reminder_schedule.dart';

class FakeNotificationDriver implements NotificationDriver {
  final alarms = <int, ScheduledReminder>{};
  final scheduled = <ScheduledReminder>[];
  final cancelled = <int>[];
  int clears = 0;
  int initializations = 0;
  Future<void>? scheduleGate;
  void Function()? onSchedule;
  bool failSchedule = false;
  @override
  Future<void> initialize() async {
    initializations++;
  }

  @override
  Future<Map<int, String?>> pending() async => {
    for (final item in alarms.values) item.id: item.payload,
  };
  @override
  Future<void> schedule(ScheduledReminder item) async {
    onSchedule?.call();
    await scheduleGate;
    if (failSchedule) throw StateError('Schedule failed');
    scheduled.add(item);
    alarms[item.id] = item;
  }

  @override
  Future<void> cancel(int id) async {
    cancelled.add(id);
    alarms.remove(id);
  }

  @override
  Future<void> clear() async {
    clears++;
    alarms.clear();
  }
}
