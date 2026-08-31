import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { exportCards, formatFromFile, importCards, type TransferFormat } from '../src/data-transfer.ts';
import type { CardDto } from '../src/dto.ts';

const sample: CardDto = {
  id: 'card-1',
  boardId: 'board-1',
  day: '2026-08-28',
  title: 'Plan, toplantı',
  note: 'İlk satır\nİkinci satır',
  startTime: '09:30',
  endTime: '10:15',
  color: 'teal',
  done: false,
  sortIndex: 1,
  manualSort: false,
  habitId: null,
  templateId: null,
  checklist: [{ id: 'item-1', text: 'Sunumu aç', done: true }],
  priority: 'high',
  deadlineAt: '2026-08-28T12:00:00.000Z',
  tags: ['İş', 'Müşteri'],
  archivedAt: null,
  trashedAt: null,
  reminders: [60],
  images: [],
  createdAt: '2026-08-28T06:00:00.000Z',
  updatedAt: '2026-08-28T06:00:00.000Z',
};

for (const format of ['json', 'csv', 'ics'] as TransferFormat[]) {
  test(`${format.toUpperCase()} kart aktarımı temel alanları kayıpsız taşır`, () => {
    const output = exportCards([sample], format, '2026-08-28T07:00:00.000Z');
    const imported = importCards(Buffer.from(output), format);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.cards.length, 1);
    const card = imported.cards[0]!;
    assert.equal(card.day, sample.day);
    assert.equal(card.title, sample.title);
    assert.equal(card.note, sample.note);
    assert.equal(card.startTime, sample.startTime);
    assert.equal(card.endTime, sample.endTime);
    assert.equal(card.color, sample.color);
    assert.equal(card.priority, sample.priority);
    assert.equal(card.deadlineAt, sample.deadlineAt);
    assert.deepEqual(card.tags, sample.tags);
    assert.deepEqual(card.reminders, sample.reminders);
    assert.equal(card.checklist[0]?.text, sample.checklist[0]?.text);
  });
}

test('aktarım dosya biçimi uzantıdan veya içerik türünden güvenle belirlenir', () => {
  assert.equal(formatFromFile('plan.JSON', 'application/octet-stream'), 'json');
  assert.equal(formatFromFile('plan', 'text/calendar'), 'ics');
  assert.equal(formatFromFile('plan.exe', 'application/octet-stream'), undefined);
});

test('bozuk kart satırları içe aktarılmadan raporlanır', () => {
  const result = importCards(Buffer.from(JSON.stringify({ cards: [{ day: 'not-a-day' }] })), 'json');
  assert.equal(result.cards.length, 0);
  assert.deepEqual(result.errors, [{ row: 1, error: 'invalid_card' }]);
});

test('CSV hücreleri formül enjeksiyonundan korunur ve tekrar içe alınınca özgün kalır', () => {
  const output = exportCards([{ ...sample, title: '=HYPERLINK("bad")' }], 'csv');
  assert.match(output, /'=HYPERLINK/);
  assert.equal(importCards(Buffer.from(output), 'csv').cards[0]?.title, '=HYPERLINK("bad")');
});
