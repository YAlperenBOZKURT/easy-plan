import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.ts';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-posta veya şifre hatalı.',
  http_429: 'Çok fazla deneme yapıldı, birkaç dakika sonra tekrar dene.',
};

export default function Login() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await api.login(email, password);
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      } else {
        await api.forgot(email);
        setSent(true);
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(MESSAGES[code] ?? 'Bir şeyler ters gitti, tekrar dene.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="auth-card" onSubmit={submit} aria-busy={busy}>
        <div>
          <h1 className="auth-title">Planner</h1>
          <p className="auth-sub">
            {mode === 'login' ? 'Devam etmek için giriş yap.' : 'Kayıtlı adresine sıfırlama bağlantısı gönderelim.'}
          </p>
        </div>

        {sent ? (
          <p className="auth-sub">
            Adres kayıtlıysa sıfırlama bağlantısı gönderildi. Gelen kutunu kontrol et — bağlantı 1 saat geçerli.
          </p>
        ) : (
          <>
            <div className="field">
              <label className="label" htmlFor="email">
                E-posta
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {mode === 'login' && (
              <div className="field">
                <label className="label" htmlFor="password">
                  Şifre
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            {error && <p className="error-text" role="alert">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Bekle…' : mode === 'login' ? 'Giriş yap' : 'Bağlantı gönder'}
            </button>
          </>
        )}

        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === 'login' ? 'forgot' : 'login');
            setError('');
            setSent(false);
          }}
        >
          {mode === 'login' ? 'Şifremi unuttum' : 'Girişe dön'}
        </button>
      </form>
    </div>
  );
}
