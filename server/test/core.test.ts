import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { repo } from '../src/repo.ts';
import { defaultSortIndex, indexBetween, minutesOf, UNTIMED_BASE } from '../src/sorting.ts';
import { addDays, addYears, isValidInstant, today, weekdayOf, zonedToUtc } from '../src/time.ts';
import { fireAtFor, sanitizeOffsets } from '../src/reminders.ts';
import { materializeHabit, purgeOldHabitCards } from '../src/maintenance.ts';
import type { UserRow } from '../src/types.ts';
import { isChecklistComplete, parseChecklist, sanitizeChecklist } from '../src/checklist.ts';
import { cardDto } from '../src/dto.ts';
import { parseTags, sanitizeTags } from '../src/tags.ts';
import { MAX_SEARCH_RESULTS, readSearchQuery } from '../src/search.ts';

/* --------------------------------------------------------------- yardımcılar */

const makeDb = () => openDb(':memory:');

function makeUser(db: ReturnType<typeof openDb>, id: string, email: string): UserRow {
  const at = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, timezone, daily_summary,
                        last_summary_day, active, last_login_at, created_at, updated_at)
     VALUES (?, ?, '', 'x', 'user', 'Europe/Istanbul', 1, NULL, 1, NULL, ?, ?)`,
  ).run(id, email, at, at);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
}

/* ------------------------------------------------------------------ sıralama */

test('saatli kartlar saate göre, saatsizler en alta sıralanır', () => {
  assert.equal(minutesOf('09:00'), 540);
  assert.equal(minutesOf('24:00'), null);
  assert.equal(minutesOf(null), null);

  assert.equal(defaultSortIndex('09:00', []), 540);
  assert.equal(defaultSortIndex('15:30', [540]), 930);

  // saatsiz kart: her zaman saatlilerin altında ve eklenme sırasıyla
  const first = defaultSortIndex(null, [540, 930]);
  assert.equal(first, UNTIMED_BASE);
  assert.equal(defaultSortIndex(null, [540, 930, first]), UNTIMED_BASE + 10);
});

test('sürüklenen kart komşularının arasına yerleşir', () => {
  assert.equal(indexBetween(540, 900), 720);
  assert.equal(indexBetween(null, 540), 530); // en üste bırakıldı
  assert.equal(indexBetween(900, null), 910); // en alta bırakıldı
  assert.equal(indexBetween(null, null), UNTIMED_BASE); // boş güne bırakıldı
});

test('elle taşınan kartın sırası saat değişse de korunur, sıfırlanınca geri döner', () => {
  const db = makeDb();
  const user = makeUser(db, 'u1', 'a@x.com');
  const store = repo(db, user.id);

  const card = store.cards.create({ day: '2026-08-13', title: 'Test', startTime: '09:00' });
  assert.equal(card.sort_index, 540);

  store.cards.update(card.id, { sortIndex: 2000, manualSort: true });
  const moved = store.cards.update(card.id, { startTime: '07:00' })!;
  assert.equal(moved.sort_index, 2000, 'elle taşınmış kartın sırası saate göre bozulmamalı');

  const reset = store.cards.update(card.id, { manualSort: false })!;
  assert.equal(reset.sort_index, 420, 'sıfırlanınca yeniden saate göre hesaplanmalı');
});

test('checklist temizlenir, doğrulanır ve kartla birlikte kalıcı olur', () => {
  const valid = sanitizeChecklist([
    { id: 'first', text: '  İlk iş  ', done: true },
    { text: 'İkinci iş' },
  ]);
  assert.equal(valid.valid, true);
  assert.equal(valid.items[0]?.text, 'İlk iş');
  assert.equal(valid.items[1]?.done, false);
  assert.ok(valid.items[1]?.id);
  assert.equal(isChecklistComplete(valid.items), false);
  assert.equal(isChecklistComplete(valid.items.map((item) => ({ ...item, done: true }))), true);
  assert.equal(isChecklistComplete([]), false);

  assert.equal(sanitizeChecklist([{ id: 'same', text: 'A' }, { id: 'same', text: 'B' }]).valid, false);
  assert.equal(sanitizeChecklist([{ text: '   ' }]).valid, false);
  assert.deepEqual(parseChecklist('bozuk-json'), []);

  const db = makeDb();
  const user = makeUser(db, 'u-checklist', 'checklist@x.com');
  const store = repo(db, user.id);
  const card = store.cards.create({
    day: '2026-08-13',
    checklist: valid.items,
    priority: 'high',
    deadlineAt: '2026-08-20T15:00:00.000Z',
    tags: ['Backend', 'Kolay İş'],
  });
  assert.deepEqual(cardDto(card).checklist, valid.items);
  assert.equal(cardDto(card).priority, 'high');
  assert.equal(cardDto(card).deadlineAt, '2026-08-20T15:00:00.000Z');
  assert.deepEqual(cardDto(card).tags, ['Backend', 'Kolay İş']);

  const updated = store.cards.update(card.id, {
    checklist: valid.items.map((item) => ({ ...item, done: true })),
    priority: 'urgent',
    deadlineAt: null,
    tags: ['API'],
  })!;
  assert.ok(cardDto(updated).checklist.every((item) => item.done));
  assert.equal(cardDto(updated).priority, 'urgent');
  assert.equal(cardDto(updated).deadlineAt, null);
  assert.deepEqual(cardDto(updated).tags, ['API']);
});

test('kart etiketleri normalize edilir, sınırlandırılır ve öneriler tekilleştirilir', () => {
  assert.deepEqual(sanitizeTags(['  Backend  ', 'Kolay   İş ']), {
    valid: true,
    tags: ['Backend', 'Kolay İş'],
  });
  assert.equal(sanitizeTags(['İş', 'iş']).valid, false);
  assert.equal(sanitizeTags(['Backend API', 'backend api']).valid, false);
  assert.equal(sanitizeTags(['x'.repeat(31)]).valid, false);
  assert.deepEqual(parseTags('bozuk-json'), []);

  const db = makeDb();
  const user = makeUser(db, 'u-tags', 'tags@x.com');
  const store = repo(db, user.id);
  store.cards.create({ day: '2026-08-13', tags: ['Backend', 'İş'] });
  store.cards.create({ day: '2026-08-14', tags: ['backend', 'Kişisel'] });
  assert.deepEqual(store.cards.allTags(), ['Backend', 'İş', 'Kişisel']);
});

test('kart araması başlık ve notlarda çalışır, güncellemeleri izler ve kullanıcıyı ayırır', () => {
  const db = makeDb();
  const alice = makeUser(db, 'u-search-a', 'search-a@x.com');
  const bob = makeUser(db, 'u-search-b', 'search-b@x.com');
  const aliceStore = repo(db, alice.id);
  const bobStore = repo(db, bob.id);

  const first = aliceStore.cards.create({
    day: '2026-08-18',
    title: 'Proje sunumu',
    note: 'Müşteri için son taslağı hazırla',
  });
  aliceStore.cards.create({ day: '2026-08-19', title: 'Market alışverişi' });
  bobStore.cards.create({ day: '2026-08-18', title: 'Gizli proje sunumu' });

  const parsed = readSearchQuery('  proje   sun  ');
  assert.equal(parsed.valid, true);
  if (!parsed.valid) return;
  assert.equal(parsed.query, 'proje sun');
  assert.deepEqual(
    aliceStore.cards.search(parsed.match, MAX_SEARCH_RESULTS).map((card) => card.id),
    [first.id],
  );
  assert.deepEqual(bobStore.cards.search(parsed.match, MAX_SEARCH_RESULTS).length, 1);

  aliceStore.cards.update(first.id, { title: 'Tamamlandı', note: 'Arşiv kaydı' });
  assert.equal(aliceStore.cards.search(parsed.match, MAX_SEARCH_RESULTS).length, 0);

  const noteQuery = readSearchQuery('arş');
  assert.equal(noteQuery.valid, true);
  if (noteQuery.valid) {
    assert.deepEqual(
      aliceStore.cards.search(noteQuery.match, MAX_SEARCH_RESULTS).map((card) => card.id),
      [first.id],
    );
  }
  aliceStore.cards.remove(first.id);
  if (noteQuery.valid) {
    assert.equal(aliceStore.cards.search(noteQuery.match, MAX_SEARCH_RESULTS).length, 0);
  }

  assert.deepEqual(readSearchQuery('a'), { valid: false });
  assert.deepEqual(readSearchQuery('x'.repeat(101)), { valid: false });
  const operatorQuery = readSearchQuery('" OR *');
  assert.equal(operatorQuery.valid, true, 'FTS operatörleri veri olarak işlenir');
  if (operatorQuery.valid) {
    assert.doesNotThrow(() => aliceStore.cards.search(operatorQuery.match, MAX_SEARCH_RESULTS));
  }
});

/* -------------------------------------------------------- kullanıcı ayrımı */

test('bir kullanıcı diğerinin kartına hiçbir şekilde erişemez', () => {
  const db = makeDb();
  const alice = makeUser(db, 'u-alice', 'alice@x.com');
  const bob = makeUser(db, 'u-bob', 'bob@x.com');
  const aliceStore = repo(db, alice.id);
  const bobStore = repo(db, bob.id);

  const card = aliceStore.cards.create({ day: '2026-08-13', title: 'Gizli' });
  aliceStore.cards.update(card.id, { tags: ['Gizli'] });
  aliceStore.habits.create({ title: 'Koşu', weekdays: [1], reminders: [] });

  assert.equal(bobStore.cards.get(card.id), undefined, 'başkasının kartı okunamaz');
  assert.equal(bobStore.cards.update(card.id, { title: 'ele geçirildi' }), undefined);
  assert.deepEqual(bobStore.cards.remove(card.id), [], 'başkasının kartı silinemez');
  assert.equal(bobStore.cards.range('2026-01-01', '2026-12-31').length, 0);
  assert.equal(bobStore.habits.list().length, 0);
  assert.equal(bobStore.images.forCard(card.id).length, 0, 'başkasının görselleri listelenemez');
  assert.deepEqual(bobStore.cards.allTags(), [], 'başkasının etiket önerileri okunamaz');

  // Alice'in kartı hâlâ yerinde ve değişmemiş
  const still = aliceStore.cards.get(card.id)!;
  assert.equal(still.title, 'Gizli');
});

test('senkron akışı yalnızca kendi verisini ve kendi silmelerini taşır', () => {
  const db = makeDb();
  const alice = makeUser(db, 'u-a', 'a@x.com');
  const bob = makeUser(db, 'u-b', 'b@x.com');
  const epoch = '1970-01-01T00:00:00.000Z';

  const aliceStore = repo(db, alice.id);
  const bobStore = repo(db, bob.id);
  const card = aliceStore.cards.create({ day: '2026-08-13', title: 'A' });
  bobStore.cards.create({ day: '2026-08-13', title: 'B' });
  aliceStore.cards.remove(card.id);

  assert.equal(aliceStore.cards.changedSince(epoch).length, 0);
  assert.equal(aliceStore.deletions.since(epoch).length, 1);
  assert.equal(bobStore.deletions.since(epoch).length, 0, 'silme kaydı diğer kullanıcıya sızmamalı');
  assert.equal(bobStore.cards.changedSince(epoch).length, 1);
});

/* ------------------------------------------------------------ hatırlatmalar */

test('hatırlatma zamanı kullanıcının saat dilimine göre hesaplanır', () => {
  const user = { timezone: 'Europe/Istanbul' };
  // 13 Ağustos 2026 15:00 İstanbul = 12:00 UTC (UTC+3)
  assert.equal(fireAtFor({ day: '2026-08-13', start_time: '15:00' }, user, 60), '2026-08-13T11:00:00.000Z');
  assert.equal(fireAtFor({ day: '2026-08-13', start_time: '15:00' }, user, 1440), '2026-08-12T12:00:00.000Z');
  // saatsiz kart varsayılan saate (09:00) düşer
  assert.equal(fireAtFor({ day: '2026-08-13', start_time: null }, user, 60), '2026-08-13T05:00:00.000Z');
});

test('geçersiz hatırlatma aralıkları ayıklanır', () => {
  assert.deepEqual(sanitizeOffsets([60, 1440, 60, 5, 'x']), [1440, 60]);
  assert.deepEqual(sanitizeOffsets(undefined), []);
});

test('gönderilmiş hatırlatma yeniden zamanlanmaz', () => {
  const db = makeDb();
  const user = makeUser(db, 'u-r', 'r@x.com');
  const store = repo(db, user.id);
  const card = store.cards.create({ day: '2026-08-13', title: 'X', startTime: '15:00' });

  store.reminders.replace(card.id, [{ offset: 60, fireAt: '2026-08-13T11:00:00.000Z' }]);
  db.prepare('UPDATE card_reminders SET sent_at = ?, status = ? WHERE card_id = ?').run(
    '2026-08-13T11:00:01.000Z',
    'sent',
    card.id,
  );

  store.reminders.replace(card.id, [{ offset: 60, fireAt: '2026-08-14T11:00:00.000Z' }]);
  const row = store.reminders.forCard(card.id)[0]!;
  assert.equal(row.fire_at, '2026-08-13T11:00:00.000Z', 'gönderilmiş satırın zamanı değişmemeli');
  assert.equal(row.sent_at, '2026-08-13T11:00:01.000Z');
});

/* ---------------------------------------------------------------- davranış */

test('davranış üretimi idempotenttir ve silinen kart geri gelmez', () => {
  const db = makeDb();
  const user = makeUser(db, 'u-h', 'h@x.com');
  const store = repo(db, user.id);
  const now = new Date('2026-08-13T09:00:00.000Z'); // Perşembe

  const habit = store.habits.create({ title: 'Koşu', weekdays: [1, 3, 5], reminders: [60] });
  const created = materializeHabit(db, user, habit, now);
  assert.ok(created > 100, `bir yıllık üretim beklenir, üretilen: ${created}`);

  // ikinci çalıştırma yeni kart üretmez
  assert.equal(materializeHabit(db, user, store.habits.get(habit.id)!, now), 0);

  // kullanıcı bir kartı siler → bakım tekrar çalışsa da geri gelmez
  const anyCard = store.cards.range('2026-08-13', '2027-08-13').find((c) => c.habit_id === habit.id)!;
  store.cards.remove(anyCard.id);
  assert.equal(materializeHabit(db, user, store.habits.get(habit.id)!, now), 0);
  assert.equal(store.cards.get(anyCard.id), undefined, 'silinen davranış kartı geri gelmemeli');
});

test('davranış kartları yalnızca seçilen günlere düşer', () => {
  const db = makeDb();
  const user = makeUser(db, 'u-w', 'w@x.com');
  const store = repo(db, user.id);
  const now = new Date('2026-08-13T09:00:00.000Z');

  const habit = store.habits.create({ title: 'Salı-Pazar', weekdays: [2, 7], reminders: [] });
  materializeHabit(db, user, habit, now);

  const cards = store.cards.range('2026-08-13', '2026-09-13');
  assert.ok(cards.length > 0);
  for (const card of cards) assert.ok([2, 7].includes(weekdayOf(card.day)), `beklenmeyen gün: ${card.day}`);
});

test('temizlik yalnızca eski davranış kartlarını siler, elle yazılanlara dokunmaz', async () => {
  const db = makeDb();
  const user = makeUser(db, 'u-p', 'p@x.com');
  const store = repo(db, user.id);
  const now = new Date('2026-08-13T09:00:00.000Z');
  const old = addYears(today(user.timezone, now), -1);
  const veryOld = addDays(old, -30);

  const habitCard = store.cards.create({ day: veryOld, title: 'Eski davranış', habitId: 'h1' });
  const manualCard = store.cards.create({ day: veryOld, title: 'Elle yazılmış' });

  const removed = await purgeOldHabitCards(db, user, now);
  assert.equal(removed, 1);
  assert.equal(store.cards.get(habitCard.id), undefined);
  assert.ok(store.cards.get(manualCard.id), 'elle yazılan eski kart korunmalı');
});

/* -------------------------------------------------------------------- zaman */

test('tarih yardımcıları yaz saati ve ay sonlarında doğru çalışır', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addYears('2026-08-13', 1), '2027-08-13');
  assert.equal(weekdayOf('2026-08-13'), 4); // Perşembe
  assert.equal(weekdayOf('2026-08-16'), 7); // Pazar

  // Türkiye kalıcı UTC+3; kış tarihinde de aynı fark beklenir
  assert.equal(zonedToUtc('2026-01-15', '09:00', 'Europe/Istanbul').toISOString(), '2026-01-15T06:00:00.000Z');
  // Yaz saati uygulayan bir bölgede fark değişir
  assert.equal(zonedToUtc('2026-07-15', '12:00', 'Europe/Berlin').toISOString(), '2026-07-15T10:00:00.000Z');
  assert.equal(zonedToUtc('2026-01-15', '12:00', 'Europe/Berlin').toISOString(), '2026-01-15T11:00:00.000Z');
});

test('deadline yalnızca saat dilimi içeren ISO anlarını kabul eder', () => {
  assert.equal(isValidInstant('2026-08-20T15:00:00.000Z'), true);
  assert.equal(isValidInstant('2026-08-20T18:00:00+03:00'), true);
  assert.equal(isValidInstant('2026-08-20T18:00'), false);
  assert.equal(isValidInstant('2026-08-20'), false);
  assert.equal(isValidInstant('2026-02-30T18:00:00Z'), false);
  assert.equal(isValidInstant('2026-08-20T25:00:00Z'), false);
  assert.equal(isValidInstant('geçersiz'), false);
});
