import { describe, expect, it } from 'vitest';
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  hasActiveFilters,
  matchesFilter,
  type CardFilterState,
} from './filters.ts';
import type { Card } from './types.ts';

const sampleCard = (overrides: Partial<Card> = {}): Card => ({
  id: 'c1',
  day: '2026-08-19',
  title: 'Test Kartı',
  note: 'Açıklama',
  startTime: '10:00',
  endTime: '11:00',
  color: 'red',
  done: false,
  sortIndex: 600,
  manualSort: false,
  habitId: null,
  checklist: [],
  priority: 'none',
  deadlineAt: null,
  tags: [],
  reminders: [],
  images: [],
  createdAt: '2026-08-19T08:00:00Z',
  updatedAt: '2026-08-19T08:00:00Z',
  ...overrides,
});

describe('Card Filters Logic', () => {
  it('varsayılan filtrelerde tüm kartlar eşleşir ve aktif filtre sayısı 0 döner', () => {
    const card = sampleCard();
    expect(matchesFilter(card, DEFAULT_FILTERS)).toBe(true);
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it('tamamlanma durumuna göre doğru filtreler', () => {
    const todoCard = sampleCard({ done: false });
    const doneCard = sampleCard({ done: true });

    const todoFilter: CardFilterState = { ...DEFAULT_FILTERS, status: 'todo' };
    const doneFilter: CardFilterState = { ...DEFAULT_FILTERS, status: 'done' };

    expect(matchesFilter(todoCard, todoFilter)).toBe(true);
    expect(matchesFilter(doneCard, todoFilter)).toBe(false);

    expect(matchesFilter(todoCard, doneFilter)).toBe(false);
    expect(matchesFilter(doneCard, doneFilter)).toBe(true);
  });

  it('öncelik değerine göre filtreler', () => {
    const urgentCard = sampleCard({ priority: 'urgent' });
    const lowCard = sampleCard({ priority: 'low' });

    const urgentFilter: CardFilterState = { ...DEFAULT_FILTERS, priority: 'urgent' };
    expect(matchesFilter(urgentCard, urgentFilter)).toBe(true);
    expect(matchesFilter(lowCard, urgentFilter)).toBe(false);
  });

  it('etiketlere göre filtreler (büyük/küçük harf duyarsız)', () => {
    const workCard = sampleCard({ tags: ['İş', 'Acil'] });
    const personalCard = sampleCard({ tags: ['Kişisel'] });

    const tagFilter: CardFilterState = { ...DEFAULT_FILTERS, tags: ['iş'] };
    expect(matchesFilter(workCard, tagFilter)).toBe(true);
    expect(matchesFilter(personalCard, tagFilter)).toBe(false);

    const multiTagFilter: CardFilterState = { ...DEFAULT_FILTERS, tags: ['iş', 'acil'] };
    expect(matchesFilter(workCard, multiTagFilter)).toBe(true);

    const missingTagFilter: CardFilterState = { ...DEFAULT_FILTERS, tags: ['iş', 'proje'] };
    expect(matchesFilter(workCard, missingTagFilter)).toBe(false);
  });

  it('alışkanlık kökenine göre filtreler', () => {
    const habitCard = sampleCard({ habitId: 'h1' });
    const manualCard = sampleCard({ habitId: null });

    const habitFilter: CardFilterState = { ...DEFAULT_FILTERS, habit: 'habit' };
    const manualFilter: CardFilterState = { ...DEFAULT_FILTERS, habit: 'manual' };

    expect(matchesFilter(habitCard, habitFilter)).toBe(true);
    expect(matchesFilter(manualCard, habitFilter)).toBe(false);

    expect(matchesFilter(habitCard, manualFilter)).toBe(false);
    expect(matchesFilter(manualCard, manualFilter)).toBe(true);
  });

  it('son tarihe ve gecikmiş duruma göre filtreler', () => {
    const now = new Date('2026-08-19T12:00:00Z');
    const overdueCard = sampleCard({
      deadlineAt: '2026-08-19T10:00:00Z',
      done: false,
    });
    const upcomingCard = sampleCard({
      deadlineAt: '2026-08-19T15:00:00Z',
      done: false,
    });
    const completedOverdueCard = sampleCard({
      deadlineAt: '2026-08-19T10:00:00Z',
      done: true,
    });
    const noDeadlineCard = sampleCard({ deadlineAt: null });

    const hasDeadlineFilter: CardFilterState = { ...DEFAULT_FILTERS, deadline: 'has_deadline' };
    expect(matchesFilter(overdueCard, hasDeadlineFilter)).toBe(true);
    expect(matchesFilter(upcomingCard, hasDeadlineFilter)).toBe(true);
    expect(matchesFilter(noDeadlineCard, hasDeadlineFilter)).toBe(false);

    const overdueFilter: CardFilterState = { ...DEFAULT_FILTERS, deadline: 'overdue' };
    expect(matchesFilter(overdueCard, overdueFilter, now)).toBe(true);
    expect(matchesFilter(upcomingCard, overdueFilter, now)).toBe(false);
    expect(matchesFilter(completedOverdueCard, overdueFilter, now)).toBe(false);
    expect(matchesFilter(noDeadlineCard, overdueFilter, now)).toBe(false);
  });

  it('renk seçimine göre filtreler', () => {
    const blueCard = sampleCard({ color: 'blue' });
    const redCard = sampleCard({ color: 'red' });

    const blueFilter: CardFilterState = { ...DEFAULT_FILTERS, color: 'blue' };
    expect(matchesFilter(blueCard, blueFilter)).toBe(true);
    expect(matchesFilter(redCard, blueFilter)).toBe(false);
  });

  it('aktif filtre sayısını doğru hesaplar', () => {
    const filters: CardFilterState = {
      status: 'todo',
      priority: 'high',
      tags: ['iş', 'acil'],
      habit: 'manual',
      deadline: 'overdue',
      color: 'green',
    };
    expect(countActiveFilters(filters)).toBe(7); // status(1) + priority(1) + tags(2) + habit(1) + deadline(1) + color(1)
    expect(hasActiveFilters(filters)).toBe(true);
  });
});
