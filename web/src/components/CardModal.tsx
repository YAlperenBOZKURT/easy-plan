import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  CARD_COLORS,
  CARD_PRIORITY_OPTIONS,
  type Card,
  type CardPriority,
  type ChecklistItem,
} from '../lib/types.ts';
import { dayName, shortDate } from '../lib/dates.ts';
import ReminderPicker from './ReminderPicker.tsx';
import { normalizeChecklist } from '../lib/checklist.ts';

export interface CardDraft {
  card?: Card;
  day: string;
}

/**
 * Kart oluşturma / düzenleme.
 *
 * Yeni kartta görseller önce yerelde tutulur, kart kaydedildikten sonra yüklenir —
 * böylece vazgeçilen kartlardan sunucuda artık dosya kalmaz.
 */
export default function CardModal({
  draft,
  onClose,
  onSaved,
}: {
  draft: CardDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = draft.card;
  const [day, setDay] = useState(existing?.day ?? draft.day);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [startTime, setStartTime] = useState(existing?.startTime ?? '');
  const [endTime, setEndTime] = useState(existing?.endTime ?? '');
  const [color, setColor] = useState(existing?.color ?? 'blue');
  const [priority, setPriority] = useState<CardPriority>(existing?.priority ?? 'none');
  const [reminders, setReminders] = useState<number[]>(existing?.reminders ?? []);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(existing?.checklist ?? []);
  const [images, setImages] = useState(existing?.images ?? []);
  const [pending, setPending] = useState<File[]>([]);
  const [resetOrder, setResetOrder] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  const newChecklistItem = (): ChecklistItem => ({
    id: globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: '',
    done: false,
  });

  // preventScroll: odaklanırken modal gövdesi kayıp "Başlık" etiketini gizlemesin.
  useEffect(() => titleInput.current?.focus({ preventScroll: true }), []);

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const picked = [...files].filter((f) => f.type.startsWith('image/'));
    if (picked.length > 0) setPending((current) => [...current, ...picked]);
  };

  // Ctrl+V ile panodaki görsel doğrudan karta eklenir.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload = {
        day,
        title: title.trim(),
        note: note.trim(),
        startTime: startTime || null,
        endTime: endTime || null,
        color,
        priority,
        reminders,
        checklist: normalizeChecklist(checklist),
        ...(resetOrder ? { manualSort: false } : {}),
      };
      const saved = existing
        ? (await api.updateCard(existing.id, payload)).card
        : (await api.createCard(payload)).card;
      if (pending.length > 0) await api.uploadImages(saved.id, pending);
      onSaved();
      onClose();
    } catch {
      setError('Kaydedilemedi. Bağlantını kontrol edip tekrar dene.');
      setBusy(false);
    }
  }

  async function removeImage(id: string) {
    setImages((current) => current.filter((image) => image.id !== id));
    await api.deleteImage(id).catch(() => undefined);
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title" id="card-modal-title">{existing ? 'Kartı düzenle' : 'Yeni kart'}</h2>
          <span className="topbar-range">
            {dayName(day)} · {shortDate(day)}
          </span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="label" htmlFor="title">
              Başlık
            </label>
            <input
              id="title"
              ref={titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ne yapacaksın?"
            />
          </div>

          <div className="row">
            {/* Telefonda kartı sürüklemeden başka güne taşımanın yolu */}
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="day">
                Gün
              </label>
              <input id="day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            </div>
          </div>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="start">
                Başlangıç
              </label>
              <input id="start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="end">
                Bitiş
              </label>
              <input id="end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <span className="label">Renk</span>
            <div className="swatches">
              {CARD_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={option}
                  className={`swatch${color === option ? ' on' : ''}`}
                  style={{ ['--c' as string]: `var(--c-${option})` }}
                  onClick={() => setColor(option)}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">Öncelik</span>
            <div className="priority-picker">
              {CARD_PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`priority-option priority-${option.value}${priority === option.value ? ' on' : ''}`}
                  aria-pressed={priority === option.value}
                  onClick={() => setPriority(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="note">
              Not
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Detaylar, sayılar, aklında kalsın istediklerin…"
            />
          </div>

          <div className="field">
            <div className="checklist-heading">
              <span className="label">Checklist</span>
              <span className="hint">{checklist.length}/50</span>
            </div>
            <div className="checklist-editor">
              {checklist.map((item) => (
                <div className="checklist-editor-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    aria-label={`${item.text || 'Checklist maddesi'} tamamlandı`}
                    onChange={(event) => setChecklist((current) => current.map((entry) =>
                      entry.id === item.id ? { ...entry, done: event.target.checked } : entry,
                    ))}
                  />
                  <input
                    value={item.text}
                    maxLength={500}
                    aria-label="Checklist maddesi"
                    placeholder="Yeni madde"
                    onChange={(event) => setChecklist((current) => current.map((entry) =>
                      entry.id === item.id ? { ...entry, text: event.target.value } : entry,
                    ))}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon checklist-remove"
                    aria-label="Checklist maddesini kaldır"
                    onClick={() => setChecklist((current) => current.filter((entry) => entry.id !== item.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn checklist-add"
              disabled={checklist.length >= 50}
              onClick={() => setChecklist((current) => [...current, newChecklistItem()])}
            >
              + Madde ekle
            </button>
          </div>

          <ReminderPicker value={reminders} onChange={setReminders} />

          {existing?.manualSort && (
            <label className="row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={resetOrder}
                onChange={(e) => setResetOrder(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Bu kart elle taşınmıştı — tekrar saate göre sıralansın
              </span>
            </label>
          )}

          <div className="field">
            <span className="label">Görseller</span>
            {(images.length > 0 || pending.length > 0) && (
              <div className="thumbs">
                {images.map((image) => (
                  <div className="thumb" key={image.id}>
                    <img src={image.thumbUrl} alt="" />
                    <button className="x" onClick={() => removeImage(image.id)} aria-label="Kaldır">
                      ✕
                    </button>
                  </div>
                ))}
                {pending.map((file, index) => (
                  <div className="thumb" key={`${file.name}-${index}`}>
                    <img src={URL.createObjectURL(file)} alt="" />
                    <button
                      className="x"
                      onClick={() => setPending((current) => current.filter((_, i) => i !== index))}
                      aria-label="Kaldır"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div
              className={`dropzone${dragOver ? ' over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Görsel seç"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInput.current?.click();
                }
              }}
            >
              Sürükle, <strong>Ctrl+V</strong> ile yapıştır ya da tıklayıp seç
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>
          </div>

          {error && <p className="error-text" role="alert">{error}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
        </div>
      </div>
    </div>
  );
}
