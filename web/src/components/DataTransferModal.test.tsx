import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../lib/api.ts';
import DataTransferModal from './DataTransferModal.tsx';

describe('DataTransferModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('seçilen biçim ve tarih aralığını dışa aktarır', async () => {
    const exportData = vi.spyOn(api, 'exportData').mockResolvedValue({
      blob: new Blob(['calendar']),
      filename: 'easy-plan.ics',
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<DataTransferModal initialFrom="2026-08-01" initialTo="2026-08-31" onClose={vi.fn()} onImported={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /iCalendar/ }));
    await user.click(screen.getByRole('button', { name: 'Dosyayı indir' }));

    expect(exportData).toHaveBeenCalledWith('ics', '2026-08-01', '2026-08-31');
    expect(click).toHaveBeenCalledOnce();
  });

  it('dosyayı içe aktarır ve kartları yeniler', async () => {
    vi.spyOn(api, 'importData').mockResolvedValue({ imported: 2, skipped: 1, errors: [] });
    const onImported = vi.fn();
    const user = userEvent.setup();
    render(<DataTransferModal initialFrom="2026-08-01" initialTo="2026-08-31" onClose={vi.fn()} onImported={onImported} />);

    await user.upload(
      screen.getByLabelText('Aktarım dosyası'),
      new File(['{"cards":[]}'], 'plan.json', { type: 'application/json' }),
    );

    expect(await screen.findByText('2 kart içe aktarıldı, 1 kayıt atlandı.')).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledOnce();
  });
});
