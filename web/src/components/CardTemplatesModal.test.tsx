import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../lib/api.ts';
import type { CardTemplate } from '../lib/types.ts';
import CardTemplatesModal from './CardTemplatesModal.tsx';

const template: CardTemplate = {
  id: 'template-1',
  name: 'Sabah',
  title: 'Planla',
  note: '',
  startTime: '08:30',
  endTime: null,
  color: 'blue',
  checklist: [],
  priority: 'none',
  tags: [],
  reminders: [],
  images: [],
  createdAt: '',
  updatedAt: '',
};

describe('CardTemplatesModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('şablonu düzenler ve bağlı kartları yenileme callbackini çağırır', async () => {
    vi.spyOn(api, 'cardTemplates').mockResolvedValue({ templates: [template] });
    const update = vi.spyOn(api, 'updateCardTemplate').mockResolvedValue({
      template: { ...template, title: 'Yeni plan' },
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CardTemplatesModal onClose={vi.fn()} onChanged={onChanged} />);

    const title = await screen.findByLabelText('Kart başlığı');
    await user.clear(title);
    await user.type(title, 'Yeni plan');
    await user.click(screen.getByRole('button', { name: 'Değişiklikleri kaydet' }));

    expect(update).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ title: 'Yeni plan' }),
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
