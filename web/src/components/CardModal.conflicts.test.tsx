import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '../lib/api.ts';
import type { Card } from '../lib/types.ts';
import { I18nProvider } from '../lib/i18n.tsx';
import CardModal from './CardModal.tsx';
import CardConflictPanel from './CardConflictPanel.tsx';

const original: Card = {
  id: 'card-1', day: '2026-09-30', title: 'Original', note: 'Original note',
  startTime: '12:00', endTime: null, color: 'blue', done: false, sortIndex: 100,
  manualSort: false, habitId: null, checklist: [], priority: 'none', deadlineAt: null,
  tags: [], reminders: [], images: [], createdAt: '2026-09-30T08:00:00.000Z',
  updatedAt: '2026-09-30T08:00:00.000Z',
};
const remote: Card = { ...original, title: 'Remote title', note: 'Remote note', updatedAt: '2026-09-30T09:00:00.000Z' };
const stale = (card: Card) => new ApiError(409, 'stale_write', { error: 'stale_write', card });

describe('CardModal concurrent edits', () => {
  beforeEach(() => {
    vi.spyOn(api, 'tags').mockResolvedValue({ tags: [] });
    vi.spyOn(api, 'cardTemplates').mockResolvedValue({ templates: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends the original server version with an edit', async () => {
    const update = vi.spyOn(api, 'updateCard').mockResolvedValue({ card: remote });
    const saved = vi.fn();
    render(<CardModal draft={{ day: original.day, card: original }} onClose={vi.fn()} onSaved={saved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(update).toHaveBeenCalledWith(original.id, expect.objectContaining({ updatedAt: original.updatedAt }));
    expect(saved).toHaveBeenCalledOnce();
  });

  it('preserves the draft through repeated conflicts and retries only the reviewed version', async () => {
    const newer = { ...remote, title: 'Newer remote', updatedAt: '2026-09-30T10:00:00.000Z' };
    const update = vi.spyOn(api, 'updateCard').mockRejectedValueOnce(stale(remote))
      .mockRejectedValueOnce(stale(newer)).mockResolvedValueOnce({ card: newer });
    const saved = vi.fn(); const close = vi.fn(); const user = userEvent.setup();
    render(<CardModal draft={{ day: original.day, card: original }} onClose={close} onSaved={saved} />);
    await user.clear(screen.getByLabelText('Başlık'));
    await user.type(screen.getByLabelText('Başlık'), 'My draft');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    const panel = await screen.findByRole('region', { name: 'Kart başka bir yerde değişti' });
    expect(within(panel).getByText('My draft')).toBeInTheDocument();
    expect(within(panel).getByText('Remote title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Benim değişikliklerimi kaydet' }));
    expect(update.mock.calls[1]?.[1]).toMatchObject({ title: 'My draft', updatedAt: remote.updatedAt });
    expect(await screen.findByText('Newer remote')).toBeInTheDocument();
    expect(screen.getByLabelText('Başlık')).toHaveValue('My draft');
    expect(close).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Benim değişikliklerimi kaydet' }));
    expect(update.mock.calls[2]?.[1]).toMatchObject({ title: 'My draft', updatedAt: newer.updatedAt });
    expect(saved).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });

  it('adopts the server fields without sending an overwrite', async () => {
    const update = vi.spyOn(api, 'updateCard').mockRejectedValueOnce(stale(remote)).mockResolvedValueOnce({ card: remote });
    const user = userEvent.setup();
    render(<CardModal draft={{ day: original.day, card: original }} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    await user.click(await screen.findByRole('button', { name: 'Sunucudaki sürümü kullan' }));
    expect(update).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Başlık')).toHaveValue(remote.title);
    expect(screen.getByLabelText('Not')).toHaveValue(remote.note);
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(update.mock.calls[1]?.[1]).toMatchObject({ updatedAt: remote.updatedAt, title: remote.title });
  });

  it('offers localized choices in English', () => {
    render(<I18nProvider initialLocale="en"><CardConflictPanel local={original} server={remote}
      busy={false} onKeep={vi.fn()} onUseServer={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Save my changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use server version' })).toBeInTheDocument();
  });
});
