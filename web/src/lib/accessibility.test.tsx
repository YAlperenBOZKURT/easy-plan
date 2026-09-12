import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  AccessibilityProvider,
  readAccessibilityPreferences,
  useAccessibility,
} from './accessibility.tsx';

function PreferenceProbe() {
  const preferences = useAccessibility();
  return (
    <div>
      <span>{preferences.reducedMotion ? 'reduced' : 'animated'}</span>
      <button type="button" onClick={() => preferences.setMotion('reduce')}>reduce</button>
      <button type="button" onClick={() => preferences.setTextDensity('comfortable')}>comfortable</button>
    </div>
  );
}

describe('accessibility preferences', () => {
  it('falls back safely when stored data is invalid', () => {
    expect(readAccessibilityPreferences({ getItem: () => '{broken' })).toEqual({
      motion: 'system',
      textDensity: 'standard',
    });
    expect(readAccessibilityPreferences({ getItem: () => JSON.stringify({
      motion: 'reduce',
      textDensity: 'comfortable',
    }) })).toEqual({ motion: 'reduce', textDensity: 'comfortable' });
  });

  it('applies and persists motion and density changes immediately', async () => {
    localStorage.removeItem('easy-plan-accessibility');
    const user = userEvent.setup();
    render(
      <AccessibilityProvider initialPreferences={{ motion: 'full', textDensity: 'standard' }}>
        <PreferenceProbe />
      </AccessibilityProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'reduce' }));
    await user.click(screen.getByRole('button', { name: 'comfortable' }));

    expect(screen.getByText('reduced')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.dataset.motion).toBe('reduce');
      expect(document.documentElement.dataset.textDensity).toBe('comfortable');
    });
    expect(JSON.parse(localStorage.getItem('easy-plan-accessibility') ?? '{}')).toEqual({
      motion: 'reduce',
      textDensity: 'comfortable',
    });
  });
});

