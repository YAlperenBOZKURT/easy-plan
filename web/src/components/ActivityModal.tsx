import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { CardActivity, CardActivityAction } from '../lib/types.ts';

const actionLabels: Record<CardActivityAction, string> = {
  created: 'kartı oluşturdu',
  updated: 'kartı düzenledi',
  moved: 'kartı taşıdı',
  completed: 'kartı tamamladı',
  reopened: 'kartı yeniden açtı',
  archived: 'kartı arşivledi',
  trashed: 'kartı çöpe attı',
  restored: 'kartı geri yükledi',
  deleted: 'kartı kalıcı olarak sildi',
  duplicated: 'kartı çoğalttı',
};

const fieldLabels: Record<string, string> = {
  day: 'gün', title: 'başlık', note: 'not', startTime: 'başlangıç', endTime: 'bitiş',
  color: 'renk', done: 'durum', checklist: 'checklist', priority: 'öncelik',
  deadlineAt: 'son tarih', tags: 'etiketler',
};

function detail(activity: CardActivity): string | null {
  if (activity.action === 'moved') {
    const from = activity.details.fromDay;
    const to = activity.details.toDay;
    return typeof from === 'string' && typeof to === 'string' && from !== to
      ? `${from} → ${to}`
      : 'Kart sırası değiştirildi';
  }
  const fields = activity.details.fields;
  if (Array.isArray(fields) && fields.length > 0) {
    return fields.map((field) => fieldLabels[String(field)] ?? String(field)).join(', ');
  }
  return null;
}

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
  const [activities, setActivities] = useState<CardActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
            <h2 className="modal-title" id="activity-title">Etkinlik geçmişi</h2>
            {cardTitle && <small className="activity-subtitle">{cardTitle}</small>}
          </div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <div className="modal-body activity-body">
          {!loading && !error && activities.length === 0 && <div className="activity-empty">Henüz etkinlik yok.</div>}
          {activities.map((activity) => {
            const extra = detail(activity);
            const actor = activity.actor?.name || activity.actor?.email || 'Silinmiş kullanıcı';
            return (
              <article className={`activity-item activity-${activity.action}`} key={activity.id}>
                <span className="activity-dot" aria-hidden="true" />
                <div>
                  <p><strong>{actor}</strong> {actionLabels[activity.action]}</p>
                  <h3>{activity.cardTitle || 'Başlıksız kart'}</h3>
                  {extra && <small>{extra}</small>}
                  <time dateTime={activity.createdAt}>{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.createdAt))}</time>
                </div>
              </article>
            );
          })}
          {error && <p className="form-error" role="alert">Etkinlik geçmişi yüklenemedi.</p>}
          {loading && <div className="activity-loading"><span className="spinner spinner-sm" /> Yükleniyor…</div>}
          {!loading && cursor && <button className="btn" onClick={() => void load(cursor)}>Daha eski etkinlikleri yükle</button>}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Kapat</button></div>
      </div>
    </div>
  );
}
