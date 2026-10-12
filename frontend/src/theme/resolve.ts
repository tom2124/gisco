/**
 * Bridge from CSS custom properties to consumers that cannot use `var()`.
 *
 * CodeMirror's highlight style and xterm's canvas renderer both take literal
 * colour strings — a `var(--x)` reference either renders as nothing or, in
 * xterm's case, is silently dropped by its colour parser. So these surfaces
 * read the resolved value off the document root instead.
 *
 * The alternative (rebuilding themes from a JS palette) is what this file
 * exists to avoid: tokens.css stays the only place a colour is written down.
 */

/** Read a token's computed value from the document root. */
export function resolveToken(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim();
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0');

/**
 * Normalise a CSS colour to something a hand-rolled colour parser accepts.
 *
 * Notably this converts `rgb(19 27 43 / 0.7)` into `rgba(19, 27, 43, 0.7)`.
 * xterm's `parseColor` reads alpha only from the comma-separated form, so
 * modern space/slash syntax arrives with its alpha silently discarded.
 */
export function normalizeColor(css: string): string {
  const value = css.trim();

  // #rgb / #rgba / #rrggbb / #rrggbbaa — already in the easiest form to parse.
  if (/^#([0-9a-f]{3,8})$/i.test(value)) return value;

  const rgb = /^rgba?\(\s*([^)\s]+)[,\s]\s*([^)\s]+)[,\s]\s*([^)\s/]+)(?:\s*[/,]\s*([0-9.]+%?))?\s*\)$/i.exec(value);
  if (!rgb) return value; // named colour or something we do not model

  const channel = (raw: string, scale: number) => {
    const n = Number.parseFloat(raw);
    if (Number.isNaN(n)) return 0;
    return raw.endsWith('%') ? (n / 100) * scale : n;
  };

  const r = channel(rgb[1], 255);
  const g = channel(rgb[2], 255);
  const b = channel(rgb[3], 255);

  const alphaRaw = rgb[4];
  let alpha = 1;
  if (alphaRaw !== undefined) {
    const n = Number.parseFloat(alphaRaw);
    if (!Number.isNaN(n)) alpha = alphaRaw.endsWith('%') ? n / 100 : n;
  }

  if (alpha >= 1) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${alpha})`;
}

/** Resolve a token and normalise it for a non-CSS colour consumer. */
export function resolveColor(name: string): string {
  return normalizeColor(resolveToken(name));
}

/**
 * Resolve a group of tokens in one pass. A single `getComputedStyle` read is
 * much cheaper than one per token, and xterm wants sixteen of them.
 */
export function resolveColors(names: readonly string[]): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const name of names) {
    out[name] = normalizeColor(style.getPropertyValue(name));
  }
  return out;
}
