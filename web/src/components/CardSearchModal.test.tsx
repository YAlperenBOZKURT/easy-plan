import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CardSearchModal from './CardSearchModal.tsx';
import { api } from '../lib/api.ts';
import type { Card } from '../lib/types.ts';

const result: Card = {
  id: 'card-search-1',
  day: '2026-08-18',
  title: 'Proje sunumu',
  note: 'Müşteri için son taslak',
  startTime: null,
  endTime: null,
  color: 'blue',
  done: false,
  sortIndex: 0,
  manualSort: false,
  habitId: null,
  checklist: [],
  priority: 'high',
  deadlineAt: null,
  tags: ['İş'],
  reminders: [],
  images: [],
  createdAt: '',
  updatedAt: '',
};

describe('CardSearchModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('başlık ve not aramasını gecikmeli yapıp seçilen kartı açar', async () => {
    const search = vi.spyOn(api, 'searchCards').mockResolvedValue({
      query: 'proje',
      cards: [result],
    });
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<CardSearchModal onClose={vi.fn()} onSelect={onSelect} />);
    await user.type(screen.getByRole('searchbox', { name: 'Kart ara' }), 'proje');

    expect(await screen.findByText('Proje sunumu')).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith('proje');
    expect(screen.getByText('Müşteri için son taslak')).toBeInTheDocument();

    await user.click(screen.getByText('Proje sunumu'));
    expect(onSelect).toHaveBeenCalledWith(result);
  });
});
