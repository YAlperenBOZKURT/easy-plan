import type { Card, CardPriority } from './types.ts';
import { tagKey } from './tags.ts';

export type FilterStatus = 'all' | 'todo' | 'done';
export type FilterPriority = 'all' | CardPriority;
export type FilterHabit = 'all' | 'habit' | 'manual';
export type FilterDeadline = 'all' | 'has_deadline' | 'overdue';

export interface CardFilterState {
  status: FilterStatus;
  priority: FilterPriority;
  tags: string[];
  habit: FilterHabit;
  deadline: FilterDeadline;
  color: string;
}

export const DEFAULT_FILTERS: CardFilterState = {
  status: 'all',
  priority: 'all',
  tags: [],
  habit: 'all',
  deadline: 'all',
  color: 'all',
};

export function countActiveFilters(filters: CardFilterState): number {
  let count = 0;
  if (filters.status !== 'all') count++;
  if (filters.priority !== 'all') count++;
  if (filters.tags.length > 0) count += filters.tags.length;
  if (filters.habit !== 'all') count++;
  if (filters.deadline !== 'all') count++;
  if (filters.color !== 'all') count++;
  return count;
}

export function hasActiveFilters(filters: CardFilterState): boolean {
  return countActiveFilters(filters) > 0;
}

export function matchesFilter(
  card: Card,
  filters: CardFilterState,
  now = new Date(),
): boolean {
  if (filters.status === 'todo' && card.done) return false;
  if (filters.status === 'done' && !card.done) return false;

  if (filters.priority !== 'all' && card.priority !== filters.priority) return false;

  if (filters.tags.length > 0) {
    const cardTagKeys = new Set(card.tags.map(tagKey));
    const matchesAll = filters.tags.every((tag) => cardTagKeys.has(tagKey(tag)));
    if (!matchesAll) return false;
  }

  if (filters.habit === 'habit' && !card.habitId) return false;
  if (filters.habit === 'manual' && card.habitId) return false;

  if (filters.deadline === 'has_deadline' && !card.deadlineAt) return false;
  if (filters.deadline === 'overdue') {
    if (!card.deadlineAt || card.done) return false;
    const deadlineTime = new Date(card.deadlineAt).getTime();
    if (deadlineTime >= now.getTime()) return false;
  }

  if (filters.color !== 'all' && card.color !== filters.color) return false;

  return true;
}
