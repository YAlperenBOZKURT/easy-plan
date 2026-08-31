import type { FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { newId, nowIso } from './ids.ts';
import type { BoardMemberRow, BoardRole, BoardRow } from './types.ts';

export class BoardAccessError extends Error {
  statusCode = 403;
  code = 'board_forbidden';

  constructor() {
    super('board_forbidden');
  }
}

export function createPersonalBoard(database: Db, userId: string): BoardRow {
  const existing = database
    .prepare('SELECT * FROM boards WHERE owner_id = ? AND is_personal = 1')
    .get(userId) as BoardRow | undefined;
  if (existing) return existing;

  const id = newId();
  const at = nowIso();
  database
    .prepare(
      `INSERT INTO boards (id, owner_id, name, is_personal, created_at, updated_at)
       VALUES (?, ?, 'Kişisel', 1, ?, ?)`,
    )
    .run(id, userId, at, at);
  database
    .prepare(
      `INSERT INTO board_members (board_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, ?)`,
    )
    .run(id, userId, at, at);
  return database.prepare('SELECT * FROM boards WHERE id = ?').get(id) as unknown as BoardRow;
}

export function boardAccess(
  database: Db,
  userId: string,
  requestedId?: string,
): { board: BoardRow; membership: BoardMemberRow } {
  const board = requestedId
    ? (database.prepare('SELECT * FROM boards WHERE id = ?').get(requestedId) as BoardRow | undefined)
    : createPersonalBoard(database, userId);
  if (!board) throw new BoardAccessError();
  const membership = database
    .prepare('SELECT * FROM board_members WHERE board_id = ? AND user_id = ?')
    .get(board.id, userId) as BoardMemberRow | undefined;
  if (!membership) throw new BoardAccessError();
  return { board, membership };
}

export function requestBoardAccess(database: Db, req: FastifyRequest) {
  const raw = req.headers['x-board-id'];
  const requestedId = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  return boardAccess(database, req.user!.id, requestedId);
}

export const canEditBoard = (role: BoardRole) => role === 'owner' || role === 'editor';

export function requireBoardEditor(role: BoardRole) {
  if (!canEditBoard(role)) throw new BoardAccessError();
}

export function requireBoardOwner(role: BoardRole) {
  if (role !== 'owner') throw new BoardAccessError();
}
