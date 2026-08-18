import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../lib/api.ts';
import CardModal from './CardModal.tsx';

describe('CardModal checklist', () => {
  afterEach(() => vi.restoreAllMocks());

  it('eklenen maddeyi temizleyerek kart isteğine dahil eder', async () => {
    vi.spyOn(api, 'tags').mockResolvedValue({ tags: ['Mevcut'] });
    const create = vi.spyOn(api, 'createCard').mockResolvedValue({
      card: {
        id: 'card-1',
        day: '2026-08-15',
        title: 'Plan',
        note: '',
        startTime: null,
        endTime: null,
        color: 'blue',
        done: false,
        sortIndex: 0,
        manualSort: false,
        habitId: null,
        checklist: [],
        priority: 'none',
        deadlineAt: null,
        tags: [],
        reminders: [],
        images: [],
        createdAt: '',
        updatedAt: '',
      },
    });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <CardModal
        draft={{ day: '2026-08-15' }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await user.type(screen.getByLabelText('Başlık'), 'Plan');
    await user.click(screen.getByRole('button', { name: /Madde ekle/ }));
    await user.type(screen.getByLabelText('Checklist maddesi'), '  İlk iş  ');
    await user.click(screen.getByRole('button', { name: 'Acil' }));
    await user.type(screen.getByLabelText('Son tarih'), '2026-08-20T18:30');
    await user.type(screen.getByLabelText('Etiketler'), '  Backend  {Enter}');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      title: 'Plan',
      checklist: [{ text: 'İlk iş', done: false }],
      priority: 'urgent',
      deadlineAt: new Date(2026, 7, 20, 18, 30).toISOString(),
      tags: ['Backend'],
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
