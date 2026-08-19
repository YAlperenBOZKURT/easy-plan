import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  MeasuringStrategy,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { api } from '../lib/api.ts';
import { addDays, addYears, dayNameShort, dayNumber, rangeLabel, todayKey } from '../lib/dates.ts';
import { centeredColumnScrollLeft, closestDayToViewportCenter } from '../lib/mobileDayNavigation.ts';
import type { Card, User } from '../lib/types.ts';
import { navigate } from '../App.tsx';
import DayColumn from '../components/DayColumn.tsx';
import CardModal, { type CardDraft } from '../components/CardModal.tsx';
import CardViewModal from '../components/CardViewModal.tsx';
import EdgeScroller from '../components/EdgeScroller.tsx';
import HabitModal from '../components/HabitModal.tsx';
import SettingsModal from '../components/SettingsModal.tsx';
import TopMenu from '../components/TopMenu.tsx';
import { isChecklistComplete, toggleChecklistItem } from '../lib/checklist.ts';
import CardSearchModal from '../components/CardSearchModal.tsx';

const VISIBLE_DAYS = 7;

export default function Planner({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const today = todayKey();

  /** Pencerenin ilk günü — varsayılan olarak bugün, oklarla birer gün kayar. */
  const [anchor, setAnchor] = useState(today);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [showHabits, setShowHabits] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [inspect, setInspect] = useState<Card | null>(null);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [fastNav, setFastNav] = useState(false);
  const [panDir, setPanDir] = useState(0); // -1 geri, +1 ileri (renkli geri bildirim)
  const fastNavRef = useRef(false);
  fastNavRef.current = fastNav;
  /** Gün aralığı değişince mobil panoda tekrar görünür yapılacak gün. */
  const pendingScroll = useRef<string | null>(null);
  const draggingRef = useRef(false); // touch işleyicileri anlık durumu görsün
  const [activeDay, setActiveDay] = useState(today);
  const boardRef = useRef<HTMLDivElement>(null);

  /**
   * Ekrana kaç gün sığıyorsa o kadarı gösterilir: kolonlar daralıp okunmaz
   * hâle gelmez, gün sayısı azalır. Telefonda tek gün + kaydırma modeli için
   * her zaman 7 kolon basılır (kaydırarak gezinme onlara dayanıyor).
   */
  const [visibleDays, setVisibleDays] = useState(VISIBLE_DAYS);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      const width = board.clientWidth;
      if (window.innerWidth <= 767) {
        setVisibleDays(VISIBLE_DAYS);
        return;
      }
      const gap = 12;
      const minColumn = 190;
      const fits = Math.floor((width + gap) / (minColumn + gap));
      setVisibleDays(Math.max(1, Math.min(VISIBLE_DAYS, fits)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const days = useMemo(
    () => Array.from({ length: visibleDays }, (_, i) => addDays(anchor, i)),
    [anchor, visibleDays],
  );
  const from = days[0]!;
  const to = days[days.length - 1]!;

  const minDay = addYears(today, -1);
  const maxDay = addYears(today, 1);
  const canGoBack = from > minDay;
  const canGoForward = to < maxDay;

  const shift = (delta: number) => {
    setAnchor((current) => {
      const next = addDays(current, delta);
      if (next < minDay || addDays(next, days.length - 1) > maxDay) return current;
      return next;
    });
    setOpenCardId(null);
  };

  const cards = useQuery({
    queryKey: ['cards', from, to],
    queryFn: () => api.cards(from, to),
    placeholderData: (previous) => previous,
    // Başka cihazdan (telefon/masaüstü) yapılan değişiklik kendiliğinden gelsin.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Card[]>(days.map((day) => [day, []]));
    for (const card of cards.data?.cards ?? []) map.get(card.day)?.push(card);
    for (const list of map.values()) list.sort((a, b) => a.sortIndex - b.sortIndex);
    return map;
  }, [cards.data, days]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['cards'] });

  const toggleDone = useMutation({
    mutationFn: (card: Card) => api.updateCard(card.id, { done: !card.done }),
    onSuccess: refresh,
  });

  const toggleChecklist = useMutation({
    mutationFn: ({ card, itemId }: { card: Card; itemId: string }) => {
      const checklist = toggleChecklistItem(card.checklist, itemId);
      return api.updateCard(card.id, {
        checklist,
        done: isChecklistComplete(checklist),
      });
    },
    onSuccess: refresh,
  });

  const removeCard = useMutation({
    mutationFn: (card: Card) => api.deleteCard(card.id),
    onSuccess: refresh,
  });

  const move = useMutation({
    mutationFn: (input: { id: string; day: string; beforeId: string | null; afterId: string | null }) =>
      api.moveCard(input.id, { day: input.day, beforeId: input.beforeId, afterId: input.afterId }),
    onSuccess: refresh,
    onError: refresh,
  });

  /* ------------------------------------------------------------- klavye */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (draft || showHabits || showSettings || showSearch) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        setShowSearch(true);
        return;
      }
      if (event.key === 'ArrowLeft') shift(-1);
      if (event.key === 'ArrowRight') shift(1);
      if (event.key === 'Escape') setOpenCardId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anchor, draft, showHabits, showSearch, showSettings]);

  /* ------------------------------------------- mobil: kaydırma ↔ gün şeridi */

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    let frame: number | null = null;
    const syncActiveDay = () => {
      frame = null;
      const boardRect = board.getBoundingClientRect();
      const columns = Array.from(board.querySelectorAll<HTMLElement>('.col[data-day]')).flatMap(
        (column) => {
          const day = column.dataset.day;
          if (!day) return [];
          const rect = column.getBoundingClientRect();
          return [{ day, left: rect.left, width: rect.width }];
        },
      );
      const day = closestDayToViewportCenter(boardRect.left, board.clientWidth, columns);
      if (day) setActiveDay(day);
    };
    const onScroll = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncActiveDay);
    };

    board.addEventListener('scroll', onScroll, { passive: true });
    syncActiveDay();
    return () => {
      board.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [days]);

  /**
   * Masaüstünde 7 kolon aynı anda göründüğü için kaydırılacak bir taşma yok;
   * touchpad'de yatay kaydırma (veya Shift+tekerlek) ve dokunmatik ekranda
   * parmakla sürükleme günü kaydırsın.
   */
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const scrollable = () => board.scrollWidth > board.clientWidth + 1; // mobil düzen
    let wheelTotal = 0;
    const STEP = 90;

    /**
      * Tekerlekle gezinme.
      *  - Her zaman: touchpad'de yatay kaydırma ya da Shift+tekerlek.
      *  - "Hızlı gezme" açıkken: düz tekerlek de gün geçirir (bir tık = bir gün),
      *    kolon içi dikey kaydırmaya karışmamak için yalnızca kolon dışındayken.
      */
    const onWheel = (event: WheelEvent) => {
      if (scrollable()) return;
      const target = event.target as HTMLElement | null;
      const insideColumn = Boolean(target?.closest('.col-body'));

      let amount =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      let step = STEP;

      if (!amount && fastNavRef.current && !insideColumn) {
        amount = event.deltaY;
        step = 50; // bir tık = bir gün
      }
      if (!amount) return;

      event.preventDefault();
      wheelTotal += amount;
      const steps = Math.trunc(wheelTotal / step);
      if (steps !== 0) {
        wheelTotal -= steps * step;
        shift(steps > 0 ? 1 : -1);
      }
    };

    /**
     * Parmakla gün değiştirme.
     *  - Mobil düzende gezinmeyi tarayıcının yatay kaydırması yapar; biz yalnızca
     *    UÇLARDA devreye gireriz: ilk günün solunda ya da son günün sağında
     *    kaydırınca pencere bir gün kayar, böylece hafta sınırına takılmazsın.
     *  - Dokunmatik masaüstünde ise kaydırılacak taşma yok, doğrudan gün değiştirir.
     */
    let touchStartX: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchStartX = event.touches[0]?.clientX ?? null;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const from = touchStartX;
      touchStartX = null;
      if (from === null || draggingRef.current) return;
      const delta = (event.changedTouches[0]?.clientX ?? from) - from;
      if (Math.abs(delta) < 45) return;

      if (!scrollable()) {
        shift(delta < 0 ? 1 : -1);
        return;
      }

      const width = board.clientWidth || 1;
      const atStart = board.scrollLeft <= 2;
      const atEnd = board.scrollLeft >= board.scrollWidth - width - 2;
      if (atStart && delta > 0) {
        pendingScroll.current = days[0]!; // aynı gün yeni aralıkta 1. indekse geçer
        shift(-1);
      } else if (atEnd && delta < 0) {
        pendingScroll.current = days[days.length - 1]!; // aynı gün bir önceki indekse geçer
        shift(1);
      }
    };

    /**
     * Masaüstünde fareyle sürükleyerek gezinme: boş alanda sol tuş ya da her yerde
     * orta tuş. "Hızlı gezme" açıkken eşik küçülür, gün gün uçarsın.
     */
    const onMouseDown = (event: MouseEvent) => {
      if (scrollable()) return; // mobil düzende gerek yok
      // Orta tuş her yerde gezinir; sol tuş yalnızca boş alanda.
      // Kart sürükle-bırak HER ZAMAN açık kalır.
      const middle = event.button === 1;
      const target = event.target as HTMLElement | null;
      const onControl = target?.closest('.card, .btn, .add-btn, .menu, input, textarea, select');
      if (!middle && (event.button !== 0 || onControl)) return;
      event.preventDefault();

      let total = 0;
      let moved = 0;
      const onMove = (move: MouseEvent) => {
        total += move.movementX;
        moved += Math.abs(move.movementX);
        if (moved > 6) setPanDir(move.movementX > 0 ? 1 : -1);
        const step = fastNavRef.current ? 38 : 95; // hızlı gezmede daha kısa mesafe
        while (Math.abs(total) >= step) {
          shift(total > 0 ? 1 : -1); // sağa çekmek ileri (yeşil), sola geri (kırmızı)
          total -= Math.sign(total) * step;
        }
      };
      const onUp = () => {
        setPanDir(0);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    board.addEventListener('wheel', onWheel, { passive: false });
    board.addEventListener('touchstart', onTouchStart, { passive: true });
    board.addEventListener('touchend', onTouchEnd, { passive: true });
    board.addEventListener('mousedown', onMouseDown);
    // Orta tuşun tarayıcı otomatik kaydırmasını kapat
    const blockAuxClick = (event: MouseEvent) => event.button === 1 && event.preventDefault();
    board.addEventListener('auxclick', blockAuxClick);
    return () => {
      board.removeEventListener('wheel', onWheel);
      board.removeEventListener('touchstart', onTouchStart);
      board.removeEventListener('touchend', onTouchEnd);
      board.removeEventListener('mousedown', onMouseDown);
      board.removeEventListener('auxclick', blockAuxClick);
    };
  }, [days, minDay, maxDay]);

  // Aralık değiştiğinde hedef günü gerçek kolon konumuyla yeniden göster.
  useEffect(() => {
    const board = boardRef.current;
    const targetDay = pendingScroll.current;
    if (!board || targetDay === null) return;
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => scrollToDay(targetDay, 'auto'));
    return () => cancelAnimationFrame(frame);
  }, [days]);

  const scrollToDay = (day: string, behavior: ScrollBehavior = 'smooth') => {
    const board = boardRef.current;
    if (!board) return;
    const column = Array.from(board.querySelectorAll<HTMLElement>('.col[data-day]')).find(
      (element) => element.dataset.day === day,
    );
    if (!column) return;

    const boardRect = board.getBoundingClientRect();
    const columnRect = column.getBoundingClientRect();
    const left = centeredColumnScrollLeft(
      board.scrollLeft,
      boardRect.left,
      board.clientWidth,
      columnRect.left,
      columnRect.width,
    );
    board.scrollTo({ left, behavior });
    setActiveDay(day);
  };

  /** Mobilde mevcut 7 günlük pencere içinde gerçek kolona geç; pencerenin
   * ucundaysa aralığı bir gün kaydırıp yine doğru kolonu görünür tut. */
  const navigateDay = (delta: number) => {
    if (window.innerWidth > 767) {
      shift(delta);
      return;
    }

    const currentIndex = Math.max(0, days.indexOf(activeDay));
    const nextIndex = currentIndex + delta;
    if (nextIndex >= 0 && nextIndex < days.length) {
      setOpenCardId(null);
      scrollToDay(days[nextIndex]!);
      return;
    }

    if ((delta < 0 && !canGoBack) || (delta > 0 && !canGoForward)) return;
    const targetDay = addDays(days[currentIndex]!, delta);
    pendingScroll.current = targetDay;
    setActiveDay(targetDay);
    shift(delta);
  };

  /* ----------------------------------------------------- sürükle ve bırak */

  /**
   * Fare ve dokunmatik ayrı sensörlerle ele alınır. Tek bir PointerSensor kullanılırsa
   * telefonda tarayıcı kaydırmayı devralıyor ve sürükleme daha başlamadan iptal oluyor.
   * Dokunmatikte karta kısa bir an (~0,15 sn) basılı tutunca sürükleme başlar;
   * kartlardaki `touch-action: pan-x` sayesinde tarayıcı dikey hareketi çalmaz.
   */
  // Not: sensör dizisi HER RENDERDA aynı boyutta kalmalı — dnd-kit bu diziyi
  // doğrudan bağımlılık dizisi olarak kullanıyor. Hızlı gezmede sürüklemeyi
  // kapatmak için kartlara `disabled` veriyoruz (aşağıda dragDisabled).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  /**
   * Bırakma hedefi imlecin (parmağın) bulunduğu yere göre seçilir. Köşe tabanlı
   * varsayılan yöntem, geniş sürükleme katmanında komşu güne kayabiliyor.
   */
  const collisionDetection: CollisionDetection = (args) => {
    const underPointer = pointerWithin(args);
    // Kenar şeridi imlecin altındaysa her zaman o kazanır; altındaki kolon
    // "merkeze daha yakın" diye öne geçmesin.
    const edge = underPointer.find((hit) => String(hit.id).startsWith('edge:'));
    if (edge) return [edge];
    return underPointer.length > 0 ? underPointer : closestCenter(args);
  };

  const findCard = (id: string) => (cards.data?.cards ?? []).find((card) => card.id === id);

  function onDragStart(event: DragStartEvent) {
    setOpenCardId(null);
    draggingRef.current = true;
    setDragging(findCard(String(event.active.id)) ?? null);
  }

  /**
   * Bırakma yeri, sürüklenen kartın ekrandaki son konumundan hesaplanır.
   *
   * dnd-kit'in `over` bilgisine güvenilmiyor: sıralanabilir listede kart kendi yer
   * tutucusunun üstüne düştüğünde `over` kartın kendisi olarak geliyor ve taşıma
   * sessizce iptal oluyordu. Geometri hem masaüstünde hem dokunmatikte kullanıcının
   * gördüğü sonucu verir.
   */
  function onDragEnd(event: DragEndEvent) {
    draggingRef.current = false;
    setDragging(null);
    const { active, over } = event;
    const card = findCard(String(active.id));
    if (!card) return;

    const rect = active.rect.current.translated;
    const centerX = rect ? rect.left + rect.width / 2 : null;
    const centerY = rect ? rect.top + rect.height / 2 : null;

    // 1) Hedef gün: kartın merkezi hangi kolonun içinde kaldıysa orası.
    let targetDay: string | undefined;
    if (centerX !== null) {
      for (const element of document.querySelectorAll<HTMLElement>('.col[data-day]')) {
        const bounds = element.getBoundingClientRect();
        if (centerX >= bounds.left && centerX <= bounds.right) {
          targetDay = element.dataset.day;
          break;
        }
      }
    }
    if (!targetDay && over) {
      const overId = String(over.id);
      targetDay = overId.startsWith('col:') ? overId.slice(4) : findCard(overId)?.day;
    }
    if (!targetDay || !days.includes(targetDay)) return;

    // 2) Sıra: hedef kolondaki kartların dikey ortalarıyla karşılaştır.
    const others = (byDay.get(targetDay) ?? []).filter((c) => c.id !== card.id);
    let insertAt = others.length;
    if (centerY !== null) {
      insertAt = 0;
      for (const other of others) {
        const element = document.querySelector<HTMLElement>(`[data-card-id="${other.id}"]`);
        const bounds = element?.getBoundingClientRect();
        if (!bounds || bounds.top + bounds.height / 2 >= centerY) break;
        insertAt += 1;
      }
    }

    const beforeId = others[insertAt - 1]?.id ?? null;
    const afterId = others[insertAt]?.id ?? null;

    // Aynı yere bırakıldıysa sunucuyu meşgul etme.
    const current = byDay.get(card.day) ?? [];
    const position = current.findIndex((c) => c.id === card.id);
    if (
      card.day === targetDay &&
      (current[position - 1]?.id ?? null) === beforeId &&
      (current[position + 1]?.id ?? null) === afterId
    ) {
      return;
    }

    move.mutate({ id: card.id, day: targetDay, beforeId, afterId });
  }

  /* ------------------------------------------------------------- görünüm */

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn btn-icon" onClick={() => navigateDay(-1)} disabled={!canGoBack} aria-label="Önceki gün">
          ‹
        </button>
        <button className="btn btn-icon" onClick={() => navigateDay(1)} disabled={!canGoForward} aria-label="Sonraki gün">
          ›
        </button>
        <button
          className="btn"
          onClick={() => {
            if (days.includes(today)) {
              scrollToDay(today);
            } else {
              pendingScroll.current = today;
              setAnchor(today);
              setActiveDay(today);
            }
          }}
        >
          Bugün
        </button>
        <span className="topbar-range">{rangeLabel(from, to)}</span>

        <div className="spacer" />

        <button className="btn search-open" onClick={() => setShowSearch(true)} aria-label="Kartlarda ara">
          <span aria-hidden="true">⌕</span>
          <span className="desktop-only">Ara</span>
        </button>

        {/* Yalnızca masaüstünde: sürükleyerek hızlı gün gezme */}
        <button
          className={`btn desktop-only${fastNav ? ' fast-on' : ''}`}
          onClick={() => setFastNav((v) => !v)}
          title="Açıkken fare tekerleği gün geçirir; orta tuşla sürüklemek de hızlanır"
        >
          ⚡ Hızlı gezme
        </button>

        <TopMenu
          actions={[
            { label: 'Davranış ekle', color: 'var(--c-violet)', onSelect: () => setShowHabits(true) },
            { label: 'Ayarlar', color: 'var(--c-blue)', onSelect: () => setShowSettings(true) },
            ...(user.role === 'admin'
              ? [{ label: 'Yönetim', color: 'var(--c-teal)', onSelect: () => navigate('/admin') }]
              : []),
            {
              label: 'Çıkış',
              danger: true,
              onSelect: async () => {
                await api.logout();
                queryClient.clear();
                navigate('/');
              },
            },
          ]}
        />
      </header>

      <nav className="day-strip" aria-label="Gün seçimi">
        {days.map((day) => (
          <button
            key={day}
            className={`strip-day${day === activeDay ? ' on' : ''}`}
            onClick={() => scrollToDay(day)}
            aria-current={day === today ? 'date' : undefined}
            aria-pressed={day === activeDay}
          >
            <em>{dayNameShort(day)}</em>
            <b>{dayNumber(day)}</b>
          </button>
        ))}
      </nav>

      {cards.isLoading && (
        <div className="status-banner" role="status" aria-live="polite">
          <span className="spinner spinner-sm" aria-hidden="true" />
          Kartlar yükleniyor…
        </div>
      )}
      {cards.isError && (
        <div className="status-banner danger" role="alert">
          <span>Kartlar alınamadı. Bağlantını kontrol edip tekrar dene.</span>
          <button className="btn btn-sm" onClick={() => cards.refetch()}>
            Yeniden dene
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        /* Mobil web'i bir anda listenin sonuna atan piksel bazlı otomatik
           kaydırmayı kapat. Gün geçişini yalnızca EdgeScroller birer gün yapar. */
        autoScroll={false}
        /* Sürüklerken kenar şeritleri sonradan ekleniyor ve gün penceresi
           kayınca kolonlar değişiyor: bırakma hedefleri sürekli ölçülmeli. */
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          draggingRef.current = false;
          setDragging(null);
        }}
      >
        {panDir !== 0 && (
          <div className={`pan-hint ${panDir > 0 ? 'fwd' : 'back'}`}>
            {panDir > 0 ? '▶ ileri' : '◀ geri'}
          </div>
        )}

        {/* Sürüklerken kenara götürünce gün penceresi kayar */}
        {dragging && <EdgeScroller side="left" onFlip={navigateDay} />}
        {dragging && <EdgeScroller side="right" onFlip={navigateDay} />}

        <div
          className={`board${panDir !== 0 ? ' panning' : ''}`}
          ref={boardRef}
          aria-busy={cards.isLoading || cards.isFetching}
        >
          {days.map((day) => (
            <DayColumn
              key={day}
              day={day}
              cards={byDay.get(day) ?? []}
              isToday={day === today}
              isPast={day < today}
              openCardId={openCardId}
              onToggleOpen={(id) => setOpenCardId((current) => (current === id ? null : id))}
              onAdd={(target) => setDraft({ day: target })}
              onEdit={(card) => setDraft({ card, day: card.day })}
              onInspect={(card) => setInspect(card)}
              onToggleDone={(card) => toggleDone.mutate(card)}
              onToggleChecklist={(card, itemId) => toggleChecklist.mutate({ card, itemId })}
              onDelete={(card) => removeCard.mutate(card)}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div
              className="card lifted"
              style={{ ['--c' as string]: `var(--c-${dragging.color})` }}
            >
              {dragging.startTime && <span className="time-badge">{dragging.startTime}</span>}
              <p className="card-title">{dragging.title}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {inspect && (
        <CardViewModal
          card={inspect}
          onClose={() => setInspect(null)}
          onEdit={() => {
            setDraft({ card: inspect, day: inspect.day });
            setInspect(null);
          }}
        />
      )}
      {draft && <CardModal draft={draft} onClose={() => setDraft(null)} onSaved={refresh} />}
      {showHabits && <HabitModal onClose={() => setShowHabits(false)} />}
      {showSettings && <SettingsModal user={user} onClose={() => setShowSettings(false)} />}
      {showSearch && (
        <CardSearchModal
          onClose={() => setShowSearch(false)}
          onSelect={(card) => {
            setShowSearch(false);
            setInspect(card);
          }}
        />
      )}
    </div>
  );
}
