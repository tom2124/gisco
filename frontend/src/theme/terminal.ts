import type { ITheme } from '@xterm/xterm';
import { resolveColors } from './resolve';

/**
 * The terminal is part of the app theme, ANSI output included: terminal output
 * colours are semantic (a log line's red is meaningful), so they belong in
 * tokens.css like every other colour rather than in a hand-maintained xterm
 * theme object.
 *
 * xterm cannot consume `var()` — its colour parser reads literal values, and
 * drops alpha given in modern `rgb(r g b / a)` form — so the tokens are
 * resolved and normalised here. See `resolve.ts`.
 */
const TOKENS = [
  '--terminal-surface',
  '--terminal-foreground',
  '--terminal-cursor',
  '--terminal-selection',
  '--ansi-black',
  '--ansi-red',
  '--ansi-green',
  '--ansi-yellow',
  '--ansi-blue',
  '--ansi-magenta',
  '--ansi-cyan',
  '--ansi-white',
  '--ansi-bright-black',
  '--ansi-bright-red',
  '--ansi-bright-green',
  '--ansi-bright-yellow',
  '--ansi-bright-blue',
  '--ansi-bright-magenta',
  '--ansi-bright-cyan',
  '--ansi-bright-white',
] as const;

export function buildTerminalTheme(): ITheme {
  const t = resolveColors(TOKENS);
  return {
    background: t['--terminal-surface'],
    foreground: t['--terminal-foreground'],
    cursor: t['--terminal-cursor'],
    selectionBackground: t['--terminal-selection'],
    black: t['--ansi-black'],
    red: t['--ansi-red'],
    green: t['--ansi-green'],
    yellow: t['--ansi-yellow'],
    blue: t['--ansi-blue'],
    magenta: t['--ansi-magenta'],
    cyan: t['--ansi-cyan'],
    white: t['--ansi-white'],
    brightBlack: t['--ansi-bright-black'],
    brightRed: t['--ansi-bright-red'],
    brightGreen: t['--ansi-bright-green'],
    brightYellow: t['--ansi-bright-yellow'],
    brightBlue: t['--ansi-bright-blue'],
    brightMagenta: t['--ansi-bright-magenta'],
    brightCyan: t['--ansi-bright-cyan'],
    brightWhite: t['--ansi-bright-white'],
  };
}
