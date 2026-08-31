import { dayName, dayNameShort, dayNumber, shortDate } from '../lib/dates.ts';
import { tagColorIndex } from '../lib/tags.ts';
import type { Card } from '../lib/types.ts';
import type { PlannerView } from '../lib/plannerViews.ts';

interface Props {
  view: Exclude<PlannerView, 'week'>;
  anchor: string;
  days: string[];
  cards: Card[];
  today: string;
  onAdd: (day: string) => void;
  onInspect: (card: Card) => void;
  onToggleDone: (card: Card) => void;
  readOnly?: boolean;
}

const cardTitle = (card: Card) => card.title.trim() || 'Başlıksız kart';

export default function PlannerCollectionView(props: Props) {
  if (props.view === 'month') return <MonthView {...props} />;
  return <AgendaView {...props} completed={props.view === 'completed'} />;
}

function MonthView({ anchor, days, cards, today, onAdd, onInspect, readOnly }: Props) {
  const month = anchor.slice(0, 7);
  const byDay = new Map<string, Card[]>(days.map((day) => [day, []]));
  for (const card of cards) byDay.get(card.day)?.push(card);
  for (const list of byDay.values()) list.sort((a, b) => a.sortIndex - b.sortIndex);

  return (
    <section className="month-view" aria-label="Aylık plan">
      <div className="month-weekdays" aria-hidden="true">
        {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="month-grid">
        {days.map((day) => {
          const dayCards = byDay.get(day) ?? [];
          const outside = !day.startsWith(month);
          return (
            <article
              className={`month-day${day === today ? ' today' : ''}${outside ? ' outside' : ''}`}
              key={day}
              aria-label={`${dayName(day)}, ${shortDate(day)}`}
            >
              <header>
                <div className="month-day-label">
                  <span>{dayNameShort(day)}</span>
                  <time dateTime={day}>{dayNumber(day)}</time>
                </div>
                {!readOnly && <button type="button" onClick={() => onAdd(day)} aria-label={`${shortDate(day)} için kart ekle`}>+</button>}
              </header>
              <div className="month-cards">
                {dayCards.slice(0, 3).map((card) => (
                  <button
                    type="button"
                    className={`month-card${card.done ? ' done' : ''}`}
                    style={{ ['--c' as string]: `var(--c-${card.color})` }}
                    key={card.id}
                    onClick={() => onInspect(card)}
                    title={cardTitle(card)}
                    aria-label={cardTitle(card)}
                  >
                    {card.startTime && <time>{card.startTime}</time>}
                    <span>{cardTitle(card)}</span>
                  </button>
                ))}
                {dayCards.length > 3 && <span className="month-more">+{dayCards.length - 3} kart</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AgendaView({ cards, today, completed, onInspect, onToggleDone, readOnly }: Props & { completed: boolean }) {
  const visible = cards
    .filter((card) => !completed || card.done)
    .sort((a, b) => a.day.localeCompare(b.day) || a.sortIndex - b.sortIndex);
  const groups = new Map<string, Card[]>();
  for (const card of visible) {
    const group = groups.get(card.day);
    if (group) group.push(card);
    else groups.set(card.day, [card]);
  }

  if (visible.length === 0) {
    return (
      <div className="collection-empty" role="status">
        <span aria-hidden="true">{completed ? '✓' : '☷'}</span>
        <h2>{completed ? 'Bu ay tamamlanan kart yok' : 'Bu ay ajanda boş'}</h2>
        <p>{completed ? 'Tamamladığın kartlar burada tarih sırasıyla görünür.' : 'Kart eklediğinde burada tarih sırasıyla görünür.'}</p>
      </div>
    );
  }

  return (
    <section className="agenda-view" aria-label={completed ? 'Tamamlanan kartlar' : 'Ajanda'}>
      {[...groups.entries()].map(([day, dayCards]) => (
        <section className="agenda-day" key={day}>
          <header>
            <div>
              <h2>{dayName(day)}</h2>
              <time dateTime={day}>{shortDate(day)}</time>
            </div>
            {day === today && <span className="agenda-today">Bugün</span>}
          </header>
          <div className="agenda-cards">
            {dayCards.map((card) => (
              <article
                className={`agenda-card${card.done ? ' done' : ''}`}
                style={{ ['--c' as string]: `var(--c-${card.color})` }}
                key={card.id}
              >
                <button
                  type="button"
                  className="agenda-check"
                  onClick={() => onToggleDone(card)}
                  disabled={readOnly}
                  aria-label={`${cardTitle(card)}: ${card.done ? 'geri al' : 'tamamla'}`}
                >
                  {card.done ? '✓' : ''}
                </button>
                <button type="button" className="agenda-card-main" onClick={() => onInspect(card)}>
                  <span className="agenda-card-title">{cardTitle(card)}</span>
                  {card.note && <span className="agenda-card-note">{card.note}</span>}
                  <span className="agenda-card-meta">
                    {card.startTime && <time>{card.startTime}{card.endTime ? `–${card.endTime}` : ''}</time>}
                    {card.tags.slice(0, 3).map((tag) => (
                      <em className={`tag-chip tag-color-${tagColorIndex(tag)}`} key={tag}>{tag}</em>
                    ))}
                  </span>
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
