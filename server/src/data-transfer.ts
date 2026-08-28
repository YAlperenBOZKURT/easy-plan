import { isChecklistComplete, sanitizeChecklist } from './checklist.ts';
import { sanitizeOffsets } from './reminders.ts';
import { sanitizeTags } from './tags.ts';
import { addDays, isValidDay, isValidInstant, isValidTime } from './time.ts';
import { CARD_COLORS, CARD_PRIORITIES, type CardPriority, type ChecklistItem } from './types.ts';
import type { CardDto } from './dto.ts';

export const TRANSFER_FORMATS = ['json', 'csv', 'ics'] as const;
export type TransferFormat = (typeof TRANSFER_FORMATS)[number];
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_CARDS = 1000;

export interface TransferCard {
  day: string;
  title: string;
  note: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
  done: boolean;
  priority: CardPriority;
  deadlineAt: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  reminders: number[];
}

export interface ImportResult {
  cards: TransferCard[];
  errors: Array<{ row: number; error: string }>;
}

const transferCard = (card: CardDto): TransferCard => ({
  day: card.day,
  title: card.title,
  note: card.note,
  startTime: card.startTime,
  endTime: card.endTime,
  color: card.color,
  done: card.done,
  priority: card.priority,
  deadlineAt: card.deadlineAt,
  tags: card.tags,
  checklist: card.checklist,
  reminders: card.reminders,
});

const csvCell = (value: unknown): string => {
  const raw = String(value ?? '');
  // Excel/LibreOffice formül enjeksiyonunu engelle; importer bu koruma
  // apostrofünü geri kaldırdığı için Easy Plan round-trip'i değişmez.
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

const icsEscape = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const icsUnescape = (value: string): string => value
  .replace(/\\[nN]/g, '\n')
  .replace(/\\([\\,;])/g, '$1');

const compactInstant = (value: string): string => value.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const compactLocal = (day: string, time: string): string => `${day.replace(/-/g, '')}T${time.replace(':', '')}00`;

function readIcs(text: string): Record<string, unknown>[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events: Record<string, unknown>[] = [];
  let event: Record<string, string> | undefined;
  for (const line of unfolded.split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') {
      event = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (event) {
        const start = event.DTSTART ?? '';
        const end = event.DTEND ?? '';
        const day = /^\d{8}/.test(start)
          ? `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`
          : '';
        const timeOf = (value: string) => value.includes('T')
          ? `${value.slice(9, 11)}:${value.slice(11, 13)}`
          : null;
        let checklist: unknown = [];
        try { checklist = JSON.parse(icsUnescape(event['X-EASY-PLAN-CHECKLIST'] ?? '[]')); } catch { checklist = []; }
        events.push({
          day,
          title: icsUnescape(event.SUMMARY ?? ''),
          note: icsUnescape(event.DESCRIPTION ?? ''),
          startTime: timeOf(start),
          endTime: timeOf(end),
          color: event['X-EASY-PLAN-COLOR'],
          priority: event['X-EASY-PLAN-PRIORITY'],
          done: event.STATUS === 'COMPLETED',
          deadlineAt: event['X-EASY-PLAN-DEADLINE'] || null,
          tags: (event.CATEGORIES ?? '').split(/(?<!\\),/).filter(Boolean).map(icsUnescape),
          checklist,
          reminders: (event['X-EASY-PLAN-REMINDERS'] ?? '').split(',').filter(Boolean).map(Number),
        });
      }
      event = undefined;
      continue;
    }
    if (!event) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(';')[0]!;
    event[key] = line.slice(colon + 1);
  }
  return events;
}

function normalizeCard(raw: unknown): TransferCard | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  if (typeof input.day !== 'string' || !isValidDay(input.day)) return undefined;
  const startTime = input.startTime == null || input.startTime === '' ? null : input.startTime;
  const endTime = input.endTime == null || input.endTime === '' ? null : input.endTime;
  if (startTime !== null && (typeof startTime !== 'string' || !isValidTime(startTime))) return undefined;
  if (endTime !== null && (typeof endTime !== 'string' || !isValidTime(endTime))) return undefined;
  const checklist = sanitizeChecklist(input.checklist ?? []);
  const tags = sanitizeTags(input.tags ?? []);
  if (!checklist.valid || !tags.valid) return undefined;
  const deadline = input.deadlineAt ?? null;
  if (deadline !== null && deadline !== '' && (typeof deadline !== 'string' || !isValidInstant(deadline))) {
    return undefined;
  }
  const color = typeof input.color === 'string' && (CARD_COLORS as readonly string[]).includes(input.color)
    ? input.color
    : 'blue';
  const priority = typeof input.priority === 'string' && (CARD_PRIORITIES as readonly string[]).includes(input.priority)
    ? input.priority as CardPriority
    : 'none';
  return {
    day: input.day,
    title: typeof input.title === 'string' ? input.title.slice(0, 200) : '',
    note: typeof input.note === 'string' ? input.note.slice(0, 5000) : '',
    startTime,
    endTime,
    color,
    done: checklist.items.length > 0 ? isChecklistComplete(checklist.items) : input.done === true,
    priority,
    deadlineAt: typeof deadline === 'string' && deadline ? new Date(deadline).toISOString() : null,
    tags: tags.tags,
    checklist: checklist.items,
    reminders: sanitizeOffsets(input.reminders ?? []),
  };
}

export function exportCards(cards: CardDto[], format: TransferFormat, exportedAt = new Date().toISOString()): string {
  const values = cards.map(transferCard);
  if (format === 'json') {
    return JSON.stringify({ version: 1, application: 'Easy Plan', exportedAt, cards: values }, null, 2);
  }
  if (format === 'csv') {
    const header = [
      'day', 'title', 'note', 'startTime', 'endTime', 'color', 'done', 'priority',
      'deadlineAt', 'tags', 'checklist', 'reminders',
    ];
    const rows = values.map((card) => [
      card.day, card.title, card.note, card.startTime, card.endTime, card.color,
      card.done, card.priority, card.deadlineAt, card.tags.join(';'),
      JSON.stringify(card.checklist), card.reminders.join(';'),
    ]);
    return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }
  const timestamp = compactInstant(exportedAt);
  const events = values.map((card, index) => {
    const lines = [
      'BEGIN:VEVENT',
      `UID:easy-plan-${index}-${card.day}@easy-plan`,
      `DTSTAMP:${timestamp}`,
      card.startTime ? `DTSTART:${compactLocal(card.day, card.startTime)}` : `DTSTART;VALUE=DATE:${card.day.replace(/-/g, '')}`,
      card.endTime ? `DTEND:${compactLocal(card.day, card.endTime)}` : `DTEND;VALUE=DATE:${addDays(card.day, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsEscape(card.title || 'Untitled card')}`,
      `DESCRIPTION:${icsEscape(card.note)}`,
      `STATUS:${card.done ? 'COMPLETED' : 'CONFIRMED'}`,
      `X-EASY-PLAN-COLOR:${card.color}`,
      `X-EASY-PLAN-PRIORITY:${card.priority}`,
      `X-EASY-PLAN-CHECKLIST:${icsEscape(JSON.stringify(card.checklist))}`,
      `X-EASY-PLAN-REMINDERS:${card.reminders.join(',')}`,
    ];
    if (card.tags.length > 0) lines.push(`CATEGORIES:${card.tags.map(icsEscape).join(',')}`);
    if (card.deadlineAt) lines.push(`X-EASY-PLAN-DEADLINE:${card.deadlineAt}`);
    lines.push('END:VEVENT');
    return lines.join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Easy Plan//Planner Export//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

export function importCards(input: Buffer, format: TransferFormat): ImportResult {
  const text = input.toString('utf8').replace(/^\uFEFF/, '');
  let rawCards: unknown[] = [];
  if (format === 'json') {
    const parsed: unknown = JSON.parse(text);
    rawCards = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { cards?: unknown }).cards)
        ? (parsed as { cards: unknown[] }).cards
        : [];
  } else if (format === 'csv') {
    const [header = [], ...rows] = parseCsv(text);
    const positions = new Map(header.map((name, index) => [name.trim(), index]));
    const value = (row: string[], key: string) => {
      const raw = row[positions.get(key) ?? -1] ?? '';
      return /^'[=+\-@]/.test(raw) ? raw.slice(1) : raw;
    };
    rawCards = rows.map((row) => {
      let checklist: unknown = [];
      try { checklist = JSON.parse(value(row, 'checklist') || '[]'); } catch { checklist = []; }
      return {
        day: value(row, 'day'), title: value(row, 'title'), note: value(row, 'note'),
        startTime: value(row, 'startTime') || null, endTime: value(row, 'endTime') || null,
        color: value(row, 'color'), done: value(row, 'done').toLowerCase() === 'true',
        priority: value(row, 'priority'), deadlineAt: value(row, 'deadlineAt') || null,
        tags: value(row, 'tags').split(';').filter(Boolean), checklist,
        reminders: value(row, 'reminders').split(';').filter(Boolean).map(Number),
      };
    });
  } else rawCards = readIcs(text);

  const cards: TransferCard[] = [];
  const errors: ImportResult['errors'] = [];
  for (const [index, raw] of rawCards.slice(0, MAX_IMPORT_CARDS).entries()) {
    const card = normalizeCard(raw);
    if (card) cards.push(card);
    else errors.push({ row: index + 1, error: 'invalid_card' });
  }
  if (rawCards.length > MAX_IMPORT_CARDS) {
    errors.push({ row: MAX_IMPORT_CARDS + 1, error: 'import_limit_exceeded' });
  }
  return { cards, errors };
}

export function formatFromFile(filename: string, mimetype: string): TransferFormat | undefined {
  const extension = filename.toLowerCase().split('.').pop();
  if (extension && (TRANSFER_FORMATS as readonly string[]).includes(extension)) return extension as TransferFormat;
  if (/json/i.test(mimetype)) return 'json';
  if (/csv/i.test(mimetype)) return 'csv';
  if (/calendar|ics/i.test(mimetype)) return 'ics';
  return undefined;
}
