import { ApiError } from './api.ts';
import type { Card } from './types.ts';

export function conflictingCard(error: unknown): Card | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'stale_write') return null;
  const card = (error.payload as { card?: Card } | undefined)?.card;
  return card && typeof card.id === 'string' && typeof card.updatedAt === 'string' ? card : null;
}

export type CardWriteConflict = {
  local: Card;
  server: Card;
  patch: Record<string, unknown>;
  move?: { day: string; beforeId: string | null; afterId: string | null };
};
