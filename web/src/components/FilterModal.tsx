import { useEffect, useState } from 'react';
import {
  DEFAULT_FILTERS,
  type CardFilterState,
  type FilterDeadline,
  type FilterHabit,
  type FilterPriority,
  type FilterStatus,
} from '../lib/filters.ts';
import { CARD_COLORS, CARD_PRIORITY_OPTIONS } from '../lib/types.ts';
import { tagColorIndex } from '../lib/tags.ts';

interface FilterModalProps {
  currentFilters: CardFilterState;
  allTags: string[];
  onApply: (filters: CardFilterState) => void;
  onClose: () => void;
}

const STATUS_OPTIONS: Array<{ value: FilterStatus; label: string }> = [
  { value: 'all', label: 'Tümü' },
  { value: 'todo', label: 'Tamamlanacak' },
  { value: 'done', label: 'Tamamlanan' },
];

const HABIT_OPTIONS: Array<{ value: FilterHabit; label: string }> = [
  { value: 'all', label: 'Tümü' },
  { value: 'habit', label: 'Alışkanlıklar' },
  { value: 'manual', label: 'Elle Eklenenler' },
];

const DEADLINE_OPTIONS: Array<{ value: FilterDeadline; label: string }> = [
  { value: 'all', label: 'Tümü' },
  { value: 'overdue', label: 'Gecikenler' },
  { value: 'has_deadline', label: 'Son Tarihi Olanlar' },
];

export default function FilterModal({
  currentFilters,
  allTags,
  onApply,
  onClose,
}: FilterModalProps) {
  const [filters, setFilters] = useState<CardFilterState>(currentFilters);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleTag = (tag: string) => {
    setFilters((prev) => {
      const lower = tag.toLowerCase();
      const exists = prev.tags.some((t) => t.toLowerCase() === lower);
      const nextTags = exists
        ? prev.tags.filter((t) => t.toLowerCase() !== lower)
        : [...prev.tags, tag];
      return { ...prev, tags: nextTags };
    });
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const handleSave = () => {
    onApply(filters);
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal filter-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title" id="filter-modal-title">Kartları Filtrele</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="modal-body filter-modal-body">
          {/* Durum */}
          <div className="filter-group">
            <label className="label">Durum</label>
            <div className="segmented-group" role="radiogroup" aria-label="Durum">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`segmented-btn ${filters.status === opt.value ? 'active' : ''}`}
                  onClick={() => setFilters((prev) => ({ ...prev, status: opt.value }))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Öncelik */}
          <div className="filter-group">
            <label className="label">Öncelik</label>
            <div className="filter-chips-row">
              <button
                type="button"
                className={`filter-chip ${filters.priority === 'all' ? 'active' : ''}`}
                onClick={() => setFilters((prev) => ({ ...prev, priority: 'all' }))}
              >
                Tümü
              </button>
              {CARD_PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`filter-chip ${filters.priority === opt.value ? 'active' : ''}`}
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, priority: opt.value as FilterPriority }))
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Etiketler */}
          {allTags.length > 0 && (
            <div className="filter-group">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="label" style={{ margin: 0 }}>
                  Etiketler {filters.tags.length > 0 && `(${filters.tags.length})`}
                </label>
                {filters.tags.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '2px 6px' }}
                    onClick={() => setFilters((prev) => ({ ...prev, tags: [] }))}
                  >
                    Etiketleri temizle
                  </button>
                )}
              </div>
              <div className="filter-chips-row">
                {allTags.map((tag) => {
                  const isSelected = filters.tags.some(
                    (t) => t.toLowerCase() === tag.toLowerCase(),
                  );
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`filter-tag-chip tag-color-${tagColorIndex(tag)} ${
                        isSelected ? 'selected' : ''
                      }`}
                      onClick={() => toggleTag(tag)}
                      aria-pressed={isSelected}
                    >
                      {isSelected && <span className="check-icon">✓</span>}
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Kaynak */}
          <div className="filter-group">
            <label className="label">Kaynak</label>
            <div className="segmented-group" role="radiogroup" aria-label="Kaynak">
              {HABIT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`segmented-btn ${filters.habit === opt.value ? 'active' : ''}`}
                  onClick={() => setFilters((prev) => ({ ...prev, habit: opt.value }))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Son Tarih & Gecikme */}
          <div className="filter-group">
            <label className="label">Son Tarih & Gecikme</label>
            <div className="segmented-group" role="radiogroup" aria-label="Son Tarih & Gecikme">
              {DEADLINE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`segmented-btn ${filters.deadline === opt.value ? 'active' : ''}`}
                  onClick={() => setFilters((prev) => ({ ...prev, deadline: opt.value }))}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Renk */}
          <div className="filter-group">
            <label className="label">Renk</label>
            <div className="color-dots-filter">
              <button
                type="button"
                className={`color-filter-btn ${filters.color === 'all' ? 'active' : ''}`}
                onClick={() => setFilters((prev) => ({ ...prev, color: 'all' }))}
              >
                Tümü
              </button>
              {CARD_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot-btn ${c} ${filters.color === c ? 'selected' : ''}`}
                  onClick={() => setFilters((prev) => ({ ...prev, color: c }))}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="modal-foot filter-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={handleReset}>
            Filtreleri Sıfırla
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            İptal
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            Uygula
          </button>
        </div>
      </div>
    </div>
  );
}
