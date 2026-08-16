export type DeadlineState = 'none' | 'upcoming' | 'soon' | 'overdue' | 'completed';

export function deadlineState(
  deadlineAt: string | null,
  done: boolean,
  now = new Date(),
): DeadlineState {
  if (!deadlineAt) return 'none';
  if (done) return 'completed';
  const remaining = new Date(deadlineAt).getTime() - now.getTime();
  if (remaining < 0) return 'overdue';
  if (remaining <= 24 * 60 * 60 * 1000) return 'soon';
  return 'upcoming';
}

export function deadlineLabel(deadlineAt: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(deadlineAt));
}

const pad = (value: number) => String(value).padStart(2, '0');

export function deadlineToInput(deadlineAt: string | null): string {
  if (!deadlineAt) return '';
  const date = new Date(deadlineAt);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function deadlineFromInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
