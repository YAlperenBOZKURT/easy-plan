import { useEffect, useRef } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import type { Card } from '../lib/types.ts';

export default function CardConflictPanel({ local, server, busy, onKeep, onUseServer, move = false }: {
  local: Card; server: Card; busy: boolean; onKeep: () => void; onUseServer: () => void; move?: boolean;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [server.updatedAt]);
  const fields = [
    ['conflict.titleField', (c: Card) => c.title],
    ['conflict.note', (c: Card) => c.note],
    ['conflict.day', (c: Card) => c.day],
    ['conflict.time', (c: Card) => [c.startTime, c.endTime].filter(Boolean).join(' – ')],
    ['conflict.color', (c: Card) => c.color],
    ['conflict.priority', (c: Card) => c.priority],
    ['conflict.deadline', (c: Card) => c.deadlineAt ?? ''],
    ['conflict.tags', (c: Card) => c.tags.join(', ')],
    ['conflict.checklist', (c: Card) => c.checklist.map(i => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n')],
    ['conflict.reminders', (c: Card) => c.reminders.join(', ')],
    ['conflict.state', (c: Card) => t(c.done ? 'conflict.done' : 'conflict.open')],
  ] as const;
  return <section ref={panel} tabIndex={-1} className="card-conflict" aria-label={t('conflict.title')}>
    <h3>{t('conflict.title')}</h3>
    <p role="alert">{t('conflict.hint')}</p>
    {move && <p>{t('conflict.move', { day: local.day })}</p>}
    <div className="conflict-table-wrap"><table>
      <thead><tr><th></th><th>{t('conflict.local')}</th><th>{t('conflict.server')}</th></tr></thead>
      <tbody>{fields.filter(([, value]) => value(local) !== value(server)).map(([label, value]) =>
        <tr key={label}><th scope="row">{t(label)}</th><td>{value(local) || '—'}</td><td>{value(server) || '—'}</td></tr>)}</tbody>
    </table></div>
    <div className="row">
      <button className="btn btn-primary" disabled={busy} onClick={onKeep}>{t('conflict.keep')}</button>
      <button className="btn" disabled={busy} onClick={onUseServer}>{t('conflict.useServer')}</button>
    </div>
  </section>;
}
