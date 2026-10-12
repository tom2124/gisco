import React from 'react';
import { Palette } from 'lucide-react';
import { THEMES, useTheme, type ThemeName } from '../theme/ThemeProvider';

/** Short human labels. Add one per entry in THEMES. */
const LABELS: Record<ThemeName, string> = {
  dark: 'Dark',
  abyss: 'Abyss',
};

const DESCRIPTIONS: Record<ThemeName, string> = {
  dark: 'The default palette.',
  abyss: 'Cooler surfaces with a brighter accent.',
};

/**
 * Theme picker. Deliberately renders from the active theme's own tokens for its
 * swatches, so a new theme shows an accurate preview without touching this file.
 */
export const ThemePicker: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', marginBottom: 'var(--space-16)' }}>
        <Palette size={20} color="var(--accent-cyan)" />
        <h3>Appearance</h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-12)' }}>
        {THEMES.map((name) => {
          const selected = name === theme;
          return (
            <label
              key={name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-12)',
                padding: 'var(--space-12) var(--space-12)',
                background: 'var(--bg-card)',
                border: '1px solid ' + (selected ? 'var(--primary)' : 'var(--border-subtle)'),
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="gisco-theme"
                checked={selected}
                onChange={() => setTheme(name)}
                style={{ width: 'auto' }}
              />
              {/* Swatches read from the theme being previewed, not the active one. */}
              <ThemeSwatch theme={name} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem' }}>
                  {LABELS[name]}
                </span>
                <span
                  style={{
                    display: 'block',
                    color: 'var(--text-dim)',
                    fontSize: '0.78rem',
                    marginTop: 'var(--space-2)',
                  }}
                >
                  {DESCRIPTIONS[name]}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

/** Four colour chips rendered under the target theme's tokens. */
const ThemeSwatch: React.FC<{ theme: ThemeName }> = ({ theme }) => (
  <span
    aria-hidden="true"
    data-theme={theme}
    style={{
      display: 'inline-flex',
      gap: 'var(--space-2)',
      flexShrink: 0,
      padding: 'var(--space-4)',
      background: 'var(--bg-main)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
    }}
  >
    <i style={{ width: '10px', height: '18px', background: 'var(--primary)', borderRadius: 'var(--radius-sm)' }} />
    <i style={{ width: '10px', height: '18px', background: 'var(--status-running)', borderRadius: 'var(--radius-sm)' }} />
    <i style={{ width: '10px', height: '18px', background: 'var(--status-warning)', borderRadius: 'var(--radius-sm)' }} />
    <i style={{ width: '10px', height: '18px', background: 'var(--bg-card-hover)', borderRadius: 'var(--radius-sm)' }} />
  </span>
);

export default ThemePicker;