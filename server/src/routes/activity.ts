import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { requestBoardAccess } from '../boards.ts';
import { db } from '../db.ts';
import { cardActivityDto } from '../dto.ts';
import type { CardActivityRow, UserRow } from '../types.ts';

type ActivityWithActor = CardActivityRow & Pick<UserRow, 'name' | 'email'>;

function readLimit(value: string | undefined): number | undefined {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) return undefined;
  return parsed;
}

export async function activityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get<{ Querystring: { limit?: string; before?: string; cardId?: string } }>(
    '/activity',
    async (req, reply) => {
      const limit = readLimit(req.query.limit);
      if (!limit) return reply.code(400).send({ error: 'invalid_limit' });
      const before = req.query.before;
      if (before && Number.isNaN(Date.parse(before))) {
        return reply.code(400).send({ error: 'invalid_before' });
      }
      const access = requestBoardAccess(db(), req);
      const rows = db()
        .prepare(
          `SELECT a.*, COALESCE(u.name, '') AS name, COALESCE(u.email, '') AS email
           FROM card_activity a LEFT JOIN users u ON u.id = a.actor_user_id
           WHERE a.board_id = ?
             AND (? IS NULL OR a.created_at < ?)
             AND (? IS NULL OR a.card_id = ?)
           ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
        )
        .all(
          access.board.id,
          before ?? null,
          before ?? null,
          req.query.cardId ?? null,
          req.query.cardId ?? null,
          limit + 1,
        ) as unknown as ActivityWithActor[];
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        activities: page.map(cardActivityDto),
        nextCursor: hasMore ? page.at(-1)?.created_at ?? null : null,
      };
    },
  );
}
