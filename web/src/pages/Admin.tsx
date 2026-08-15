import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.ts';
import { formatBytes, formatDateTime } from '../lib/dates.ts';
import type { User } from '../lib/types.ts';
import { navigate } from '../App.tsx';

/**
 * Yönetim paneli. Bilinçli sınır: burada yalnızca sayılar ve hesap bilgileri var —
 * kullanıcıların kart başlıkları, notları ve görselleri hiçbir yerde görünmez.
 */
export default function Admin({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [message, setMessage] = useState('');

  const stats = useQuery({ queryKey: ['adminStats'], queryFn: api.adminStats });
  const users = useQuery({ queryKey: ['adminUsers'], queryFn: api.adminUsers });
  const invites = useQuery({ queryKey: ['adminInvites'], queryFn: api.adminInvites });
  const mailLog = useQuery({ queryKey: ['adminMailLog'], queryFn: api.adminMailLog });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['adminStats'] });
    queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
    queryClient.invalidateQueries({ queryKey: ['adminInvites'] });
  };

  const invite = useMutation({
    mutationFn: () => api.createInvite(email.trim()),
    onSuccess: (result) => {
      setInviteUrl(result.url);
      setMessage(
        result.mailSent
          ? `Davet maili ${email} adresine gönderildi.`
          : 'Mail gönderilemedi (SMTP kapalı olabilir) — aşağıdaki bağlantıyı elle paylaşabilirsin.',
      );
      setEmail('');
      refreshAll();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setMessage(
        code === 'email_taken'
          ? 'Bu e-posta ile bir hesap zaten var.'
          : code === 'invalid_email'
            ? 'Geçerli bir e-posta gir.'
            : 'Davet oluşturulamadı.',
      );
      setInviteUrl('');
    },
  });

  const updateUser = useMutation({
    mutationFn: (input: { id: string; patch: { role?: string; active?: boolean } }) =>
      api.updateUser(input.id, input.patch),
    onSuccess: refreshAll,
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setMessage(code === 'last_admin' ? 'Sistemde en az bir admin kalmalı.' : 'İşlem yapılamadı.');
    },
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      setMessage('Hesap ve tüm verisi silindi.');
      refreshAll();
    },
  });

  const s = stats.data;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <header className="topbar">
        <button className="btn" onClick={() => navigate('/')}>
          ‹ Takvime dön
        </button>
        <span className="topbar-range">Yönetim · {user.email}</span>
      </header>

      <div className="admin-page">
        <div className="stats">
          <Stat label="Kullanıcı" value={s?.users} />
          <Stat label="Aktif (30 gün)" value={s?.activeUsers} />
          <Stat label="Kart" value={s?.cards} />
          <Stat label="Davranış" value={s?.habits} />
          <Stat label="Görsel" value={s?.images} />
          <Stat label="Görsel alanı" value={s ? formatBytes(s.imageBytes) : undefined} />
          <Stat label="Veritabanı" value={s ? formatBytes(s.dbBytes) : undefined} />
          <Stat label="Bekleyen hatırlatma" value={s?.pendingReminders} />
        </div>

        <div className="panel">
          <div className="panel-head">
            Davet gönder
            {s && !s.mailEnabled && <span className="tag off">SMTP kapalı</span>}
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row">
              <input
                type="email"
                placeholder="ornek@mail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && email.trim() && invite.mutate()}
              />
              <button
                className="btn btn-primary"
                onClick={() => invite.mutate()}
                disabled={invite.isPending || !email.trim()}
              >
                Davet gönder
              </button>
            </div>
            {message && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>{message}</p>}
            {inviteUrl && (
              <div className="row">
                <input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn" onClick={() => navigator.clipboard.writeText(inviteUrl)}>
                  Kopyala
                </button>
              </div>
            )}
            {(invites.data?.invites.length ?? 0) > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Bekleyen davetler:{' '}
                {invites.data!.invites.map((i) => i.email).join(', ')}
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">Kullanıcılar</div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Kişi</th>
                  <th>Rol</th>
                  <th>Son giriş</th>
                  <th className="num">Kart</th>
                  <th className="num">Görsel</th>
                  <th className="num">Alan</th>
                  <th className="num">Hatırlatma</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data?.users.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div style={{ fontWeight: 550 }}>{row.name || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{row.email}</div>
                    </td>
                    <td>
                      <span className={`tag${row.role === 'admin' ? ' admin' : ''}`}>{row.role}</span>{' '}
                      {!row.active && <span className="tag off">pasif</span>}
                    </td>
                    <td className="num">{formatDateTime(row.lastLoginAt)}</td>
                    <td className="num">{row.cards}</td>
                    <td className="num">{row.images}</td>
                    <td className="num">{formatBytes(row.bytes)}</td>
                    <td className="num">{row.pendingReminders}</td>
                    <td>
                      {row.id !== user.id && (
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() =>
                              updateUser.mutate({
                                id: row.id,
                                patch: { role: row.role === 'admin' ? 'user' : 'admin' },
                              })
                            }
                          >
                            {row.role === 'admin' ? 'Admin al' : 'Admin yap'}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => updateUser.mutate({ id: row.id, patch: { active: !row.active } })}
                          >
                            {row.active ? 'Pasife al' : 'Aktifleştir'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => {
                              const typed = window.prompt(
                                `Bu hesabı ve TÜM verisini kalıcı olarak silmek için e-postayı yaz:\n${row.email}`,
                              );
                              if (typed?.trim().toLowerCase() === row.email.toLowerCase()) {
                                deleteUser.mutate(row.id);
                              }
                            }}
                          >
                            Sil
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">Mail geçmişi</div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tür</th>
                  <th>Alıcı</th>
                  <th>Durum</th>
                  <th>Zaman</th>
                </tr>
              </thead>
              <tbody>
                {mailLog.data?.entries.slice(0, 25).map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.kind}</td>
                    <td>{entry.to_addr}</td>
                    <td>
                      <span className={`tag ${entry.status === 'ok' ? 'ok' : 'off'}`}>{entry.status}</span>
                      {entry.error && (
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}> {entry.error}</span>
                      )}
                    </td>
                    <td className="num">{formatDateTime(entry.created_at)}</td>
                  </tr>
                ))}
                {(mailLog.data?.entries.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--text-faint)' }}>
                      Henüz mail gönderilmemiş.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
    </div>
  );
}
