import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import type { Card } from '../lib/types.ts';

export default function CardTemplateNameModal({
  card,
  onClose,
  onSaved,
}: {
  card: Card;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(card.title || 'Yeni şablon');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.saveCardAsTemplate(card.id, trimmed);
      onSaved();
      onClose();
    } catch {
      setError('Şablon kaydedilemedi. Bağlantını kontrol edip tekrar dene.');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="template-name-title">
        <div className="modal-head">
          <h2 className="modal-title" id="template-name-title">Şablon olarak kaydet</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="label" htmlFor="template-name">Şablon adı</label>
            <input
              ref={input}
              id="template-name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save();
                if (event.key === 'Escape') onClose();
              }}
            />
            <span className="hint">Kart şablona bağlanır; içerik, ayarlar ve görseller dahil edilir. Kartı değiştirirsen bağlantı kesilir.</span>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void save()}>
            {busy ? 'Kaydediliyor…' : 'Şablon yap'}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>Vazgeç</button>
        </div>
      </div>
    </div>
  );
}
