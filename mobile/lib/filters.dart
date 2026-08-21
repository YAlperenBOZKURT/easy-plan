import 'api/models.dart';
import 'tags.dart';

enum FilterStatus { all, todo, done }

enum FilterHabit { all, habit, manual }

enum FilterDeadline { all, overdue, hasDeadline }

class CardFilterState {
  const CardFilterState({
    this.status = FilterStatus.all,
    this.priority = 'all',
    this.tags = const {},
    this.habit = FilterHabit.all,
    this.deadline = FilterDeadline.all,
    this.color = 'all',
  });

  final FilterStatus status;
  final String priority; // 'all' | 'none' | 'low' | 'medium' | 'high' | 'urgent'
  final Set<String> tags;
  final FilterHabit habit;
  final FilterDeadline deadline;
  final String color; // 'all' | color

  static const defaultFilters = CardFilterState();

  int get activeCount {
    var count = 0;
    if (status != FilterStatus.all) count++;
    if (priority != 'all') count++;
    if (tags.isNotEmpty) count += tags.length;
    if (habit != FilterHabit.all) count++;
    if (deadline != FilterDeadline.all) count++;
    if (color != 'all') count++;
    return count;
  }

  bool get hasActiveFilters => activeCount > 0;

  bool matches(PlannerCard card, [DateTime? now]) {
    final currentTime = now ?? DateTime.now();

    // Status
    if (status == FilterStatus.todo && card.done) return false;
    if (status == FilterStatus.done && !card.done) return false;

    // Priority
    if (priority != 'all' && card.priority != priority) return false;

    // Tags
    if (tags.isNotEmpty) {
      final cardTagKeys = card.tags.map(tagKey).toSet();
      final matchesAll = tags.every(
        (t) => cardTagKeys.contains(tagKey(t)),
      );
      if (!matchesAll) return false;
    }

    // Habit
    if (habit == FilterHabit.habit && card.habitId == null) return false;
    if (habit == FilterHabit.manual && card.habitId != null) return false;

    // Deadline
    if (deadline == FilterDeadline.hasDeadline && card.deadlineAt == null) {
      return false;
    }
    if (deadline == FilterDeadline.overdue) {
      if (card.deadlineAt == null || card.done) return false;
      final parsed = DateTime.tryParse(card.deadlineAt!);
      if (parsed == null || !parsed.isBefore(currentTime)) return false;
    }

    // Color
    if (color != 'all' && card.color != color) return false;

    return true;
  }

  CardFilterState copyWith({
    FilterStatus? status,
    String? priority,
    Set<String>? tags,
    FilterHabit? habit,
    FilterDeadline? deadline,
    String? color,
  }) {
    return CardFilterState(
      status: status ?? this.status,
      priority: priority ?? this.priority,
      tags: tags ?? this.tags,
      habit: habit ?? this.habit,
      deadline: deadline ?? this.deadline,
      color: color ?? this.color,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CardFilterState &&
          runtimeType == other.runtimeType &&
          status == other.status &&
          priority == other.priority &&
          tags.length == other.tags.length &&
          tags.containsAll(other.tags) &&
          habit == other.habit &&
          deadline == other.deadline &&
          color == other.color;

  @override
  int get hashCode => Object.hash(
    status,
    priority,
    Object.hashAll(tags),
    habit,
    deadline,
    color,
  );
}
