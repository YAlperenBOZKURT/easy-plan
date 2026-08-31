import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { boardDto, boardMemberDto } from '../dto.ts';
import { db } from '../db.ts';
import { newId, nowIso } from '../ids.ts';
import { boardAccess, createPersonalBoard, requireBoardOwner } from '../boards.ts';
import type { BoardMemberRow, BoardRole, BoardRow, CardImageRow, UserRow } from '../types.ts';
import { removeImageFiles } from '../storage.ts';

const SHARED_ROLES = new Set<BoardRole>(['editor', 'viewer']);

function memberRows(boardId: string) {
  return db()
    .prepare(
      `SELECT bm.*, u.email, u.name
       FROM board_members bm JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = ? ORDER BY CASE bm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
       lower(u.name), lower(u.email)`,
    )
    .all(boardId) as unknown as Array<BoardMemberRow & Pick<UserRow, 'email' | 'name'>>;
}

export async function boardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/boards', async (req) => {
    createPersonalBoard(db(), req.user!.id);
    const rows = db()
      .prepare(
        `SELECT b.*, bm.role,
                (SELECT COUNT(*) FROM board_members all_members WHERE all_members.board_id = b.id) AS member_count
         FROM boards b JOIN board_members bm ON bm.board_id = b.id
         WHERE bm.user_id = ? ORDER BY b.is_personal DESC, lower(b.name), b.created_at`,
      )
      .all(req.user!.id) as unknown as Array<BoardRow & { role: BoardRole; member_count: number }>;
    return { boards: rows.map(boardDto) };
  });

  app.post<{ Body: { name?: string } }>('/boards', async (req, reply) => {
    const name = req.body?.name?.trim().slice(0, 80);
    if (!name) return reply.code(400).send({ error: 'name_required' });
    const id = newId();
    const at = nowIso();
    db().exec('BEGIN');
    try {
      db().prepare(
        `INSERT INTO boards (id, owner_id, name, is_personal, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      ).run(id, req.user!.id, name, at, at);
      db().prepare(
        `INSERT INTO board_members (board_id, user_id, role, created_at, updated_at)
         VALUES (?, ?, 'owner', ?, ?)`,
      ).run(id, req.user!.id, at, at);
      db().exec('COMMIT');
    } catch (error) {
      db().exec('ROLLBACK');
      throw error;
    }
    const row = db().prepare(
      `SELECT b.*, 'owner' AS role, 1 AS member_count FROM boards b WHERE id = ?`,
    ).get(id) as unknown as BoardRow & { role: BoardRole; member_count: number };
    return reply.code(201).send({ board: boardDto(row) });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/boards/:id',
    async (req, reply) => {
      const access = boardAccess(db(), req.user!.id, req.params.id);
      requireBoardOwner(access.membership.role);
      const name = req.body?.name?.trim().slice(0, 80);
      if (!name) return reply.code(400).send({ error: 'name_required' });
      db()
        .prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?')
        .run(name, nowIso(), access.board.id);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/boards/:id', async (req, reply) => {
    const access = boardAccess(db(), req.user!.id, req.params.id);
    requireBoardOwner(access.membership.role);
    if (access.board.is_personal) return reply.code(400).send({ error: 'personal_board_required' });
    const images = db()
      .prepare(
        `SELECT i.* FROM card_images i JOIN cards c ON c.id = i.card_id WHERE c.board_id = ?`,
      )
      .all(access.board.id) as unknown as CardImageRow[];
    db().prepare('DELETE FROM boards WHERE id = ?').run(access.board.id);
    const orphaned = images.filter(
      (image) =>
        !db()
          .prepare(
            `SELECT 1 FROM card_images WHERE file = ?
             UNION ALL SELECT 1 FROM card_template_images WHERE file = ? LIMIT 1`,
          )
          .get(image.file, image.file),
    );
    await removeImageFiles(orphaned);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/boards/:id/members', async (req) => {
    boardAccess(db(), req.user!.id, req.params.id);
    return { members: memberRows(req.params.id).map(boardMemberDto) };
  });

  app.post<{ Params: { id: string }; Body: { email?: string; role?: BoardRole } }>(
    '/boards/:id/members',
    async (req, reply) => {
      const access = boardAccess(db(), req.user!.id, req.params.id);
      requireBoardOwner(access.membership.role);
      const email = req.body?.email?.trim();
      const role = req.body?.role;
      if (!email || !role || !SHARED_ROLES.has(role)) {
        return reply.code(400).send({ error: 'invalid_member' });
      }
      const user = db()
        .prepare('SELECT * FROM users WHERE email = ? AND active = 1')
        .get(email) as UserRow | undefined;
      if (!user) return reply.code(404).send({ error: 'user_not_found' });
      if (user.id === access.board.owner_id) {
        return reply.code(409).send({ error: 'owner_already_member' });
      }
      const at = nowIso();
      db().prepare(
        `INSERT INTO board_members (board_id, user_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
      ).run(access.board.id, user.id, role, at, at);
      return reply
        .code(201)
        .send({ members: memberRows(access.board.id).map(boardMemberDto) });
    },
  );

  app.patch<{ Params: { id: string; userId: string }; Body: { role?: BoardRole } }>(
    '/boards/:id/members/:userId',
    async (req, reply) => {
      const access = boardAccess(db(), req.user!.id, req.params.id);
      requireBoardOwner(access.membership.role);
      const role = req.body?.role;
      if (!role || !SHARED_ROLES.has(role) || req.params.userId === access.board.owner_id) {
        return reply.code(400).send({ error: 'invalid_member' });
      }
      const result = db().prepare(
        'UPDATE board_members SET role = ?, updated_at = ? WHERE board_id = ? AND user_id = ?',
      ).run(role, nowIso(), access.board.id, req.params.userId);
      if (result.changes === 0) return reply.code(404).send({ error: 'member_not_found' });
      return { members: memberRows(access.board.id).map(boardMemberDto) };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/boards/:id/members/:userId',
    async (req, reply) => {
      const access = boardAccess(db(), req.user!.id, req.params.id);
      const removingSelf = req.params.userId === req.user!.id;
      if (!removingSelf) requireBoardOwner(access.membership.role);
      if (req.params.userId === access.board.owner_id) {
        return reply.code(400).send({ error: 'owner_cannot_leave' });
      }
      db().prepare(
        `DELETE FROM card_reminders
         WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE board_id = ?)`,
      ).run(req.params.userId, access.board.id);
      const result = db().prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?')
        .run(access.board.id, req.params.userId);
      if (result.changes === 0) return reply.code(404).send({ error: 'member_not_found' });
      return { ok: true };
    },
  );
}
