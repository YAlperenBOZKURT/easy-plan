import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';

void main() {
  test('checklist kart JSON verisinde kaybolmadan taşınır', () {
    final card = PlannerCard.fromJson({
      'id': 'card-1',
      'day': '2026-08-15',
      'checklist': [
        {'id': 'item-1', 'text': 'İlk iş', 'done': true},
        {'id': 'item-2', 'text': 'İkinci iş', 'done': false},
      ],
      'priority': 'high',
      'deadlineAt': '2026-08-20T15:00:00.000Z',
      'tags': ['Backend', 'v1'],
    });

    expect(card.checklist, hasLength(2));
    expect(card.checklist.first.done, isTrue);
    expect(card.priority, 'high');
    expect(card.deadlineAt, '2026-08-20T15:00:00.000Z');
    expect(card.tags, ['Backend', 'v1']);
    expect(isChecklistComplete(card.checklist), isFalse);
    expect(card.toJson()['checklist'], [
      {'id': 'item-1', 'text': 'İlk iş', 'done': true},
      {'id': 'item-2', 'text': 'İkinci iş', 'done': false},
    ]);
    expect(card.toJson()['priority'], 'high');
    expect(card.toJson()['deadlineAt'], '2026-08-20T15:00:00.000Z');
    expect(card.toJson()['tags'], ['Backend', 'v1']);

    final changed = card.copyWith(
      checklist: [card.checklist.first.copyWith(done: false)],
      tags: ['Mobil'],
    );
    expect(changed.checklist.single.done, isFalse);
    expect(card.checklist.first.done, isTrue);
    expect(changed.tags, ['Mobil']);
    expect(card.tags, ['Backend', 'v1']);
    expect(
      isChecklistComplete([
        card.checklist.first,
        card.checklist.last.copyWith(done: true),
      ]),
      isTrue,
    );
    expect(isChecklistComplete(const []), isFalse);

    final cleared = card.copyWith(deadlineAt: null);
    expect(cleared.deadlineAt, isNull);
    expect(card.deadlineAt, isNotNull);
  });
}
