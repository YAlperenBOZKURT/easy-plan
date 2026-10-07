import 'dart:convert';
import 'package:timezone/timezone.dart' as tz;
import 'api/models.dart';
import 'dates.dart';

class ReminderSettings {
  const ReminderSettings({
    required this.userId,
    required this.boardId,
    required this.timezone,
    required this.defaultCardTime,
  });
  final String userId;
  final String boardId;
  final String timezone;
  final String defaultCardTime;
  factory ReminderSettings.fromJson(Map<String, dynamic> json) =>
      ReminderSettings(
        userId: json['userId'] as String,
        boardId: json['boardId'] as String,
        timezone: json['timezone'] as String,
        defaultCardTime: json['defaultCardTime'] as String,
      );
  Map<String, dynamic> toJson() => {
    'userId': userId,
    'boardId': boardId,
    'timezone': timezone,
    'defaultCardTime': defaultCardTime,
  };
}

class ScheduledReminder {
  const ScheduledReminder({
    required this.id,
    required this.at,
    required this.title,
    required this.body,
    required this.note,
    required this.payload,
  });
  final int id;
  final tz.TZDateTime at;
  final String title;
  final String body;
  final String note;
  final String payload;
}

/// Stable across processes, unlike Object.hash. Scope is part of the identity.
int reminderId(String key) {
  var hash = 0x811c9dc5;
  for (final byte in utf8.encode(key)) {
    hash = ((hash ^ byte) * 0x01000193) & 0xffffffff;
  }
  return hash & 0x7fffffff;
}

tz.TZDateTime reminderFireAt(
  PlannerCard card,
  int offset, {
  tz.Location? location,
  String defaultCardTime = '09:00',
}) {
  final day = parseDay(card.day);
  final parts = (card.hasTime ? card.startTime! : defaultCardTime).split(':');
  return tz.TZDateTime(
    location ?? tz.local,
    day.year,
    day.month,
    day.day,
    int.parse(parts[0]),
    int.parse(parts[1]),
  ).subtract(Duration(minutes: offset));
}

/// Nearest 64 alarms across the entire selected board, never just its viewport.
List<ScheduledReminder> buildReminderSchedule(
  Iterable<PlannerCard> cards,
  ReminderSettings settings,
  DateTime now, {
  String language = 'tr',
  int limit = 64,
}) {
  final zone = tz.getLocation(settings.timezone);
  final candidates =
      <({PlannerCard card, int offset, tz.TZDateTime at, String key})>[];
  for (final card in cards) {
    if (card.boardId != settings.boardId ||
        card.creatorId != settings.userId ||
        card.done ||
        card.archivedAt != null ||
        card.trashedAt != null) {
      continue;
    }
    for (final offset in card.reminders.toSet()) {
      if (offset <= 0) continue;
      final at = reminderFireAt(
        card,
        offset,
        location: zone,
        defaultCardTime: settings.defaultCardTime,
      );
      if (!at.isAfter(now)) continue;
      candidates.add((
        card: card,
        offset: offset,
        at: at,
        key: '${settings.userId}/${settings.boardId}/${card.id}/$offset',
      ));
    }
  }
  candidates.sort((a, b) {
    final time = a.at.compareTo(b.at);
    return time != 0 ? time : a.key.compareTo(b.key);
  });
  final usedIds = <int>{};
  return candidates.take(limit).map((item) {
    var id = reminderId(item.key);
    while (!usedIds.add(id)) {
      id = (id + 1) & 0x7fffffff;
    }
    final amount = item.offset % 1440 == 0
        ? item.offset ~/ 1440
        : item.offset ~/ 60;
    final unit = language == 'en'
        ? '${item.offset % 1440 == 0 ? 'day' : 'hour'}${amount == 1 ? '' : 's'}'
        : (item.offset % 1440 == 0 ? 'gün' : 'saat');
    final title = language == 'en'
        ? '$amount $unit remaining'
        : '$amount $unit kaldı';
    final body = item.card.title.isEmpty ? 'Easy Plan' : item.card.title;
    return ScheduledReminder(
      id: id,
      at: item.at,
      title: title,
      body: body,
      note: item.card.note,
      payload: jsonEncode({
        'kind': 'easy-plan-reminder',
        'key': item.key,
        'cardId': item.card.id,
        'boardId': settings.boardId,
        'at': item.at.toUtc().toIso8601String(),
        'title': title,
        'body': body,
        'note': item.card.note,
      }),
    );
  }).toList();
}
