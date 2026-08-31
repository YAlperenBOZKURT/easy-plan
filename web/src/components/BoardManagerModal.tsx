import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.ts';
import type { Board, BoardMember, BoardRole } from '../lib/types.ts';

export default function BoardManagerModal({
  board,
  currentUserId,
  onClose,
  onChanged,
  onSelect,
}: {
  board: Board;
  currentUserId: string;
  onClose: () => void;
  onChanged: () => Promise<unknown> | void;
  onSelect: (board: Board) => void;
}) {
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [name, setName] = useState(board.name);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<BoardRole, 'owner'>>('editor');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = board.role === 'owner';

  const load = async () => {
    const result = await api.boardMembers(board.id);
    setMembers(result.members);
  };

  useEffect(() => { void load().catch(() => setError('Üyeler yüklenemedi.')); }, [board.id]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      await load();
      await onChanged();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'unknown';
      setError(code === 'user_not_found'
        ? 'Bu e-posta ile aktif bir Easy Plan hesabı bulunamadı.'
        : code === 'owner_already_member'
          ? 'Pano sahibi zaten üyedir.'
          : 'İşlem tamamlanamadı.');
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!window.confirm(`“${board.name}” panosu ve içindeki tüm kartlar kalıcı olarak silinsin mi?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteBoard(board.id);
      const result = await api.boards();
      const next = result.boards.find((item) => item.personal) ?? result.boards[0];
      if (next) onSelect(next);
      await onChanged();
      onClose();
    } catch (_) {
      setError('Pano silinemedi.');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal board-manager-modal" role="dialog" aria-modal="true" aria-labelledby="board-manager-title">
        <div className="modal-head">
          <h2 className="modal-title" id="board-manager-title">Pano ve paylaşım</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <div className="modal-body">
          <div className="board-create-row">
            <label className="field"><span>Yeni paylaşılan pano</span><input value={newName} maxLength={80} placeholder="Örn. Ürün ekibi" onChange={(event) => setNewName(event.target.value)} /></label>
            <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={() => void run(async () => { const result = await api.createBoard(newName.trim()); setNewName(''); onSelect(result.board); })}>Oluştur</button>
          </div>

          <label className="field">
            <span>Pano adı</span>
            <div className="row">
              <input value={name} maxLength={80} disabled={!owner} onChange={(event) => setName(event.target.value)} />
              {owner && <button className="btn" disabled={busy || !name.trim()} onClick={() => void run(() => api.updateBoard(board.id, name.trim()))}>Kaydet</button>}
            </div>
          </label>

          <div className="board-role-note">
            Yetkin: <strong>{board.role === 'owner' ? 'Sahip' : board.role === 'editor' ? 'Düzenleyici' : 'Görüntüleyici'}</strong>
          </div>

          {owner && !board.personal && (
            <div className="board-invite-row">
              <label className="field"><span>Üye e-postası</span><input type="email" value={email} placeholder="kisi@example.com" onChange={(event) => setEmail(event.target.value)} /></label>
              <label className="field board-role-field"><span>Yetki</span><select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="editor">Düzenleyici</option><option value="viewer">Görüntüleyici</option></select></label>
              <button className="btn btn-primary" disabled={busy || !email.trim()} onClick={() => void run(async () => { await api.addBoardMember(board.id, email.trim(), role); setEmail(''); })}>Ekle</button>
            </div>
          )}

          <section className="board-members" aria-label="Pano üyeleri">
            <h3>Üyeler ({members.length})</h3>
            {members.map((member) => (
              <div className="board-member" key={member.userId}>
                <div><strong>{member.name || member.email}</strong>{member.name && <span>{member.email}</span>}</div>
                {owner && member.role !== 'owner' ? (
                  <>
                    <select value={member.role} disabled={busy} aria-label={`${member.email} yetkisi`} onChange={(event) => void run(() => api.updateBoardMember(board.id, member.userId, event.target.value as 'editor' | 'viewer'))}><option value="editor">Düzenleyici</option><option value="viewer">Görüntüleyici</option></select>
                    <button className="btn btn-sm btn-red" disabled={busy} onClick={() => void run(() => api.removeBoardMember(board.id, member.userId))}>Çıkar</button>
                  </>
                ) : <span className="board-member-role">{member.role === 'owner' ? 'Sahip' : member.role === 'editor' ? 'Düzenleyici' : 'Görüntüleyici'}</span>}
              </div>
            ))}
          </section>
          {!owner && !board.personal && <button className="btn btn-red" disabled={busy} onClick={() => void run(async () => { await api.removeBoardMember(board.id, currentUserId); onClose(); })}>Panodan ayrıl</button>}
          {owner && !board.personal && <button className="btn btn-red" disabled={busy} onClick={() => void deleteSelected()}>Panoyu kalıcı sil</button>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Kapat</button></div>
      </div>
    </div>
  );
}
