import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { dayName, shortDate } from '../lib/dates.ts';
import type { Card } from '../lib/types.ts';

type LifecycleView = 'archived' | 'trash';

export default function CardLifecycleModal({ onClose, boardId, readOnly = false }: {
  onClose: () => void;
  boardId?: string;
  readOnly?: boolean;
}) {
  const client = useQueryClient();
  const [view, setView] = useState<LifecycleView>('archived');
  const query = useQuery({
    queryKey: ['card-lifecycle', boardId, view],
    queryFn: () => view === 'archived' ? api.archivedCards() : api.trashedCards(),
  });

  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ['card-lifecycle'] }),
    client.invalidateQueries({ queryKey: ['cards'] }),
    client.invalidateQueries({ queryKey: ['tags'] }),
  ]);
  const restore = useMutation({ mutationFn: (id: string) => api.restoreCard(id), onSuccess: refresh });
  const moveToTrash = useMutation({ mutationFn: (id: string) => api.deleteCard(id), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.permanentlyDeleteCard(id), onSuccess: refresh });
  const busy = restore.isPending || moveToTrash.isPending || remove.isPending;

  const permanentlyDelete = (card: Card) => {
    if (window.confirm(`“${card.title || 'Başlıksız kart'}” kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) {
      remove.mutate(card.id);
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal lifecycle-modal" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title">
        <div className="modal-head">
          <h2 className="modal-title" id="lifecycle-title">Arşiv ve Çöp Kutusu</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">✕</button>
        </div>

        <div className="lifecycle-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'archived'} className={view === 'archived' ? 'active' : ''} onClick={() => setView('archived')}>Arşiv</button>
          <button role="tab" aria-selected={view === 'trash'} className={view === 'trash' ? 'active' : ''} onClick={() => setView('trash')}>Çöp Kutusu</button>
        </div>

        <div className="modal-body lifecycle-body">
          {query.isLoading && <p className="lifecycle-status">Kartlar yükleniyor…</p>}
          {query.isError && <p className="lifecycle-status danger">Kartlar alınamadı.</p>}
          {query.data?.cards.length === 0 && (
            <div className="lifecycle-empty">
              <span aria-hidden="true">{view === 'archived' ? '▣' : '♲'}</span>
              <h3>{view === 'archived' ? 'Arşiv boş' : 'Çöp kutusu boş'}</h3>
              <p>{view === 'archived' ? 'Saklamak istediğin kartları arşivleyebilirsin.' : 'Silinen kartlar saklama süresi boyunca burada kalır.'}</p>
            </div>
          )}
          <div className="lifecycle-list">
            {query.data?.cards.map((card) => (
              <article className="lifecycle-card" key={card.id} style={{ ['--c' as string]: `var(--c-${card.color})` }}>
                <div className="lifecycle-card-copy">
                  <small>{dayName(card.day)} · {shortDate(card.day)}</small>
                  <strong>{card.title || '(başlıksız)'}</strong>
                  {card.note && <p>{card.note}</p>}
                </div>
                {!readOnly && <div className="lifecycle-actions">
                  <button className="btn btn-sm btn-green" disabled={busy} onClick={() => restore.mutate(card.id)}>Geri yükle</button>
                  {view === 'archived' ? (
                    <button className="btn btn-sm btn-red" disabled={busy} onClick={() => moveToTrash.mutate(card.id)}>Çöpe at</button>
                  ) : (
                    <button className="btn btn-sm btn-red" disabled={busy} onClick={() => permanentlyDelete(card)}>Kalıcı sil</button>
                  )}
                </div>}
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
