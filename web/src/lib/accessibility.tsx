import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type MotionPreference = 'system' | 'reduce' | 'full';
export type TextDensity = 'compact' | 'standard' | 'comfortable';

export interface AccessibilityPreferences {
  motion: MotionPreference;
  textDensity: TextDensity;
}

const STORAGE_KEY = 'easy-plan-accessibility';
export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  motion: 'system',
  textDensity: 'standard',
};

export function readAccessibilityPreferences(storage: Pick<Storage, 'getItem'> = localStorage): AccessibilityPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as Partial<AccessibilityPreferences>;
    return {
      motion: parsed.motion === 'reduce' || parsed.motion === 'full' ? parsed.motion : 'system',
      textDensity: parsed.textDensity === 'compact' || parsed.textDensity === 'comfortable'
        ? parsed.textDensity
        : 'standard',
    };
  } catch {
    return DEFAULT_ACCESSIBILITY_PREFERENCES;
  }
}

interface AccessibilityValue extends AccessibilityPreferences {
  reducedMotion: boolean;
  setMotion: (motion: MotionPreference) => void;
  setTextDensity: (density: TextDensity) => void;
}

const AccessibilityContext = createContext<AccessibilityValue>({
  ...DEFAULT_ACCESSIBILITY_PREFERENCES,
  reducedMotion: false,
  setMotion: () => undefined,
  setTextDensity: () => undefined,
});

export function AccessibilityProvider({
  children,
  initialPreferences,
}: {
  children: ReactNode;
  initialPreferences?: AccessibilityPreferences;
}) {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(
    () => initialPreferences ?? readAccessibilityPreferences(),
  );
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemReducedMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    document.documentElement.dataset.motion = preferences.motion;
    document.documentElement.dataset.textDensity = preferences.textDensity;
  }, [preferences]);

  const reducedMotion = preferences.motion === 'reduce'
    || (preferences.motion === 'system' && systemReducedMotion);
  const value = useMemo<AccessibilityValue>(() => ({
    ...preferences,
    reducedMotion,
    setMotion: (motion) => setPreferences((current) => ({ ...current, motion })),
    setTextDensity: (textDensity) => setPreferences((current) => ({ ...current, textDensity })),
  }), [preferences, reducedMotion]);

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export const useAccessibility = (): AccessibilityValue => useContext(AccessibilityContext);

