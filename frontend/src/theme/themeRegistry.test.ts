import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES } from './ThemeProvider';

/**
 * The pre-paint script in index.html applies the stored theme before React
 * mounts, so a reload never flashes the wrong palette. Nothing can import
 * across into that inline script, so its theme allowlist is a duplicate of
 * THEMES — and a duplicate that silently falls out of date produces a genuinely
 * confusing bug: a theme that works fine when picked in the UI, but reverts to
 * default on reload, because the boot script rejects a name it does not know.
 *
 * These tests assert the two lists agree, so adding a theme without updating
 * index.html fails the build instead.
 */
const indexHtml = readFileSync(join(__dirname, '../../index.html'), 'utf8');

/** The array literal in the inline boot script. */
function bootScriptThemes(): string[] {
  const match = indexHtml.match(/\[\s*((?:'[\w-]+'\s*,?\s*)+)\]\.indexOf\(theme\)/);
  if (!match) throw new Error('could not find the theme allowlist in index.html');
  return [...match[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
}

describe('theme registry', () => {
  it('pre-paint script accepts exactly the registered themes', () => {
    expect(bootScriptThemes().sort()).toEqual([...THEMES].sort());
  });

  it('pre-paint script falls back to a theme that actually exists', () => {
    // The `theme = 'dark'` literal in the catch block and the reassignment.
    expect(indexHtml).toContain(`theme = '${DEFAULT_THEME}'`);
    expect(THEMES).toContain(DEFAULT_THEME);
  });

  it('has no duplicate theme names', () => {
    expect(new Set(THEMES).size).toBe(THEMES.length);
  });
});
