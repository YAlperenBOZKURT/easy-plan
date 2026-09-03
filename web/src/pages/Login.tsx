import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';

export default function Login() {
  const { t } = useI18n();
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
      setError(code === 'invalid_credentials'
        ? t('error.invalidCredentials')
        : code === 'http_429'
          ? t('error.tooManyAttempts')
          : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="auth-card" onSubmit={submit} aria-busy={busy}>
        <div>
          <h1 className="auth-title">Easy Plan</h1>
          <p className="auth-sub">
            {mode === 'login' ? t('login.subtitle') : t('login.forgotSubtitle')}
          </p>
        </div>

        {sent ? (
          <p className="auth-sub">
            {t('login.sent')}
          </p>
        ) : (
          <>
            <div className="field">
              <label className="label" htmlFor="email">
                {t('login.email')}
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
                  {t('login.password')}
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
              {busy ? t('login.wait') : mode === 'login' ? t('login.submit') : t('login.sendLink')}
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
          {mode === 'login' ? t('login.forgot') : t('login.back')}
        </button>
      </form>
    </div>
  );
}
