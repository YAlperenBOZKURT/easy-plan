import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import CardItem from './CardItem.tsx';
import { dayName, shortDate } from '../lib/dates.ts';
import type { Card } from '../lib/types.ts';

export default function DayColumn({
  day,
  cards,
  isToday,
  isPast,
  openCardId,
  onToggleOpen,
  onAdd,
  onEdit,
  onInspect,
  onToggleDone,
  onToggleChecklist,
  onDelete,
}: {
  day: string;
  cards: Card[];
  isToday: boolean;
  isPast: boolean;
  openCardId: string | null;
  onToggleOpen: (id: string) => void;
  onAdd: (day: string) => void;
  onEdit: (card: Card) => void;
  onInspect: (card: Card) => void;
  onToggleDone: (card: Card) => void;
  onToggleChecklist: (card: Card, itemId: string) => void;
  onDelete: (card: Card) => void;
}) {
  // Kolonun kendisi de bırakma hedefi: boş güne ya da kartların altına bırakılabilsin.
  const { setNodeRef, isOver } = useDroppable({ id: `col:${day}`, data: { day } });
  const headingId = `day-${day}`;

  return (
    <section
      ref={setNodeRef}
      className={`col${isToday ? ' today' : ''}${isPast ? ' past' : ''}${isOver ? ' drop-target' : ''}`}
      data-day={day}
      aria-labelledby={headingId}
    >
      <header className="col-head">
        <h2 className="col-day" id={headingId}>{dayName(day)}</h2>
        <span className="col-date">{shortDate(day)}</span>
        {isToday && <span className="today-dot" title="Bugün" aria-label="Bugün" />}
      </header>

      <div className="col-body">
        {/* Boş günde "Ekle" en üstte durur ve kolon kısacık kalır */}
        {cards.length === 0 && (
          <button className="add-btn" onClick={() => onAdd(day)}>
            + Ekle
          </button>
        )}

        {/* id = gün: bırakma hedefinin hangi güne ait olduğunu dnd-kit'ten okuyabilmek için */}
        <SortableContext id={day} items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              open={openCardId === card.id}
              onToggleOpen={() => onToggleOpen(card.id)}
              onEdit={() => onEdit(card)}
              onInspect={() => onInspect(card)}
              onToggleDone={() => onToggleDone(card)}
              onToggleChecklist={(itemId) => onToggleChecklist(card, itemId)}
              onDelete={() => onDelete(card)}
            />
          ))}
        </SortableContext>

        {cards.length > 0 && (
          <button className="add-btn" onClick={() => onAdd(day)}>
            + Ekle
          </button>
        )}
      </div>
    </section>
  );
}
