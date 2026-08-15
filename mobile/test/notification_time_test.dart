import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

PlannerCard card({required String day, String? start}) => PlannerCard(
  id: 'c1',
  day: day,
  title: 'Test',
  note: '',
  startTime: start,
  endTime: null,
  color: 'blue',
  done: false,
  sortIndex: 0,
  manualSort: false,
  habitId: null,
  reminders: const [],
  images: const [],
  updatedAt: '',
);

void main() {
  setUpAll(() {
    tzdata.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Europe/Istanbul'));
  });

  test('saatli kart: başlangıçtan geri sayar', () {
    final at = Notifications.fireAtFor(
      card(day: '2026-08-14', start: '15:00'),
      60,
    );
    expect('${at.hour}:${at.minute}', '14:0');
    expect(at.day, 14);
  });

  test('1 gün kala önceki güne düşer', () {
    final at = Notifications.fireAtFor(
      card(day: '2026-08-14', start: '15:00'),
      1440,
    );
    expect(at.day, 13);
    expect(at.hour, 15);
  });

  test('saatsiz kart 09:00 baz alır', () {
    final at = Notifications.fireAtFor(card(day: '2026-08-14'), 60);
    expect(at.hour, 8);
    expect(at.day, 14);
  });
}
