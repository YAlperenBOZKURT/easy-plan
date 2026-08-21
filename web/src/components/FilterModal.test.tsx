import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FilterModal from './FilterModal.tsx';
import { DEFAULT_FILTERS } from '../lib/filters.ts';

describe('FilterModal', () => {
  it('filtre seçeneklerini listeler ve seçimleri uygulayarak geri bildirir', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();

    render(
      <FilterModal
        currentFilters={DEFAULT_FILTERS}
        allTags={['iş', 'kişisel']}
        onApply={onApply}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Kartları Filtrele')).toBeInTheDocument();

    // Durum seçimi (Tamamlanacak)
    fireEvent.click(screen.getByRole('button', { name: 'Tamamlanacak' }));

    // Öncelik seçimi (Acil)
    fireEvent.click(screen.getByRole('button', { name: 'Acil' }));

    // Etiket seçimi
    fireEvent.click(screen.getByRole('button', { name: 'iş' }));

    // Uygula tıkla
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));

    expect(onApply).toHaveBeenCalledWith({
      status: 'todo',
      priority: 'urgent',
      tags: ['iş'],
      habit: 'all',
      deadline: 'all',
      color: 'all',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('filtreleri sıfırla butonu varsayılan filtreleri ayarlar', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();

    render(
      <FilterModal
        currentFilters={{
          status: 'done',
          priority: 'high',
          tags: ['kişisel'],
          habit: 'habit',
          deadline: 'overdue',
          color: 'blue',
        }}
        allTags={['kişisel']}
        onApply={onApply}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filtreleri Sıfırla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));

    expect(onApply).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });
});
