import 'dates.dart';

enum DeadlineState { none, upcoming, soon, overdue, completed }

DeadlineState deadlineState(
  String? deadlineAt,
  bool done, {
  DateTime? now,
}) {
  if (deadlineAt == null || deadlineAt.isEmpty) return DeadlineState.none;
  if (done) return DeadlineState.completed;
  final deadline = DateTime.parse(deadlineAt).toUtc();
  final remaining = deadline.difference((now ?? DateTime.now()).toUtc());
  if (remaining.isNegative) return DeadlineState.overdue;
  if (remaining <= const Duration(hours: 24)) return DeadlineState.soon;
  return DeadlineState.upcoming;
}

String deadlineLabel(String deadlineAt) {
  final local = DateTime.parse(deadlineAt).toLocal();
  return '${shortDate(dayKey(local))} ${two(local.hour)}:${two(local.minute)}';
}

String deadlineBadgeLabel(String deadlineAt, DeadlineState state) {
  final prefix = switch (state) {
    DeadlineState.overdue => 'Gecikti',
    DeadlineState.soon => 'Yaklaşıyor',
    _ => 'Son',
  };
  return '$prefix · ${deadlineLabel(deadlineAt)}';
}
