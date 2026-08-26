import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.ts';
import type { Card } from '../lib/types.ts';
import CardLifecycleModal from './CardLifecycleModal.tsx';

const card: Card = {
  id: 'archived-1',
  day: '2026-08-25',
  title: 'Arşiv kartı',
  note: 'Daha sonra kullanılacak',
  startTime: null,
  endTime: null,
  color: 'amber',
  done: false,
  sortIndex: 0,
  manualSort: false,
  habitId: null,
  checklist: [],
  priority: 'none',
  deadlineAt: null,
  tags: [],
  archivedAt: '2026-08-25T10:00:00.000Z',
  trashedAt: null,
  reminders: [],
  images: [],
  createdAt: '',
  updatedAt: '',
};

describe('CardLifecycleModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('arşiv kartını listeler ve geri yükler', async () => {
    vi.spyOn(api, 'archivedCards').mockResolvedValue({ cards: [card] });
    vi.spyOn(api, 'trashedCards').mockResolvedValue({ cards: [] });
    const restore = vi.spyOn(api, 'restoreCard').mockResolvedValue({ card: { ...card, archivedAt: null } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <CardLifecycleModal onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Arşiv kartı')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Geri yükle' }));
    expect(restore).toHaveBeenCalledWith('archived-1');
  });
});
