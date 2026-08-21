import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/filters.dart';

PlannerCard _sampleCard({
  String id = 'c1',
  String day = '2026-08-19',
  String title = 'Test',
  String note = '',
  String? startTime,
  String? endTime,
  String color = 'blue',
  bool done = false,
  double sortIndex = 600,
  bool manualSort = false,
  String? habitId,
  List<ChecklistItem> checklist = const [],
  String priority = 'none',
  String? deadlineAt,
  List<String> tags = const [],
  List<int> reminders = const [],
  List<CardImage> images = const [],
  String updatedAt = '2026-08-19T08:00:00Z',
}) =>
    PlannerCard(
      id: id,
      day: day,
      title: title,
      note: note,
      startTime: startTime,
      endTime: endTime,
      color: color,
      done: done,
      sortIndex: sortIndex,
      manualSort: manualSort,
      habitId: habitId,
      checklist: checklist,
      priority: priority,
      deadlineAt: deadlineAt,
      tags: tags,
      reminders: reminders,
      images: images,
      updatedAt: updatedAt,
    );

void main() {
  group('CardFilterState tests', () {
    test('default filters match all cards', () {
      final card = _sampleCard();
      expect(CardFilterState.defaultFilters.matches(card), isTrue);
      expect(CardFilterState.defaultFilters.activeCount, equals(0));
      expect(CardFilterState.defaultFilters.hasActiveFilters, isFalse);
    });

    test('filters by status', () {
      final todoCard = _sampleCard(done: false);
      final doneCard = _sampleCard(done: true);

      const todoFilter = CardFilterState(status: FilterStatus.todo);
      const doneFilter = CardFilterState(status: FilterStatus.done);

      expect(todoFilter.matches(todoCard), isTrue);
      expect(todoFilter.matches(doneCard), isFalse);

      expect(doneFilter.matches(todoCard), isFalse);
      expect(doneFilter.matches(doneCard), isTrue);
    });

    test('filters by priority', () {
      final urgentCard = _sampleCard(priority: 'urgent');
      final lowCard = _sampleCard(priority: 'low');

      const urgentFilter = CardFilterState(priority: 'urgent');
      expect(urgentFilter.matches(urgentCard), isTrue);
      expect(urgentFilter.matches(lowCard), isFalse);
    });

    test('filters by tags case-insensitively', () {
      final tagged = _sampleCard(tags: ['İş', 'Proje']);
      final other = _sampleCard(tags: ['Kişisel']);

      const tagFilter = CardFilterState(tags: {'iş'});
      expect(tagFilter.matches(tagged), isTrue);
      expect(tagFilter.matches(other), isFalse);
    });

    test('filters by habit origin', () {
      final habitCard = _sampleCard(habitId: 'h1');
      final manualCard = _sampleCard(habitId: null);

      const habitFilter = CardFilterState(habit: FilterHabit.habit);
      const manualFilter = CardFilterState(habit: FilterHabit.manual);

      expect(habitFilter.matches(habitCard), isTrue);
      expect(habitFilter.matches(manualCard), isFalse);

      expect(manualFilter.matches(habitCard), isFalse);
      expect(manualFilter.matches(manualCard), isTrue);
    });

    test('filters by deadline and overdue', () {
      final now = DateTime.parse('2026-08-19T12:00:00Z');
      final overdueCard = _sampleCard(
        deadlineAt: '2026-08-19T10:00:00Z',
        done: false,
      );
      final upcomingCard = _sampleCard(
        deadlineAt: '2026-08-19T15:00:00Z',
        done: false,
      );
      final completedCard = _sampleCard(
        deadlineAt: '2026-08-19T10:00:00Z',
        done: true,
      );

      const hasDeadline = CardFilterState(deadline: FilterDeadline.hasDeadline);
      expect(hasDeadline.matches(overdueCard), isTrue);
      expect(hasDeadline.matches(upcomingCard), isTrue);

      const overdueFilter = CardFilterState(deadline: FilterDeadline.overdue);
      expect(overdueFilter.matches(overdueCard, now), isTrue);
      expect(overdueFilter.matches(upcomingCard, now), isFalse);
      expect(overdueFilter.matches(completedCard, now), isFalse);
    });

    test('filters by color', () {
      final redCard = _sampleCard(color: 'red');
      final blueCard = _sampleCard(color: 'blue');

      const redFilter = CardFilterState(color: 'red');
      expect(redFilter.matches(redCard), isTrue);
      expect(redFilter.matches(blueCard), isFalse);
    });
  });
}
