import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.ts';
import { formatDateTime } from '../lib/dates.ts';
import type { User } from '../lib/types.ts';

const KIND_LABELS: Record<string, string> = {
  reminder: 'Hatırlatma',
  daily: 'Günlük özet',
  test: 'Test',
  invite: 'Davet',
  reset: 'Şifre sıfırlama',
};

export default function SettingsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [dailySummary, setDailySummary] = useState(user.dailySummary);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mailLog = useQuery({ queryKey: ['mailLog'], queryFn: api.mailLog });

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = { name, dailySummary };
      if (newPassword) {
        patch.currentPassword = currentPassword;
        patch.newPassword = newPassword;
      }
      return api.updateMe(patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setNotice('Kaydedildi.');
      setError('');
      setCurrentPassword('');
      setNewPassword('');
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(
        code === 'wrong_password'
          ? 'Mevcut şifren hatalı.'
          : code === 'weak_password'
            ? 'Yeni şifre 12 ile 256 karakter arasında olmalı.'
            : 'Kaydedilemedi.',
      );
      setNotice('');
    },
  });

  const testMail = useMutation({
    mutationFn: api.testMail,
    onSuccess: () => {
      setNotice(`Test maili ${user.email} adresine gönderildi.`);
      setError('');
      mailLog.refetch();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(
        code === 'mail_disabled'
          ? 'SMTP ayarlanmamış (.env dosyasındaki SMTP_* değerlerini doldur).'
          : 'Mail gönderilemedi.',
      );
      setNotice('');
    },
  });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title" id="settings-modal-title">Ayarlar</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <span className="label">E-posta</span>
            <input value={user.email} disabled />
          </div>

          <div className="field">
            <label className="label" htmlFor="name">
              Ad
            </label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <label className="row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={dailySummary}
              onChange={(e) => setDailySummary(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13 }}>Her sabah 08:00'de günün özetini mail at</span>
          </label>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="current">
                Mevcut şifre
              </label>
              <input
                id="current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="new">
                Yeni şifre
              </label>
              <input
                id="new"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="row">
            <button className="btn" onClick={() => testMail.mutate()} disabled={testMail.isPending}>
              Test maili gönder
            </button>
            {mailLog.data && !mailLog.data.mailEnabled && (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>SMTP kapalı</span>
            )}
          </div>

          {notice && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c-green)' }}>{notice}</p>}
          {error && <p className="error-text" role="alert">{error}</p>}

          {(mailLog.data?.entries.length ?? 0) > 0 && (
            <div className="field">
              <span className="label">Son gönderimler</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {mailLog.data!.entries.slice(0, 10).map((entry) => (
                  <div
                    key={entry.id}
                    className="row"
                    style={{ fontSize: 12, color: 'var(--text-muted)', gap: 8 }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {KIND_LABELS[entry.kind] ?? entry.kind} · {entry.subject}
                    </span>
                    <span className={`tag ${entry.status === 'ok' ? 'ok' : 'off'}`}>{entry.status}</span>
                    <span className="num">{formatDateTime(entry.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            Kaydet
          </button>
          <button className="btn" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
