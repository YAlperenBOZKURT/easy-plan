import { useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';

/**
 * Sürükleme sırasında panonun sol/sağ kenarındaki şerit.
 *
 * Kartı buraya getirip beklettiğinde gün penceresi kayar, böylece ekranda
 * görünmeyen bir güne de kart taşıyabilirsin. Kendisi bırakma hedefi değildir:
 * gün geldiğinde kartı kolonun içine bırakırsın.
 */
export default function EdgeScroller({
  side,
  onFlip,
}: {
  side: 'left' | 'right';
  onFlip: (direction: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `edge:${side}` });

  /**
   * Geri çağrı ref'te tutulur: her gün kaymasında bileşen yeniden çizildiği
   * için `onFlip` kimliği değişir; bağımlılığa konursa zamanlayıcı sürekli
   * kurulup sıfırlanır ve gün penceresi kontrolsüz uçar.
   */
  const flip = useRef(onFlip);
  flip.current = onFlip;

  useEffect(() => {
    if (!isOver) return;
    const direction = side === 'left' ? -1 : 1;
    const step = () => flip.current(direction);
    // Masaüstünün eski hızı 550 ms idi. Dar web görünümünde Flutter'ın eski
    // 650 ms hızını kullan; dnd-kit'in piksel bazlı hızlı auto-scroll'u yok.
    const interval = window.innerWidth <= 767 ? 650 : 550;
    const timer = window.setInterval(step, interval);
    return () => window.clearInterval(timer);
  }, [isOver, side]);

  return (
    <div ref={setNodeRef} className={`edge-scroller ${side}${isOver ? ' on' : ''}`}>
      <span>{side === 'left' ? '‹' : '›'}</span>
    </div>
  );
}
