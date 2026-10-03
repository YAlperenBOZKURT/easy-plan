import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const testDataDir = mkdtempSync(join(tmpdir(), 'planner-board-sync-'));
process.env.DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'board-sync-access-secret-at-least-thirty-two-characters';
process.env.JWT_REFRESH_SECRET = 'board-sync-refresh-secret-at-least-thirty-two-characters';

const [{ buildServer }, { createUser, createSession }, { db, openDb, closeDb }, { repo }, { today }] =
  await Promise.all([
    import('../src/index.ts'), import('../src/auth.ts'), import('../src/db.ts'),
    import('../src/repo.ts'), import('../src/time.ts'),
  ]);

const epoch = '1970-01-01T00:00:00.000Z';
type Changes = {
  cards: Array<{ id: string }>;
  deletions: Array<{ entity: string; id: string; deletedAt: string }>;
};

function insertUser(database: DatabaseSync, id: string) {
  database.prepare(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at)
     VALUES (?, ?, 'unused', ?, ?)`,
  ).run(id, `${id}@example.com`, epoch, epoch);
}

test('shared-board lifecycle changes reach all current members without leaking between boards', async (t) => {
  const app = await buildServer({ logger: false, docs: false });
  await app.ready();
  t.after(async () => {
    await app.close();
    closeDb();
    rmSync(testDataDir, { recursive: true, force: true });
  });

  const users = ['owner', 'editor', 'viewer', 'new-member'].map((name) =>
    createUser({ email: `${name}@example.com`, password: 'test passphrase for shared boards' }),
  );
  const [owner, editor, viewer, newcomer] = users;
  assert.ok(owner && editor && viewer && newcomer);
  const tokens = new Map(users.map((user) => [user.id, createSession(app, user.id).accessToken]));
  const headers = (userId: string, boardId?: string) => ({
    authorization: `Bearer ${tokens.get(userId)}`,
    ...(boardId ? { 'x-board-id': boardId } : {}),
  });
  const createBoard = async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/boards', headers: headers(owner.id), payload: { name: 'Sync board' },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().board.id as string;
  };
  const sharedId = await createBoard();
  const otherId = await createBoard();
  const addMember = async (user: typeof owner, role: 'editor' | 'viewer') => {
    const response = await app.inject({
      method: 'POST', url: `/api/v1/boards/${sharedId}/members`, headers: headers(owner.id),
      payload: { email: user.email, role },
    });
    assert.equal(response.statusCode, 201, response.body);
  };
  await addMember(editor, 'editor');
  await addMember(viewer, 'viewer');

  const createCard = async (userId: string, boardId?: string) => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/cards', headers: headers(userId, boardId),
      payload: { day: today('Europe/Istanbul'), title: 'Shared reminder' },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().card as { id: string; updatedAt: string };
  };
  const lifecycle = async (userId: string, cardId: string, action: 'archive' | 'restore' | 'trash' | 'permanent') => {
    const method = action === 'trash' || action === 'permanent' ? 'DELETE' : 'POST';
    const suffix = action === 'trash' ? '' : `/${action}`;
    const response = await app.inject({
      method, url: `/api/v1/cards/${cardId}${suffix}`, headers: headers(userId, sharedId),
    });
    assert.equal(response.statusCode, 200, response.body);
  };
  const changes = async (userId: string, boardId?: string, since = epoch): Promise<Changes> => {
    const response = await app.inject({
      method: 'GET', url: `/api/v1/changes?since=${encodeURIComponent(since)}`,
      headers: headers(userId, boardId),
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };

  await t.test('owner archives; a different editor restores for owner, editor, and viewer', async () => {
    const card = await createCard(owner.id, sharedId);
    await lifecycle(owner.id, card.id, 'archive');
    for (const user of [owner, editor, viewer]) {
      const delta = await changes(user.id, sharedId, card.updatedAt);
      assert.ok(!delta.cards.some((row) => row.id === card.id));
      assert.equal(delta.deletions.filter((row) => row.id === card.id).length, 1);
    }
    const hidden = (await changes(viewer.id, sharedId)).deletions.find((row) => row.id === card.id)!;
    await lifecycle(editor.id, card.id, 'restore');
    for (const user of [owner, editor, viewer]) {
      const delta = await changes(user.id, sharedId, hidden.deletedAt);
      assert.ok(delta.cards.some((row) => row.id === card.id));
      assert.ok(!(await changes(user.id, sharedId)).deletions.some((row) => row.id === card.id));
    }
  });

  await t.test('editor-created cards can be trashed/restored/deleted by another member', async () => {
    const card = await createCard(editor.id, sharedId);
    await lifecycle(owner.id, card.id, 'trash');
    await lifecycle(owner.id, card.id, 'trash'); // Idempotent retries keep one tombstone.
    for (const user of [owner, editor, viewer]) {
      assert.equal((await changes(user.id, sharedId)).deletions.filter((row) => row.id === card.id).length, 1);
    }
    await lifecycle(editor.id, card.id, 'restore');
    assert.ok(!(await changes(owner.id, sharedId)).deletions.some((row) => row.id === card.id));
    await lifecycle(editor.id, card.id, 'trash');
    const trashedAt = (await changes(viewer.id, sharedId)).deletions.find((row) => row.id === card.id)!.deletedAt;
    await lifecycle(owner.id, card.id, 'permanent');
    for (const user of [owner, editor, viewer]) {
      const delta = await changes(user.id, sharedId, trashedAt);
      assert.ok(delta.deletions.some((row) => row.id === card.id));
      assert.ok(!delta.cards.some((row) => row.id === card.id));
    }
  });

  await t.test('personal, shared, and another shared board have independent tombstones; habits stay private', async () => {
    const personal = await createCard(owner.id);
    const personalStore = repo(db(), owner.id);
    personalStore.cards.trash(personal.id);
    const other = await createCard(owner.id, otherId);
    repo(db(), owner.id, otherId).cards.archive(other.id);
    const shared = await createCard(owner.id, sharedId);
    await lifecycle(editor.id, shared.id, 'archive');
    const habit = personalStore.habits.create({ weekdays: [1], reminders: [] });
    personalStore.habits.remove(habit.id);

    assert.deepEqual(
      (await changes(owner.id)).deletions.filter((row) => row.entity === 'card').map((row) => row.id),
      [personal.id],
    );
    assert.deepEqual(
      (await changes(owner.id, otherId)).deletions.filter((row) => row.entity === 'card').map((row) => row.id),
      [other.id],
    );
    for (const user of [owner, editor, viewer]) {
      const delta = await changes(user.id, sharedId);
      assert.ok(delta.deletions.some((row) => row.id === shared.id));
      assert.ok(!delta.deletions.some((row) => row.id === personal.id || row.id === other.id));
      assert.equal(delta.deletions.some((row) => row.id === habit.id), user.id === owner.id);
    }
    assert.equal((await app.inject({
      method: 'POST', url: `/api/v1/cards/${shared.id}/restore`, headers: headers(viewer.id, sharedId),
    })).statusCode, 403);
  });

  await t.test('revoked members lose access; rejoining and new viewers receive existing deletion history', async () => {
    const card = await createCard(owner.id, sharedId);
    const removed = await app.inject({
      method: 'DELETE', url: `/api/v1/boards/${sharedId}/members/${viewer.id}`, headers: headers(owner.id),
    });
    assert.equal(removed.statusCode, 200);
    await lifecycle(editor.id, card.id, 'trash');
    await lifecycle(owner.id, card.id, 'permanent');
    for (const user of [viewer, newcomer]) {
      const response = await app.inject({
        method: 'GET', url: '/api/v1/changes', headers: headers(user.id, sharedId),
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error, 'board_forbidden');
      assert.ok(!(await changes(user.id)).deletions.some((row) => row.id === card.id));
    }
    assert.ok(!repo(db(), viewer.id, sharedId, 'viewer').deletions.since(epoch).some((row) => row.id === card.id));
    await addMember(viewer, 'viewer');
    await addMember(newcomer, 'viewer');
    for (const user of [viewer, newcomer]) {
      assert.ok((await changes(user.id, sharedId, card.updatedAt)).deletions.some((row) => row.id === card.id));
    }
  });

  await t.test('deleting the actor account preserves board history; deleting the board removes its tombstones', async () => {
    const card = await createCard(owner.id, sharedId);
    await lifecycle(editor.id, card.id, 'archive');
    db().prepare('DELETE FROM users WHERE id = ?').run(editor.id);
    for (const user of [owner, viewer, newcomer]) {
      assert.ok((await changes(user.id, sharedId)).deletions.some((row) => row.id === card.id));
    }
    const removed = await app.inject({
      method: 'DELETE', url: `/api/v1/boards/${sharedId}`, headers: headers(owner.id),
    });
    assert.equal(removed.statusCode, 200);
    assert.equal(db().prepare('SELECT 1 FROM deletions WHERE board_id = ?').get(sharedId), undefined);
    assert.ok((await changes(owner.id)).deletions.some((row) => row.entity === 'card'));
  });
});

test('lifecycle and tombstones roll back together if either database write fails', (t) => {
  const database = openDb(':memory:');
  t.after(() => database.close());
  insertUser(database, 'atomic-user');
  const store = repo(database, 'atomic-user');
  const card = store.cards.create({ day: '2026-10-03' });
  database.exec(`CREATE TRIGGER reject_tombstone BEFORE INSERT ON deletions
                 BEGIN SELECT RAISE(ABORT, 'tombstone unavailable'); END`);
  for (const operation of [store.cards.archive, store.cards.trash, store.cards.remove]) {
    assert.throws(() => operation(card.id), /tombstone unavailable/);
    assert.equal(store.cards.get(card.id)?.updated_at, card.updated_at);
    assert.deepEqual(store.deletions.since(epoch), []);
  }
  database.exec('DROP TRIGGER reject_tombstone');
  const trashed = store.cards.trash(card.id)!;
  database.exec(`CREATE TRIGGER reject_restore BEFORE DELETE ON deletions
                 BEGIN SELECT RAISE(ABORT, 'tombstone unavailable'); END`);
  assert.throws(() => store.cards.restore(card.id), /tombstone unavailable/);
  assert.equal(store.cards.getAny(card.id)?.trashed_at, trashed.trashed_at);
  assert.equal(store.cards.get(card.id), undefined);
  assert.equal(store.deletions.since(epoch).length, 1);
});

test('migration repairs legacy shared tombstones and removes stale restored-card deletions', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'planner-board-migration-'));
  const path = join(directory, 'legacy.db');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const legacy = new DatabaseSync(path);
  legacy.exec('PRAGMA foreign_keys = ON');
  legacy.exec('CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrations = new URL('../src/migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql') && name < '015_').sort()) {
    legacy.exec(readFileSync(new URL(name, migrations), 'utf8'));
    legacy.prepare('INSERT INTO _migrations VALUES (?, ?)').run(name, epoch);
  }
  insertUser(legacy, 'owner');
  insertUser(legacy, 'editor');
  legacy.prepare(`INSERT INTO boards VALUES ('shared', 'owner', 'Legacy board', 0, ?, ?)`).run(epoch, epoch);
  for (const [userId, role] of [['owner', 'owner'], ['editor', 'editor']]) {
    legacy.prepare('INSERT INTO board_members VALUES (?, ?, ?, ?, ?)').run('shared', userId!, role!, epoch, epoch);
  }
  // Insert legacy cards without using repo, which now requires the new schema.
  for (const [id, archived, trashed] of [['archived', epoch, null], ['trashed', null, epoch], ['restored', null, null]]) {
    legacy.prepare(
      `INSERT INTO cards (id, user_id, board_id, day, sort_index, created_at, updated_at, archived_at, trashed_at)
       VALUES (?, 'owner', 'shared', '2026-10-03', 1, ?, ?, ?, ?)`,
    ).run(id!, epoch, epoch, archived!, trashed!);
  }
  for (const id of ['archived', 'restored', 'permanent', 'old-personal', 'private-habit']) {
    legacy.prepare('INSERT INTO deletions VALUES (?, ?, ?, ?)')
      .run(id === 'private-habit' ? 'habit' : 'card', id, 'owner', '1999-01-01T00:00:00.000Z');
  }
  legacy.prepare(`INSERT INTO card_activity
    (id, board_id, card_id, actor_user_id, action, created_at)
    VALUES ('delete-log', 'shared', 'permanent', 'editor', 'deleted', ?)`)
    .run(epoch);
  legacy.prepare(`INSERT INTO boards VALUES ('personal', 'owner', 'Personal', 1, ?, ?)`).run(epoch, epoch);
  legacy.prepare(`INSERT INTO board_members VALUES ('personal', 'owner', 'owner', ?, ?)`).run(epoch, epoch);
  legacy.close();

  const migrated = openDb(path);
  try {
    const sharedStore = repo(migrated, 'editor', 'shared', 'editor');
    const afterLegacyCursor = sharedStore.deletions.since('2000-01-01T00:00:00.000Z');
    assert.deepEqual(afterLegacyCursor.map((row) => row.id).sort(), ['archived', 'permanent', 'trashed']);
    assert.equal(migrated.prepare("SELECT 1 FROM deletions WHERE id = 'restored'").get(), undefined);
    const personal = repo(migrated, 'owner').deletions.since(epoch);
    assert.deepEqual(personal.map((row) => row.id).sort(), ['old-personal', 'private-habit']);
    assert.ok(sharedStore.cards.restore('archived'));
    for (const userId of ['owner', 'editor']) {
      const store = repo(migrated, userId, 'shared');
      assert.ok(!store.deletions.since(epoch).some((row) => row.id === 'archived'));
      assert.ok(store.cards.changedSince(epoch).some((row) => row.id === 'archived'));
    }
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    migrated.close();
  }
  // Migration is recorded; reopening must preserve the repair, not re-emit deletions.
  const reopened = openDb(path);
  try {
    assert.equal(reopened.prepare("SELECT 1 FROM deletions WHERE id = 'archived'").get(), undefined);
  } finally {
    reopened.close();
  }
});
