import { useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '../lib/types.ts';

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
  onDelete,
}: {
  card: Card;
  open: boolean;
  onToggleOpen: () => void;
  onEdit: () => void;
  onInspect: () => void;
  onToggleDone: () => void;
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
      {time && (
        <div className="card-time">
          <span className="time-badge">{time}</span>
        </div>
      )}
      {card.title && <p className="card-title">{card.title}</p>}
      {card.note && <p className="card-note">{card.note}</p>}

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
