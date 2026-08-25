import 'package:flutter_test/flutter_test.dart';
import 'package:planner/planner_views.dart';

void main() {
  test('ay geçişinde ay sonunu güvenli sınırlar', () {
    expect(addMonths('2026-01-31', 1), '2026-02-28');
    expect(addMonths('2024-01-31', 1), '2024-02-29');
  });

  test('ay görünümü pazartesiden pazara 42 gün üretir', () {
    expect(
      monthGridBounds('2026-08-21'),
      (from: '2026-07-27', to: '2026-09-06'),
    );
    expect(daysBetween('2026-07-27', '2026-09-06'), hasLength(42));
  });

  test('hafta gün gün, diğer görünümler ay ay ilerler', () {
    expect(
      plannerRange(PlannerViewMode.week, '2026-08-21', 7),
      (from: '2026-08-21', to: '2026-08-27'),
    );
    expect(
      shiftPlannerAnchor(PlannerViewMode.week, '2026-08-21', 1),
      '2026-08-22',
    );
    expect(
      shiftPlannerAnchor(PlannerViewMode.agenda, '2026-08-21', 1),
      '2026-09-21',
    );
  });
}
