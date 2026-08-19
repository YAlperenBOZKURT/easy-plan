import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/models.dart';
import 'package:planner/cache.dart';
import 'package:planner/dates.dart';

PlannerCard card(String id, String day, String title) => PlannerCard(
  id: id,
  day: day,
  title: title,
  note: 'not',
  startTime: '09:30',
  endTime: null,
  color: 'teal',
  done: false,
  sortIndex: 570,
  manualSort: false,
  habitId: null,
  reminders: const [60],
  images: const [],
  updatedAt: '2026-08-14T10:00:00.000Z',
);

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    await Cache.useInMemory();
  });

  test('kartlar yerel kopyaya yazılır ve aralıkla okunur', () async {
    final today = todayKey();
    await Cache.instance.saveCards([
      card('a', today, 'Bugün'),
      card('b', addDays(today, 2), 'İki gün sonra'),
      card('c', addDays(today, 40), 'Pencere dışı'),
    ]);

    final week = await Cache.instance.cardsBetween(today, addDays(today, 6));
    expect(week.map((c) => c.id), ['a', 'b']);

    // Alanlar kayıpsız geri geliyor mu
    final first = week.first;
    expect(first.title, 'Bugün');
    expect(first.note, 'not');
    expect(first.startTime, '09:30');
    expect(first.color, 'teal');
    expect(first.reminders, [60]);
  });

  test('tombstone gelince yerel kopyadan silinir', () async {
    final today = todayKey();
    await Cache.instance.saveCards([card('x', today, 'Silinecek')]);
    expect(
      (await Cache.instance.cardsBetween(today, today)).any((c) => c.id == 'x'),
      isTrue,
    );

    await Cache.instance.removeCards(['x']);
    expect(
      (await Cache.instance.cardsBetween(today, today)).any((c) => c.id == 'x'),
      isFalse,
    );
  });

  test('çevrimdışıyken kart başlığı ve notunda arama yapılır', () async {
    final today = todayKey();
    await Cache.instance.saveCards([
      card('search-title', today, 'Özel proje sunumu'),
      card('search-note', addDays(today, 1), 'Toplantı').copyWith(
        note: 'Müşteri taslağını hazırla',
      ),
    ]);
    expect(
      (await Cache.instance.searchCards('proje sun')).map((item) => item.id),
      ['search-title'],
    );
    expect(
      (await Cache.instance.searchCards('müşteri tasla')).map((item) => item.id),
      ['search-note'],
    );
  });

  test('çevrimdışı yazmalar sırayla kuyruğa girer ve boşaltılır', () async {
    expect(await Cache.instance.pendingCount(), 0);

    await Cache.instance.enqueue('POST', '/cards', {
      'id': 'yeni',
      'title': 'Çevrimdışı kart',
    });
    await Cache.instance.enqueue('PATCH', '/cards/yeni', {'done': true});
    await Cache.instance.enqueue('DELETE', '/cards/eski', null);

    final queued = await Cache.instance.pending();
    expect(queued.map((q) => q.method), [
      'POST',
      'PATCH',
      'DELETE',
    ], reason: 'sıra korunmalı');
    expect(queued.first.body!['title'], 'Çevrimdışı kart');
    expect(queued.last.body, isNull);

    for (final item in queued) {
      await Cache.instance.dequeue(item.id);
    }
    expect(await Cache.instance.pendingCount(), 0);
  });

  test('senkron damgası saklanır', () async {
    expect(await Cache.instance.lastSync, isNull);
    await Cache.instance.setLastSync('2026-08-14T12:00:00.000Z');
    expect(await Cache.instance.lastSync, '2026-08-14T12:00:00.000Z');
  });

  test('istemci kimliği geçerli UUID v4 üretir', () {
    final id = newUuid();
    expect(
      id,
      matches(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ),
      ),
    );
    expect(newUuid(), isNot(id));
  });
}
