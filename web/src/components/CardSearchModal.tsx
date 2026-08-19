import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { dayName, shortDate } from '../lib/dates.ts';
import { priorityLabel, type Card } from '../lib/types.ts';
import { tagColorIndex } from '../lib/tags.ts';

const MIN_QUERY_LENGTH = 2;

export default function CardSearchModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (card: Card) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    const value = query.trim();
    if (value.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      setError(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(false);
    const timer = window.setTimeout(() => {
      api.searchCards(value)
        .then((response) => {
          if (!active) return;
          setResults(response.cards);
          setSearched(true);
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal search-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-search-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title" id="card-search-title">Kartlarda ara</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">✕</button>
        </div>

        <div className="search-input-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            maxLength={100}
            placeholder="Başlık veya not yaz…"
            aria-label="Kart ara"
            onChange={(event) => setQuery(event.target.value)}
          />
          {loading && <span className="spinner spinner-sm" role="status" aria-label="Aranıyor" />}
        </div>

        <div className="search-results" aria-live="polite">
          {query.trim().length < MIN_QUERY_LENGTH && (
            <p className="search-empty">Aramak için en az 2 karakter yaz.</p>
          )}
          {error && <p className="search-empty danger-text">Arama yapılamadı. Bağlantını kontrol et.</p>}
          {!loading && !error && searched && results.length === 0 && (
            <p className="search-empty">Eşleşen kart bulunamadı.</p>
          )}
          {results.map((card) => (
            <button
              type="button"
              className="search-result"
              key={card.id}
              onClick={() => onSelect(card)}
            >
              <span className="search-result-head">
                <strong>{card.title || '(başlıksız)'}</strong>
                <time dateTime={card.day}>{dayName(card.day)} · {shortDate(card.day)}</time>
              </span>
              {card.note && <span className="search-result-note">{card.note}</span>}
              {(card.priority !== 'none' || card.tags.length > 0) && (
                <span className="search-result-meta">
                  {card.priority !== 'none' && <em>{priorityLabel(card.priority)}</em>}
                  {card.tags.slice(0, 4).map((tag) => (
                    <span className={`tag-chip tag-color-${tagColorIndex(tag)}`} key={tag}>{tag}</span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
