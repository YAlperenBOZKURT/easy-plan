import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import type { MailInput } from '../src/mailer.ts';
import type { PushPayload } from '../src/push.ts';
import type { ReminderRow, UserRow } from '../src/types.ts';

const dataDir = mkdtempSync(resolve(tmpdir(), 'planner-background-jobs-'));
process.env.DATA_DIR = dataDir;
process.env.SMTP_HOST = '';
process.env.VAPID_PUBLIC_KEY = '';
const { config } = await import('../src/config.ts');
const { openDb } = await import('../src/db.ts');
const { repo } = await import('../src/repo.ts');
const { applyReminders } = await import('../src/reminders.ts');
const { processReminders, startScheduler } = await import('../src/scheduler.ts');
const { purgeExpiredTrash, purgeOldHabitCards, runMaintenance } = await import('../src/maintenance.ts');
after(() => rmSync(dataDir, { recursive: true, force: true }));

const now = new Date('2026-10-03T09:00:00.000Z');
const dueAt = '2026-10-03T08:59:00.000Z';

function fixture(t: TestContext) {
  const database = openDb(':memory:');
  t.after(() => database.close());
  function user(id: string, timezone = 'Europe/Istanbul') {
    database.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, timezone, daily_summary,
        active, created_at, updated_at) VALUES (?, ?, '', 'x', 'user', ?, 0, 1, ?, ?)`,
    ).run(id, `${id}@example.com`, timezone, now.toISOString(), now.toISOString());
    return database.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
  }
  const owner = user('owner');
  const editor = user('editor', 'America/New_York');
  const viewer = user('viewer');
  database.prepare(
    `INSERT INTO boards (id, owner_id, name, is_personal, created_at, updated_at)
     VALUES ('shared', ?, 'Team', 0, ?, ?)`,
  ).run(owner.id, now.toISOString(), now.toISOString());
  for (const [member, role] of [[owner, 'owner'], [editor, 'editor'], [viewer, 'viewer']] as const) {
    database.prepare(
      'INSERT INTO board_members (board_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('shared', member.id, role, now.toISOString(), now.toISOString());
  }
  const personal = repo(database, owner.id);
  const shared = repo(database, owner.id, 'shared');
  const editorStore = repo(database, editor.id, 'shared', 'editor');
  function reminder(store: ReturnType<typeof repo>, title: string, fireAt = dueAt) {
    const card = store.cards.create({ day: '2026-10-03', startTime: '13:00', title });
    store.reminders.replace(card.id, [{ offset: 60, fireAt }]);
    return card;
  }
  function subscription(userId: string) {
    database.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, 'key', 'auth', 'test', ?, ?)`,
    ).run(userId, userId, `https://push.example/${userId}`, dueAt, dueAt);
  }
  function row(cardId: string) {
    return database.prepare('SELECT * FROM card_reminders WHERE card_id = ?').get(cardId) as unknown as ReminderRow;
  }
  return { database, user, owner, editor, viewer, personal, shared, editorStore, reminder, subscription, row };
}

test('personal and shared reminders target each card creator, not editors or viewers', async (t) => {
  const f = fixture(t);
  const personal = f.reminder(f.personal, 'Personal');
  const shared = f.reminder(f.shared, 'Owner card');
  const editor = f.reminder(f.editorStore, 'Editor card');
  f.shared.images.add({ cardId: shared.id, file: 'owner/image.webp', thumb: 'owner/thumb.webp', bytes: 1, width: 1, height: 1 });
  const mails: MailInput[] = [];
  const pushes: Array<{ userId: string; payload: PushPayload }> = [];
  const result = await processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: true,
    sendMail: async (mail) => { mails.push(mail); return { sent: true }; },
    sendPush: async (_db, userId, payload) => {
      pushes.push({ userId, payload });
      return { sent: 1, failed: 0, removed: 0, subscriptions: 1 };
    },
  });
  assert.deepEqual(result, { sent: 3, pushed: 3, skipped: 0, missed: 0, due: 3 });
  assert.deepEqual(mails.map((mail) => [mail.cardId, mail.to]), [
    [personal.id, f.owner.email], [shared.id, f.owner.email], [editor.id, f.editor.email],
  ]);
  assert.equal(mails[1]!.attachments?.[0]?.path, resolve(config.uploadsDir, 'owner/thumb.webp'));
  assert.deepEqual(pushes.map((push) => push.userId), ['owner', 'owner', 'editor']);
  for (const [index, card] of [personal, shared, editor].entries()) {
    const url = new URL(pushes[index]!.payload.url, 'https://planner.example');
    assert.equal(url.searchParams.get('board'), card.board_id);
    assert.equal(url.searchParams.get('card'), card.id);
    assert.equal(f.row(card.id).status, 'sent');
  }
  assert.equal((await processReminders(f.database, now, { mailEnabled: true, pushEnabled: false })).due, 0);
});

test('another member editing a card retains its creator recipient and timezone', (t) => {
  const f = fixture(t);
  const card = f.shared.cards.create({ day: '2026-10-03', startTime: '15:00' });
  applyReminders(f.editorStore, card, f.editor, [60]);
  assert.equal(f.row(card.id).user_id, f.owner.id);
  assert.equal(f.row(card.id).fire_at, '2026-10-03T11:00:00.000Z');
  const changed = f.editorStore.cards.update(card.id, { day: '2026-10-04', startTime: '16:00' })!;
  applyReminders(f.editorStore, changed, f.editor, [60]);
  assert.equal(f.row(card.id).fire_at, '2026-10-04T12:00:00.000Z');
  const editorCard = f.editorStore.cards.create({ day: '2026-10-03', startTime: '15:00' });
  applyReminders(f.shared, editorCard, f.owner, [60]);
  assert.equal(f.row(editorCard.id).user_id, f.editor.id);
  assert.equal(f.row(editorCard.id).fire_at, '2026-10-03T18:00:00.000Z');
});

test('inactive, removed, hidden, completed and wrong-recipient reminders never deliver', async (t) => {
  const f = fixture(t);
  const done = f.reminder(f.shared, 'Done');
  f.shared.cards.update(done.id, { done: true });
  const archived = f.reminder(f.shared, 'Archived');
  f.shared.cards.archive(archived.id);
  const trashed = f.reminder(f.shared, 'Trashed');
  f.shared.cards.trash(trashed.id);
  const removed = f.reminder(f.editorStore, 'Removed creator');
  f.database.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run('shared', f.editor.id);
  const wrong = f.reminder(f.shared, 'Wrong recipient');
  f.database.prepare('UPDATE card_reminders SET user_id = ? WHERE card_id = ?').run(f.viewer.id, wrong.id);
  const inactiveUser = f.user('inactive');
  const inactive = f.reminder(repo(f.database, inactiveUser.id), 'Inactive');
  f.database.prepare('UPDATE users SET active = 0 WHERE id = ?').run(inactiveUser.id);
  let deliveries = 0;
  const result = await processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: true,
    sendMail: async () => { deliveries++; return { sent: true }; },
    sendPush: async () => { deliveries++; return { sent: 1, failed: 0, removed: 0, subscriptions: 1 }; },
  });
  // Archive/trash may cancel pending reminders immediately; surviving stale rows must be skipped.
  assert.equal(deliveries, 0);
  assert.equal(result.skipped, result.due);
  for (const card of [done, archived, trashed, removed, wrong, inactive]) {
    if (f.row(card.id)) assert.equal(f.row(card.id).status, 'skipped');
  }
});

test('disabled delivery leaves reminders pending; stale reminders are marked missed', async (t) => {
  const f = fixture(t);
  const card = f.reminder(f.shared, 'Old', '2026-10-03T07:59:00.000Z');
  assert.equal((await processReminders(f.database, now, { mailEnabled: false, pushEnabled: false })).disabled, true);
  assert.equal(f.row(card.id).sent_at, null);
  const result = await processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: false,
    sendMail: async () => { throw new Error('must not send missed reminder'); },
  });
  assert.equal(result.missed, 1);
  assert.equal(f.row(card.id).status, 'missed');
});

test('push-only recipients are not blocked by 200 older unsubscribed reminders', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 201; i++) f.reminder(f.shared, `Unsubscribed ${i}`, '2026-10-03T08:58:00.000Z');
  const subscribed = f.reminder(f.editorStore, 'Subscribed');
  f.subscription(f.editor.id);
  const result = await processReminders(f.database, now, {
    mailEnabled: false, pushEnabled: true,
    sendPush: async (_db, userId) => {
      assert.equal(userId, f.editor.id);
      return { sent: 1, failed: 0, removed: 0, subscriptions: 1 };
    },
  });
  assert.equal(result.due, 1);
  assert.equal(result.pushed, 1);
  assert.equal(f.row(subscribed.id).status, 'sent');
  assert.equal(f.shared.reminders.pendingCount(), 201);
});

test('successful push survives mail failure, both-channel failure is recorded once', async (t) => {
  const f = fixture(t);
  const success = f.reminder(f.shared, 'Success');
  const failure = f.reminder(f.editorStore, 'Failure');
  const result = await processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: true,
    sendMail: async () => ({ sent: false, error: 'test failure' }),
    sendPush: async (_db, userId) => ({ sent: userId === f.owner.id ? 1 : 0, failed: 1, removed: 0, subscriptions: 1 }),
  });
  assert.equal(result.pushed, 1);
  assert.equal(f.row(success.id).status, 'sent');
  assert.equal(f.row(failure.id).status, 'error');
});

test('concurrent reminder runs share one delivery and unlock after failure', async (t) => {
  const f = fixture(t);
  const card = f.reminder(f.shared, 'Concurrent');
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const delivery = {
    mailEnabled: true, pushEnabled: false,
    sendMail: async () => { calls++; await gate; return { sent: true }; },
  };
  const first = processReminders(f.database, now, delivery);
  const second = processReminders(f.database, now, delivery);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(f.row(card.id).status, 'sent');
  const retry = f.reminder(f.editorStore, 'Retry after exception');
  await assert.rejects(processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: false, sendMail: async () => { throw new Error('transport crashed'); },
  }), /transport crashed/);
  await processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: false, sendMail: async () => ({ sent: true }),
  });
  assert.equal(f.row(retry.id).status, 'sent');
});

test('membership revocation during mail delivery prevents second-channel delivery', async (t) => {
  const f = fixture(t);
  const card = f.reminder(f.editorStore, 'Revocation');
  await processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: true,
    sendMail: async () => {
      f.database.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run('shared', f.editor.id);
      return { sent: true };
    },
    sendPush: async () => { throw new Error('must not send after revocation'); },
  });
  assert.equal(f.row(card.id).status, 'sent');
});

test('rescheduling during delivery preserves the new pending time and avoids stale push', async (t) => {
  const f = fixture(t);
  const card = f.reminder(f.shared, 'Reschedule');
  await processReminders(f.database, now, {
    mailEnabled: true, pushEnabled: true,
    sendMail: async () => {
      f.shared.reminders.replace(card.id, [{ offset: 60, fireAt: '2026-10-04T09:00:00.000Z' }]);
      return { sent: true };
    },
    sendPush: async () => { throw new Error('must not send stale reminder'); },
  });
  assert.equal(f.row(card.id).fire_at, '2026-10-04T09:00:00.000Z');
  assert.equal(f.row(card.id).sent_at, null);
});

test('maintenance purges personal/shared trash even for inactive or departed creators', async (t) => {
  const f = fixture(t);
  const old = new Date(now.getTime() - (config.trashRetentionDays + 1) * 86_400_000).toISOString();
  const doomed = [f.reminder(f.personal, 'Personal'), f.reminder(f.shared, 'Owner'), f.reminder(f.editorStore, 'Editor')];
  for (const card of doomed) f.database.prepare('UPDATE cards SET trashed_at = ? WHERE id = ?').run(old, card.id);
  const recent = f.reminder(f.shared, 'Recent');
  f.shared.cards.trash(recent.id);
  const archived = f.reminder(f.shared, 'Archive');
  f.shared.cards.archive(archived.id);
  const habit = f.editorStore.habits.create({ title: 'Inactive habit', weekdays: [1], reminders: [] });
  const oldHabitCard = f.editorStore.cards.create({ day: '2024-01-01', habitId: habit.id });
  f.database.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run('shared', f.editor.id);
  f.database.prepare('UPDATE users SET active = 0 WHERE id = ?').run(f.editor.id);
  const result = await runMaintenance(f.database, now);
  assert.equal(result.purgedTrash, 3);
  assert.equal(result.purged, 1);
  assert.equal(result.created, 0, 'inactive accounts do not generate new habit cards');
  assert.equal(result.users, 2);
  assert.equal(f.editorStore.cards.getAny(oldHabitCard.id), undefined);
  for (const card of doomed) {
    assert.equal(f.database.prepare('SELECT id FROM cards WHERE id = ?').get(card.id), undefined);
    assert.equal((f.database.prepare('SELECT board_id FROM deletions WHERE id = ?').get(card.id) as { board_id: string }).board_id, card.board_id);
  }
  assert.ok(f.shared.cards.getAny(recent.id));
  assert.ok(f.shared.cards.getAny(archived.id));
  assert.equal((await runMaintenance(f.database, now)).purgedTrash, 0);
});

test('old habit cards are cleaned in their actual board, leaving manual/hidden cards', async (t) => {
  const f = fixture(t);
  const habit = f.personal.habits.create({ title: 'Habit', weekdays: [], reminders: [] });
  const personal = f.personal.cards.create({ day: '2024-01-01', habitId: habit.id });
  const shared = f.shared.cards.create({ day: '2024-01-01', habitId: habit.id });
  const manual = f.shared.cards.create({ day: '2024-01-01' });
  const archived = f.shared.cards.create({ day: '2024-01-01', habitId: habit.id });
  f.shared.cards.archive(archived.id);
  const recent = f.shared.cards.create({ day: '2026-10-03', habitId: habit.id });
  assert.equal(await purgeOldHabitCards(f.database, f.owner, now), 2);
  assert.equal(f.personal.cards.getAny(personal.id), undefined);
  assert.equal(f.shared.cards.getAny(shared.id), undefined);
  for (const card of [manual, archived, recent]) assert.ok(f.shared.cards.getAny(card.id));
});

test('cleanup only counts actual deletion and preserves ignored-delete records', async (t) => {
  const f = fixture(t);
  const card = f.reminder(f.shared, 'Blocked delete');
  f.database.prepare('UPDATE cards SET trashed_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', card.id);
  f.database.exec(`CREATE TRIGGER block_delete BEFORE DELETE ON cards BEGIN SELECT RAISE(IGNORE); END`);
  assert.equal(await purgeExpiredTrash(f.database, f.owner, now), 0);
  assert.ok(f.shared.cards.getAny(card.id));
  assert.equal(f.database.prepare('SELECT id FROM deletions WHERE id = ?').get(card.id), undefined);
  f.database.exec('DROP TRIGGER block_delete');
  assert.equal(await purgeExpiredTrash(f.database, f.owner, now), 1);
  assert.equal(await purgeExpiredTrash(f.database, f.owner, now), 0);
});

test('trash cleanup deletes orphan files but protects another member template and card', async (t) => {
  const f = fixture(t);
  const files = ['orphan', 'template', 'card'].map((name) => {
    const file = `${name}.webp`;
    const thumb = `${name}-thumb.webp`;
    mkdirSync(config.uploadsDir, { recursive: true });
    writeFileSync(resolve(config.uploadsDir, file), 'fixture');
    writeFileSync(resolve(config.uploadsDir, thumb), 'fixture');
    return { file, thumb, bytes: 7, width: 1, height: 1, position: 0 };
  });
  const doomed = f.reminder(f.shared, 'Trash with images');
  const images = f.shared.images.cloneForCard(doomed.id, files);
  repo(f.database, f.editor.id).templates.create({ name: 'Other member template', images: [images[1]!] });
  const survivor = f.reminder(f.editorStore, 'Surviving card');
  f.editorStore.images.cloneForCard(survivor.id, [files[2]!]);
  f.database.prepare('UPDATE cards SET trashed_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', doomed.id);
  assert.equal(await purgeExpiredTrash(f.database, f.owner, now), 1);
  for (const [index, image] of files.entries()) {
    assert.equal(existsSync(resolve(config.uploadsDir, image.file)), index !== 0);
    assert.equal(existsSync(resolve(config.uploadsDir, image.thumb)), index !== 0);
  }
});

test('scheduler waits for each tick before scheduling again and respects stop', async (t) => {
  const f = fixture(t);
  let callbacks: Array<() => void> = [];
  const timers: Array<{ cleared: boolean }> = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
    assert.equal(delay, 60_000);
    callbacks.push(callback);
    const timer = { cleared: false, unref() { return this; } };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer: { cleared: boolean }) => { timer.cleared = true; });
  let completed = 0;
  let errors = 0;
  const stop = startScheduler(f.database, {
    debug: () => { completed++; }, error: () => { errors++; },
  });
  t.after(stop);
  assert.equal(callbacks.length, 0, 'no timer while the initial tick is running');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, 1);
  assert.equal(callbacks.length, 1);
  const next = callbacks.shift()!;
  next();
  assert.equal(callbacks.length, 0, 'no timer while the next tick is running');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(completed, 2);
  assert.equal(errors, 0);
  callbacks.shift()!();
  // The next tick reaches this synchronous database failure after awaiting deliveries.
  f.database.exec('DROP TABLE meta');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(errors, 1);
  assert.equal(callbacks.length, 1, 'a failed tick still schedules its successor');
  stop();
  assert.equal(timers[2]!.cleared, true);
  callbacks = [];
  const stopImmediately = startScheduler(f.database, { debug: () => {}, error: () => {} });
  stopImmediately();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(callbacks.length, 0, 'stopping an in-flight tick prevents rescheduling');
});
