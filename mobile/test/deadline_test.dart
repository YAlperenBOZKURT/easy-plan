import 'package:flutter_test/flutter_test.dart';
import 'package:planner/deadline.dart';

void main() {
  final now = DateTime.parse('2026-08-20T12:00:00.000Z');

  test('deadline yaklaşan, geciken ve tamamlanan durumları ayırır', () {
    expect(deadlineState(null, false, now: now), DeadlineState.none);
    expect(
      deadlineState('2026-08-20T15:00:00.000Z', false, now: now),
      DeadlineState.soon,
    );
    expect(
      deadlineState('2026-08-22T15:00:00.000Z', false, now: now),
      DeadlineState.upcoming,
    );
    expect(
      deadlineState('2026-08-20T10:00:00.000Z', false, now: now),
      DeadlineState.overdue,
    );
    expect(
      deadlineState('2026-08-20T10:00:00.000Z', true, now: now),
      DeadlineState.completed,
    );
  });
}
