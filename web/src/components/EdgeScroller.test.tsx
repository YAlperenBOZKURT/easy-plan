import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EdgeScroller from './EdgeScroller.tsx';

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: true }),
}));

describe('EdgeScroller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('masaüstünde eski 550 ms hızıyla birer gün ilerler', () => {
    const onFlip = vi.fn();
    const view = render(<EdgeScroller side="right" onFlip={onFlip} />);

    vi.advanceTimersByTime(549);
    expect(onFlip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlip).toHaveBeenCalledTimes(1);
    expect(onFlip).toHaveBeenLastCalledWith(1);

    vi.advanceTimersByTime(549);
    expect(onFlip).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onFlip).toHaveBeenCalledTimes(2);

    view.unmount();
    vi.advanceTimersByTime(2_000);
    expect(onFlip).toHaveBeenCalledTimes(2);
  });

  it('web mobil görünümünde Flutter ile aynı 650 ms hızını kullanır', () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const onFlip = vi.fn();

    const view = render(<EdgeScroller side="left" onFlip={onFlip} />);
    vi.advanceTimersByTime(649);
    expect(onFlip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlip).toHaveBeenCalledTimes(1);
    expect(onFlip).toHaveBeenLastCalledWith(-1);

    view.unmount();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
  });
});
