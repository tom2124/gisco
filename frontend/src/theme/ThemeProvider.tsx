import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

/**
 * Theme registry. Each name maps to a `[data-theme='<name>']` block in
 * `src/theme/tokens.css`.
 *
 * `industrial` is the default and is also what bare `:root` provides, so the
 * app renders correctly with no attribute set at all. `dark` is an override.
 *
 * There is deliberately no "follow OS" option: both available themes are dark,
 * so honouring a light OS preference would mean showing a dark UI on purpose,
 * which is worse than ignoring the preference. It becomes meaningful the moment
 * a light theme exists.
 */
export const THEMES = ['industrial', 'dark'] as const;
export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeName = 'industrial';

const STORAGE_KEY = 'gisco.theme';
/** Attribute written to <html>. Mirrored by the pre-paint script in index.html. */
export const THEME_ATTR = 'data-theme';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const isThemeName = (value: unknown): value is ThemeName =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

/** Write the theme to the document root. Also used by the pre-paint script. */
export function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute(THEME_ATTR, theme);
}

function readStoredTheme(): ThemeName {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    // Stored as JSON so the key can grow fields without a migration later.
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return isThemeName(parsed) ? parsed : DEFAULT_THEME;
    if (parsed && typeof parsed === 'object' && 'theme' in parsed) {
      const value = (parsed as { theme: unknown }).theme;
      return isThemeName(value) ? value : DEFAULT_THEME;
    }
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function persistTheme(theme: ThemeName) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
  } catch {
    // Private mode or storage disabled; the theme still applies for this session.
  }
}

export const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeName>(readStoredTheme);

  // Take over from the pre-paint script, which sets the attribute before React
  // mounts so there is no flash of the wrong theme.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    applyTheme(next);
    persistTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}