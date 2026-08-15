export type DayColumnPosition = {
  day: string;
  left: number;
  width: number;
};

/** Mobil panonun merkezine en yakın gerçek kolonu bulur. */
export function closestDayToViewportCenter(
  boardLeft: number,
  boardWidth: number,
  columns: DayColumnPosition[],
): string | null {
  const center = boardLeft + boardWidth / 2;
  let closest: { day: string; distance: number } | null = null;

  for (const column of columns) {
    const distance = Math.abs(column.left + column.width / 2 - center);
    if (!closest || distance < closest.distance) closest = { day: column.day, distance };
  }

  return closest?.day ?? null;
}

/** Padding ve kolon boşluklarını hesaba katarak hedef kolonu ortalar. */
export function centeredColumnScrollLeft(
  currentScrollLeft: number,
  boardLeft: number,
  boardWidth: number,
  columnLeft: number,
  columnWidth: number,
): number {
  return Math.max(
    0,
    currentScrollLeft + columnLeft - boardLeft - (boardWidth - columnWidth) / 2,
  );
}
