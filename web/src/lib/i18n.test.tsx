import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { I18nProvider, translate, useI18n } from './i18n.tsx';

function LanguageProbe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button type="button" onClick={() => setLocale(locale === 'tr' ? 'en' : 'tr')}>
      {t('planner.today')}
    </button>
  );
}

describe('localization', () => {
  it('formats Turkish and English catalog messages', () => {
    expect(translate('tr', 'settings.mailSent', { email: 'user@example.com' }))
      .toBe('Test maili user@example.com adresine gönderildi.');
    expect(translate('en', 'settings.mailSent', { email: 'user@example.com' }))
      .toBe('A test email was sent to user@example.com.');
  });

  it('switches language immediately and persists the choice', async () => {
    const user = userEvent.setup();
    render(<I18nProvider initialLocale="tr"><LanguageProbe /></I18nProvider>);

    await user.click(screen.getByRole('button', { name: 'Bugün' }));

    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(localStorage.getItem('easy-plan-language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

