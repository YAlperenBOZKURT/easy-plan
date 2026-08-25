import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlannerCollectionView from './PlannerCollectionView.tsx';
import type { Card } from '../lib/types.ts';

const card = (overrides: Partial<Card> = {}): Card => ({
  id: 'card-1',
  day: '2026-08-21',
  title: 'Planı tamamla',
  note: '',
  startTime: '10:00',
  endTime: null,
  color: 'blue',
  done: false,
  sortIndex: 1,
  manualSort: false,
  habitId: null,
  checklist: [],
  priority: 'none',
  deadlineAt: null,
  tags: [],
  reminders: [],
  images: [],
  createdAt: '2026-08-21T08:00:00Z',
  updatedAt: '2026-08-21T08:00:00Z',
  ...overrides,
});

describe('PlannerCollectionView', () => {
  it('ay görünümünde kartı açar ve güne kart ekler', () => {
    const onAdd = vi.fn();
    const onInspect = vi.fn();
    render(
      <PlannerCollectionView
        view="month"
        anchor="2026-08-21"
        days={['2026-08-21']}
        cards={[card()]}
        today="2026-08-21"
        onAdd={onAdd}
        onInspect={onInspect}
        onToggleDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Planı tamamla' }));
    fireEvent.click(screen.getByRole('button', { name: '21 Ağu için kart ekle' }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ id: 'card-1' }));
    expect(onAdd).toHaveBeenCalledWith('2026-08-21');
  });

  it('tamamlananlar görünümünde yalnızca biten kartları gösterir', () => {
    render(
      <PlannerCollectionView
        view="completed"
        anchor="2026-08-21"
        days={[]}
        cards={[card(), card({ id: 'done', title: 'Bitti', done: true })]}
        today="2026-08-21"
        onAdd={vi.fn()}
        onInspect={vi.fn()}
        onToggleDone={vi.fn()}
      />,
    );
    expect(screen.getByText('Bitti')).toBeInTheDocument();
    expect(screen.queryByText('Planı tamamla')).not.toBeInTheDocument();
  });
});
