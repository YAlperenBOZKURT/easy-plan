import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.ts';
import { navigate } from '../App.tsx';

const INVALID: Record<string, string> = {
  not_found: 'Bu davet bağlantısı geçersiz.',
  used: 'Bu davet daha önce kullanılmış. Hesabın varsa giriş yapabilirsin.',
  expired: 'Bu davetin süresi dolmuş. Seni davet eden kişiden yeni bir bağlantı iste.',
};

export default function Invite({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.readInvite(token),
    retry: false,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 12 || password.length > 256) {
      setError('Şifre 12 ile 256 karakter arasında olmalı.');
      return;
    }
    setBusy(true);
    try {
      await api.acceptInvite(token, name, password);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(INVALID[code] ?? 'Hesap oluşturulamadı, tekrar dene.');
    } finally {
      setBusy(false);
    }
  }

  if (invite.isLoading) return <div className="center-page" />;

  if (invite.isError) {
    const code = invite.error instanceof ApiError ? invite.error.code : 'not_found';
    return (
      <div className="center-page">
        <div className="auth-card">
          <h1 className="auth-title">Davet geçersiz</h1>
          <p className="auth-sub">{INVALID[code] ?? 'Bu bağlantı kullanılamıyor.'}</p>
          <button className="btn" onClick={() => navigate('/')}>
            Giriş ekranına git
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-page">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <h1 className="auth-title">Hoş geldin</h1>
          <p className="auth-sub">
            <strong>{invite.data?.email}</strong> için hesabını kur. Şifreni sen belirliyorsun.
          </p>
        </div>

        <div className="field">
          <label className="label" htmlFor="name">
            Adın
          </label>
          <input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label className="label" htmlFor="password">
            Şifre (en az 12 karakter)
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Kuruluyor…' : 'Hesabımı oluştur'}
        </button>
      </form>
    </div>
  );
}
