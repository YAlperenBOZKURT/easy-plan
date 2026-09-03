import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { CardActivity, CardActivityAction } from '../lib/types.ts';
import { useI18n } from '../lib/i18n.tsx';

export default function ActivityModal({
  boardId,
  cardId,
  cardTitle,
  onClose,
}: {
  boardId: string;
  cardId?: string;
  cardTitle?: string;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [activities, setActivities] = useState<CardActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const actionLabels: Record<CardActivityAction, string> = {
    created: t('activity.created'), updated: t('activity.updated'), moved: t('activity.moved'),
    completed: t('activity.completed'), reopened: t('activity.reopened'), archived: t('activity.archived'),
    trashed: t('activity.trashed'), restored: t('activity.restored'), deleted: t('activity.deleted'),
    duplicated: t('activity.duplicated'),
  };
  const fieldLabels: Record<string, string> = {
    day: t('field.day'), title: t('field.title'), note: t('field.note'), startTime: t('field.startTime'),
    endTime: t('field.endTime'), color: t('field.color'), done: t('field.done'),
    checklist: t('field.checklist'), priority: t('field.priority'), deadlineAt: t('field.deadlineAt'), tags: t('field.tags'),
  };
  const detail = (activity: CardActivity): string | null => {
    if (activity.action === 'moved') {
      const from = activity.details.fromDay;
      const to = activity.details.toDay;
      return typeof from === 'string' && typeof to === 'string' && from !== to
        ? `${from} → ${to}` : t('activity.orderChanged');
    }
    const fields = activity.details.fields;
    return Array.isArray(fields) && fields.length > 0
      ? fields.map((field) => fieldLabels[String(field)] ?? String(field)).join(', ')
      : null;
  };

  const load = async (before?: string) => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.cardActivity({ limit: 50, before, cardId });
      setActivities((current) => before ? [...current, ...result.activities] : result.activities);
      setCursor(result.nextCursor);
    } catch (_) {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [boardId, cardId]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal activity-modal" role="dialog" aria-modal="true" aria-labelledby="activity-title">
        <div className="modal-head">
          <div>
            <h2 className="modal-title" id="activity-title">{t('activity.title')}</h2>
            {cardTitle && <small className="activity-subtitle">{cardTitle}</small>}
          </div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="modal-body activity-body">
          {!loading && !error && activities.length === 0 && <div className="activity-empty">{t('activity.empty')}</div>}
          {activities.map((activity) => {
            const extra = detail(activity);
            const actor = activity.actor?.name || activity.actor?.email || t('activity.deletedUser');
            return (
              <article className={`activity-item activity-${activity.action}`} key={activity.id}>
                <span className="activity-dot" aria-hidden="true" />
                <div>
                  <p><strong>{actor}</strong> {actionLabels[activity.action]}</p>
                  <h3>{activity.cardTitle || t('activity.untitled')}</h3>
                  {extra && <small>{extra}</small>}
                  <time dateTime={activity.createdAt}>{new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.createdAt))}</time>
                </div>
              </article>
            );
          })}
          {error && <p className="form-error" role="alert">{t('activity.failed')}</p>}
          {loading && <div className="activity-loading"><span className="spinner spinner-sm" /> {t('common.loading')}</div>}
          {!loading && cursor && <button className="btn" onClick={() => void load(cursor)}>{t('activity.loadOlder')}</button>}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>{t('common.close')}</button></div>
      </div>
    </div>
  );
}
