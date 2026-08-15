import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api.ts';
import { navigate } from '../App.tsx';

export default function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 12 || password.length > 256) {
      setError('Şifre 12 ile 256 karakter arasında olmalı.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(
        code === 'invalid_token'
          ? 'Bu bağlantı geçersiz ya da süresi dolmuş. Yeniden sıfırlama isteyebilirsin.'
          : 'Şifre değiştirilemedi, tekrar dene.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="center-page">
        <div className="auth-card">
          <h1 className="auth-title">Şifren değişti</h1>
          <p className="auth-sub">Güvenlik için tüm cihazlardaki oturumlar kapatıldı. Yeni şifrenle giriş yapabilirsin.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Giriş yap
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-page">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <h1 className="auth-title">Yeni şifre</h1>
          <p className="auth-sub">Yeni şifreni belirle. Diğer cihazlardaki oturumlar kapanacak.</p>
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
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Kaydediliyor…' : 'Şifreyi değiştir'}
        </button>
      </form>
    </div>
  );
}
