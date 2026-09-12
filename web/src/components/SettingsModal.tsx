import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.ts';
import { formatDateTime } from '../lib/dates.ts';
import type { User } from '../lib/types.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useAccessibility } from '../lib/accessibility.tsx';

export default function SettingsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { locale, setLocale, t } = useI18n();
  const { motion, textDensity, setMotion, setTextDensity } = useAccessibility();
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
      setNotice(t('settings.saved'));
      setError('');
      setCurrentPassword('');
      setNewPassword('');
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(
        code === 'wrong_password'
          ? t('settings.wrongPassword')
          : code === 'weak_password'
            ? t('settings.weakPassword')
            : t('settings.saveFailed'),
      );
      setNotice('');
    },
  });

  const testMail = useMutation({
    mutationFn: api.testMail,
    onSuccess: () => {
      setNotice(t('settings.mailSent', { email: user.email }));
      setError('');
      mailLog.refetch();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(
        code === 'mail_disabled'
          ? t('settings.mailDisabled')
          : t('settings.mailFailed'),
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
          <h2 className="modal-title" id="settings-modal-title">{t('settings.title')}</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <span className="label">{t('login.email')}</span>
            <input value={user.email} disabled />
          </div>

          <div className="field">
            <label className="label" htmlFor="name">
              {t('settings.name')}
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
            <span style={{ fontSize: 13 }}>{t('settings.dailySummary')}</span>
          </label>

          <div className="field">
            <label className="label" htmlFor="language">{t('common.language')}</label>
            <select id="language" value={locale} onChange={(event) => setLocale(event.target.value as 'tr' | 'en')}>
              <option value="tr">{t('language.turkish')}</option>
              <option value="en">{t('language.english')}</option>
            </select>
          </div>

          <fieldset className="settings-section">
            <legend>{t('settings.accessibility')}</legend>
            <div className="row settings-preferences">
              <div className="field">
                <label className="label" htmlFor="motion-preference">{t('settings.motion')}</label>
                <select
                  id="motion-preference"
                  value={motion}
                  onChange={(event) => setMotion(event.target.value as typeof motion)}
                >
                  <option value="system">{t('settings.motionSystem')}</option>
                  <option value="reduce">{t('settings.motionReduce')}</option>
                  <option value="full">{t('settings.motionFull')}</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="text-density">{t('settings.textDensity')}</label>
                <select
                  id="text-density"
                  value={textDensity}
                  onChange={(event) => setTextDensity(event.target.value as typeof textDensity)}
                >
                  <option value="compact">{t('settings.densityCompact')}</option>
                  <option value="standard">{t('settings.densityStandard')}</option>
                  <option value="comfortable">{t('settings.densityComfortable')}</option>
                </select>
              </div>
            </div>
            <small>{t('settings.accessibilityHint')}</small>
          </fieldset>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="current">
                {t('settings.currentPassword')}
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
                {t('settings.newPassword')}
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
              {t('settings.testMail')}
            </button>
            {mailLog.data && !mailLog.data.mailEnabled && (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('settings.smtpDisabled')}</span>
            )}
          </div>

          {notice && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c-green)' }}>{notice}</p>}
          {error && <p className="error-text" role="alert">{error}</p>}

          {(mailLog.data?.entries.length ?? 0) > 0 && (
            <div className="field">
              <span className="label">{t('settings.recentMail')}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {mailLog.data!.entries.slice(0, 10).map((entry) => (
                  <div
                    key={entry.id}
                    className="row"
                    style={{ fontSize: 12, color: 'var(--text-muted)', gap: 8 }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(entry.kind === 'reminder' ? t('mail.reminder')
                        : entry.kind === 'daily' ? t('mail.daily')
                          : entry.kind === 'test' ? t('mail.test')
                            : entry.kind === 'invite' ? t('mail.invite')
                              : entry.kind === 'reset' ? t('mail.reset') : entry.kind)} · {entry.subject}
                    </span>
                    <span className={`tag ${entry.status === 'ok' ? 'ok' : 'off'}`}>{entry.status}</span>
                    <span className="num">{formatDateTime(entry.created_at, locale)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {t('common.save')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
