import { useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { priorityLabel, type Card } from '../lib/types.ts';
import { checklistProgress } from '../lib/checklist.ts';

/** Bu mesafeden az hareket eden işaretçi sürükleme değil, tıklama sayılır. */
const CLICK_SLOP = 6;

/**
 * Takvim kartı. Üstünde renkli saat rozeti, altında başlık/not/görseller.
 * Tıklanınca üç aksiyon açılır: Düzenle · Yapıldı · Sil.
 */
export default function CardItem({
  card,
  open,
  onToggleOpen,
  onEdit,
  onInspect,
  onToggleDone,
  onToggleChecklist,
  onDelete,
}: {
  card: Card;
  open: boolean;
  onToggleOpen: () => void;
  onEdit: () => void;
  onInspect: () => void;
  onToggleDone: () => void;
  onToggleChecklist: (itemId: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { day: card.day },
  });

  // Tıklamayı, işaretçinin gerçekten hareket edip etmediğine bakarak ayırt ediyoruz.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  const time = card.startTime
    ? card.endTime
      ? `${card.startTime} - ${card.endTime}`
      : card.startTime
    : null;
  const progress = checklistProgress(card.checklist);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        ['--c' as string]: `var(--c-${card.color})`,
      }}
      data-card-id={card.id}
      className={`card${card.done ? ' done' : ''}${isDragging ? ' dragging' : ''}${open ? ' active' : ''}`}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        // Yalnızca "bu bir tıklama mıydı" sorusunu yanıtlamak için.
        pressedAt.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = pressedAt.current;
        pressedAt.current = null;
        if (!start || isDragging) return;
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (moved <= CLICK_SLOP) onToggleOpen();
      }}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${card.title || 'Başlıksız kart'}${card.done ? ', yapıldı' : ''}. İşlemleri aç`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleOpen();
        }
      }}
    >
      {(time || card.priority !== 'none') && (
        <div className="card-badges">
          {time && <span className="time-badge">{time}</span>}
          {card.priority !== 'none' && (
            <span className={`priority-badge priority-${card.priority}`}>
              {priorityLabel(card.priority)}
            </span>
          )}
        </div>
      )}
      {card.title && <p className="card-title">{card.title}</p>}
      {card.note && <p className="card-note">{card.note}</p>}

      {card.checklist.length > 0 && (
        <div className="card-checklist">
          <div className="card-checklist-progress">
            <span>{progress.completed}/{progress.total}</span>
            <span className="card-checklist-track" aria-hidden="true">
              <span style={{ width: `${progress.ratio * 100}%` }} />
            </span>
          </div>
          {card.checklist.slice(0, 3).map((item) => (
            <button
              type="button"
              className={`card-checklist-item${item.done ? ' done' : ''}`}
              key={item.id}
              aria-label={`${item.text}: ${item.done ? 'geri al' : 'tamamla'}`}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleChecklist(item.id);
              }}
            >
              <span aria-hidden="true">{item.done ? '✓' : ''}</span>
              <em>{item.text}</em>
            </button>
          ))}
          {card.checklist.length > 3 && <span className="card-checklist-more">+{card.checklist.length - 3} madde</span>}
        </div>
      )}

      {card.images.length > 0 && (
        <div className={`card-images ${card.images.length === 1 ? 'one' : 'multi'}`}>
          {card.images.slice(0, 4).map((image) => (
            <img key={image.id} src={image.thumbUrl} alt="" loading="lazy" draggable={false} />
          ))}
        </div>
      )}

      {(card.reminders.length > 0 || card.habitId) && (
        <div className="card-meta">
          {card.reminders.length > 0 && <span>🔔 {card.reminders.length}</span>}
          {card.habitId && <span title="Davranıştan üretildi">↻</span>}
        </div>
      )}

      {open && (
        <div
          className="card-actions"
          // İşaretçi olayları da durdurulmalı: aksi hâlde kart menüyü kapatır ve
          // buton, click olayı ulaşmadan DOM'dan kalkar.
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="btn btn-sm btn-blue" onClick={onEdit}>
            Düzenle
          </button>
          <button className="btn btn-sm btn-violet" onClick={onInspect}>
            İncele
          </button>
          <button className="btn btn-sm btn-green" onClick={onToggleDone}>
            {card.done ? 'Geri al' : 'Yapıldı'}
          </button>
          <button className="btn btn-sm btn-red" onClick={onDelete}>
            Sil
          </button>
        </div>
      )}
    </div>
  );
}
