import { useEffect, useState } from 'react';
import { dayName, shortDate } from '../lib/dates.ts';
import { priorityLabel, REMINDER_OPTIONS, type Card } from '../lib/types.ts';
import { deadlineLabel, deadlineState } from '../lib/deadline.ts';
import { tagColorIndex } from '../lib/tags.ts';

/**
 * Kartı rahatça incelemek için okuma penceresi: metnin tamamı kırpılmadan,
 * görseller büyük. Görsele tıklayınca tam ekran açılır.
 */
export default function CardViewModal({
  card,
  onClose,
  onEdit,
}: {
  card: Card;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (zoom) setZoom(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoom]);

  const time = card.startTime
    ? card.endTime
      ? `${card.startTime} - ${card.endTime}`
      : card.startTime
    : null;

  const reminderLabels = card.reminders
    .map((minutes) => REMINDER_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} dk`)
    .join(' · ');
  const dueState = deadlineState(card.deadlineAt, card.done);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal view-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-view-title"
        style={{ ['--c' as string]: `var(--c-${card.color})` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title" id="card-view-title">İncele</h2>
          <span className="topbar-range">
            {dayName(card.day)} · {shortDate(card.day)}
          </span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="modal-body view-body">
          {time && (
            <div className="card-time">
              <span className="time-badge">{time}</span>
            </div>
          )}

          <h3 className={`view-title${card.done ? ' done' : ''}`}>{card.title || '(başlıksız)'}</h3>

          {card.note && <p className="view-note">{card.note}</p>}

          {card.tags.length > 0 && (
            <div className="view-tags" aria-label="Etiketler">
              {card.tags.map((tag) => (
                <span className={`tag-chip tag-color-${tagColorIndex(tag)}`} key={tag}>{tag}</span>
              ))}
            </div>
          )}

          {card.checklist.length > 0 && (
            <section className="view-checklist" aria-label="Checklist">
              <div className="checklist-heading">
                <h4>Checklist</h4>
                <span>{card.checklist.filter((item) => item.done).length}/{card.checklist.length}</span>
              </div>
              <ul>
                {card.checklist.map((item) => (
                  <li className={item.done ? 'done' : ''} key={item.id}>
                    <span aria-hidden="true">{item.done ? '✓' : ''}</span>
                    <p>{item.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {card.images.length > 0 && (
            <div className="view-images">
              {card.images.map((image) => (
                <button key={image.id} className="view-image" onClick={() => setZoom(image.url)}>
                  <img src={image.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}

          <dl className="view-meta">
            <div>
              <dt>Durum</dt>
              <dd>{card.done ? 'Yapıldı' : 'Bekliyor'}</dd>
            </div>
            <div>
              <dt>Öncelik</dt>
              <dd>{priorityLabel(card.priority)}</dd>
            </div>
            <div>
              <dt>Son tarih</dt>
              <dd className={dueState === 'overdue' ? 'deadline-overdue-text' : undefined}>
                {card.deadlineAt
                  ? `${dueState === 'overdue' ? 'Gecikti · ' : ''}${deadlineLabel(card.deadlineAt)}`
                  : 'Yok'}
              </dd>
            </div>
            <div>
              <dt>Hatırlatma</dt>
              <dd>{card.reminders.length > 0 ? reminderLabels : 'Yok'}</dd>
            </div>
            {card.habitId && (
              <div>
                <dt>Kaynak</dt>
                <dd>Davranıştan üretildi</dd>
              </div>
            )}
            <div>
              <dt>Görsel</dt>
              <dd>{card.images.length}</dd>
            </div>
          </dl>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Kapat
          </button>
          <button className="btn btn-primary" onClick={onEdit}>
            Düzenle
          </button>
        </div>
      </div>

      {zoom && (
        <div className="zoom-layer" onMouseDown={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </div>
  );
}
