import { useEffect, useState } from 'react';
import { dayName, shortDate } from '../lib/dates.ts';
import type { Card } from '../lib/types.ts';
import { deadlineState } from '../lib/deadline.ts';
import { tagColorIndex } from '../lib/tags.ts';
import { useI18n } from '../lib/i18n.tsx';

/**
 * Kartı rahatça incelemek için okuma penceresi: metnin tamamı kırpılmadan,
 * görseller büyük. Görsele tıklayınca tam ekran açılır.
 */
export default function CardViewModal({
  card,
  onClose,
  onEdit,
  onArchive,
  onDuplicate,
  onSaveTemplate,
  onDelete,
  onHistory,
  readOnly = false,
}: {
  card: Card;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDuplicate: () => void;
  onSaveTemplate: () => void;
  onDelete: () => void;
  onHistory?: () => void;
  readOnly?: boolean;
}) {
  const { locale, t } = useI18n();
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
    .map((minutes) => minutes === 1440 ? t('reminder.day')
      : minutes === 720 ? t('reminder.hours12')
        : minutes === 360 ? t('reminder.hours6')
          : minutes === 180 ? t('reminder.hours3')
            : minutes === 60 ? t('reminder.hour')
              : t('reminder.minutes', { minutes }))
    .join(' · ');
  const dueState = deadlineState(card.deadlineAt, card.done);
  const localizedPriority = t(`priority.${card.priority}` as
    'priority.none' | 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent');

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
          <h2 className="modal-title" id="card-view-title">{t('card.inspect')}</h2>
          <span className="topbar-range">
            {dayName(card.day, locale)} · {shortDate(card.day, locale)}
          </span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="modal-body view-body">
          {time && (
            <div className="card-time">
              <span className="time-badge">{time}</span>
            </div>
          )}

          <h3 className={`view-title${card.done ? ' done' : ''}`}>{card.title || t('card.untitled')}</h3>

          {card.note && <p className="view-note">{card.note}</p>}

          {card.tags.length > 0 && (
            <div className="view-tags" aria-label={t('card.tags')}>
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
              <dt>{t('card.status')}</dt>
              <dd>{card.done ? t('card.done') : t('card.pending')}</dd>
            </div>
            <div>
              <dt>{t('card.priority')}</dt>
              <dd>{localizedPriority}</dd>
            </div>
            <div>
              <dt>{t('card.deadline')}</dt>
              <dd className={dueState === 'overdue' ? 'deadline-overdue-text' : undefined}>
                {card.deadlineAt
                  ? `${dueState === 'overdue' ? `${t('card.overdue')} · ` : ''}${new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(card.deadlineAt))}`
                  : t('card.none')}
              </dd>
            </div>
            <div>
              <dt>{t('card.reminder')}</dt>
              <dd>{card.reminders.length > 0 ? reminderLabels : t('card.none')}</dd>
            </div>
            {card.habitId && (
              <div>
                <dt>{t('card.source')}</dt>
                <dd>{t('card.habitGenerated')}</dd>
              </div>
            )}
            {card.templateId && (
              <div>
                <dt>{t('card.template')}</dt>
                <dd>{t('card.templateLinked')}</dd>
              </div>
            )}
            <div>
              <dt>{t('card.image')}</dt>
              <dd>{card.images.length}</dd>
            </div>
          </dl>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          {onHistory && <button className="btn" onClick={onHistory}>{t('card.history')}</button>}
          {!readOnly && <button className="btn" onClick={onArchive}>
            {t('card.archive')}
          </button>}
          {!readOnly && <button className="btn" onClick={onDuplicate}>
            {t('card.duplicate')}
          </button>}
          {!readOnly && <button className="btn" onClick={onSaveTemplate}>
            {t('card.makeTemplate')}
          </button>}
          {!readOnly && <button className="btn btn-red" onClick={onDelete}>
            {t('card.trash')}
          </button>}
          {!readOnly && <button className="btn btn-primary" onClick={onEdit}>
            {t('card.edit')}
          </button>}
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
