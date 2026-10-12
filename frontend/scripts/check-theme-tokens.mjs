#!/usr/bin/env node
/**
 * Theme token guard.
 *
 * A token system only stays a source of truth if violations are caught
 * automatically. This script enforces the two rules that matter:
 *
 *   1. Component CSS (anything outside the token file) may not contain raw
 *      colours — they must reference a semantic token.
 *   2. `style={{ ... }}` in TSX may not contain raw colours either, for the
 *      same reason.
 *
 * Raw colours are permitted in exactly three places:
 *   - src/theme/tokens.css (the token file itself)
 *   - the allow-list below (pre-existing violations, to be worked down)
 *   - brand assets under public/ (SVG, images)
 *
 * Usage:
 *   node scripts/check-theme-tokens.mjs            # report, exit 1 on violations
 *   node scripts/check-theme-tokens.mjs --report   # report only, always exit 0
 *
 * `--report` is for the inventory stage: it shows the full backlog without
 * breaking the build. Remove it once the backlog reaches zero.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const TOKEN_FILE = join(SRC, 'theme', 'tokens.css');
const REPORT_ONLY = process.argv.includes('--report');

/**
 * Pre-existing violations, as `relative/path:count`. Each entry is a debt we
 * have taken on; shrinking this file is the visible progress metric for the
 * conversion phase. Delete an entry once it reaches zero.
 */
const ALLOW_LIST = {
  // Populated as violations are converted. Empty means the guard is enforced
  // with no exceptions.
};

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const violations = [];

// --- CSS: component rules must not hard-code colours, nor use primitives ---
for (const file of walk(SRC)) {
  if (!file.endsWith('.css')) continue;
  const rel = relative(ROOT, file);
  if (file === TOKEN_FILE) continue; // the token file is the one allowed place

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    RAW_COLOUR.lastIndex = 0;
    if (RAW_COLOUR.test(line)) {
      const key = `${rel}:${i + 1}`;
      violations.push({
        key,
        kind: 'raw-colour-in-css',
        line: trimmed,
        allowed: Boolean(ALLOW_LIST[rel]),
      });
    }
  });
}

// --- TSX: inline styles must not hard-code colours either ---
for (const file of walk(SRC)) {
  if (!/\.tsx?$/.test(file)) continue;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');

  // Only inline `style={{ ... }}` blocks are in scope for rule 2.
  const styleBlocks = text.match(/style=\{\{[\s\S]*?\}\}/g) ?? [];
  styleBlocks.forEach((block) => {
    RAW_COLOUR.lastIndex = 0;
    if (!RAW_COLOUR.test(block)) return;
    const lineNumber = text.slice(0, text.indexOf(block)).split('\n').length;
    violations.push({
      key: `${rel}:${lineNumber}`,
      kind: 'raw-colour-in-inline-style',
      line: block.replace(/\s+/g, ' ').slice(0, 100),
      allowed: Boolean(ALLOW_LIST[rel]),
    });
  });
}

// --- Token file hygiene: primitives must not be referenced outside it ---
for (const file of walk(SRC)) {
  if (!/\.(css|tsx?)$/.test(file)) continue;
  if (file === TOKEN_FILE) continue;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  // Primitives are the colour ramps only. Spacing, radius, elevation, motion
  // and z-index are semantic now (a theme retunes them directly), so they are
  // legitimate outside the token file — flagging them would flag the whole UI.
  const re = /var\((--(?:slate|sky|cyan|indigo|emerald|amber|red|pastel|white|black)-[a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    violations.push({
      key: `${rel}`,
      kind: `primitive-leak:${m[1]}`,
      line: `${m[1]} referenced outside the token file`,
      allowed: false,
    });
  }
}

// --- Spacing, radius and shadow must be tokenised -------------------------
// These three are what a theme needs to retune density, roundness and depth.
// Left as raw px they silently opt out of theming, so they are enforced with
// the same weight as raw colours.

const SPACING_PROPS =
  'gap|row-gap|column-gap|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left';
const SPACING_CSS = new RegExp(`(?<![\\w-])(${SPACING_PROPS})\\s*:\\s*([^;}]+)`, 'g');
const SPACING_TSX = new RegExp(
  `\\b(gap|rowGap|columnGap|padding[A-Z]\\w*|margin[A-Z]\\w*|padding|margin)\\s*:\s*'([^']+)'`,
  'g'
);
const RADIUS_CSS = /(?<![\w-])border-radius\s*:\s*([^;}]+)/g;
const RADIUS_TSX = /\bborderRadius\s*:\s*'([^']+)'/g;
const SHADOW_CSS = /(?<![\w-])box-shadow\s*:\s*([^;}]+)/g;
const INLINE_TSX = /\b(transition|animation|transitionDuration)\s*:\s*'([^']+)'/g;
/** A declaration with no value.
 *
 *  Two shapes, and the first version of this rule only caught the first one:
 *    `background: ;`            — the value is empty
 *    `border: 1px solid ;`      — the value is empty at the *end* of a shorthand
 *
 *  The second form is the same silent drop and three of them shipped, so the
 *  pattern now matches any declaration whose value ends in whitespace right
 *  before the semicolon. Valid CSS does sometimes allow that trailing space, but
 *  nothing in this codebase writes it, and a false positive costs one fix while
 *  a false negative costs an invisible bug.
 *
 *  `content` is excluded because `content: ''` on a pseudo-element is required.
 */
const EMPTY_CSS = /(?<![\w-])(?!content\b)([a-z-]+)\s*:\s*([^;{}]*);/g;
const EMPTY_VALUE = /^$|[^;{}]*\s$/;
/** A px length in a declaration means it is not tokenised. */
const RAW_PX = /(?:^|[\s(,])-?\d*\.?\d+px/;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

for (const file of walk(SRC)) {
  if (!/\.(css|tsx?)$/.test(file)) continue;
  if (file === TOKEN_FILE) continue;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');

  const report = (kind, detail, index) =>
    violations.push({
      key: `${rel}:${lineOf(text, index)}`,
      kind,
      line: detail.trim().slice(0, 110),
      allowed: false,
    });

  let m;
  while ((m = SPACING_CSS.exec(text)) !== null) {
    if (RAW_PX.test(m[2])) report('raw-px-in-spacing', `${m[1]}: ${m[2]}`, m.index);
  }
  while ((m = SPACING_TSX.exec(text)) !== null) {
    if (RAW_PX.test(m[2])) report('raw-px-in-spacing', `${m[1]}: '${m[2]}'`, m.index);
  }
  while ((m = RADIUS_CSS.exec(text)) !== null) {
    if (RAW_PX.test(m[1]) || /(^|[\s,(])50%/.test(m[1])) {
      report('raw-radius', `border-radius: ${m[1]}`, m.index);
    }
  }
  while ((m = RADIUS_TSX.exec(text)) !== null) {
    if (RAW_PX.test(m[1]) || /(^|[\s,(])50%/.test(m[1])) {
      report('raw-radius', `borderRadius: '${m[1]}'`, m.index);
    }
  }
  while ((m = SHADOW_CSS.exec(text)) !== null) {
    if (!m[1].includes('var(--')) report('raw-shadow', `box-shadow: ${m[1]}`, m.index);
  }

  // An empty declaration is silently dropped by the CSS parser: the property
  // reverts to its inherited or initial value with no error anywhere. Five of
  // these shipped once (`background: ;` left a toast and the template selection
  // bar transparent, and three borders vanished). It is invisible in review and
  // invisible at runtime, so it is checked mechanically.
  // Inline style objects. A declaration there is just as much a bypass as one
  // in a stylesheet, and `transition: all` in particular hides what it animates.
  for (const block of text.match(/style=\{\{[\s\S]*?\}\}/g) ?? []) {
    let m2;
    INLINE_TSX.lastIndex = 0;
    while ((m2 = INLINE_TSX.exec(block)) !== null) {
      if (m2[2] === 'all') {
        report('transition-all', `${m2[1]}: '${m2[2]}'`, text.indexOf(block) + m2.index);
      } else if (!m2[2].includes('var(--duration')) {
        report('raw-duration', `${m2[1]}: '${m2[2]}'`, text.indexOf(block) + m2.index);
      }
    }
  }
}


// --- Named CSS colours ----------------------------------------------------
// RAW_COLOUR matches hex and rgb() only, so `color: red` passed the guard
// cleanly. Named colours are just as much a bypass of the token layer — and a
// debug value left in the stylesheet is exactly how that happens.
//
// Scoped to declaration positions and a fixed colour vocabulary, so the word
// "red" in prose or a class name is not a false positive. `transparent` and
// `currentColor` are allowed: they mean "no colour here", which is a real
// design decision rather than a bypass.
const NAMED = 'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';
const NAMED_DECL = /(?:^|[;{}\s])((?:color|background|border|border-color|border-top|border-right|border-bottom|border-left|border-top-color|border-right-color|border-bottom-color|border-left-color|outline|outline-color|fill|stroke|box-shadow|caret-color|accent-color))\s*:\s*([^;}]*)/gi;
for (const file of walk(SRC)) {
  if (!/\.(css|tsx?)$/.test(file)) continue;
  if (file === TOKEN_FILE) continue;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  let m;
  NAMED_DECL.lastIndex = 0;
  while ((m = NAMED_DECL.exec(text)) !== null) {
    const value = m[2];
    // `var(--x)` is the whole point. A value that merely *names* a token
    // (`t['--ansi-bright-black']`) is also fine, and skipping on `--` covers
    // both without trying to tell them apart.
    if (value.includes('var(--') || value.includes('--')) continue;
    const hit = new RegExp(`\\b(?:${NAMED})\\b`, 'i').exec(value);
    if (!hit) continue;
    violations.push({
      key: `${rel}:${text.slice(0, m.index).split('\n').length}`,
      kind: 'named-colour',
      line: `${m[1]}: ${value.trim()}`.slice(0, 110),
      allowed: false,
    });
  }
}

// --- Label casing must be a token ------------------------------------------
// `text-transform` and `font-variant` were hard-coded in three places, which
// made them unreachable by a theme: the badges and table headers were uppercase
// in every theme whether it wanted them or not. Same class of blind spot as
// border width was.
const CASING_CSS = /(?<![\w-])(text-transform|font-variant(?:-caps)?)\s*:\s*([^;}]+)/g;
const CASING_TSX = /\b(textTransform|fontVariant)\s*:\s*'([^']+)'/g;
for (const file of walk(SRC)) {
  if (!file.endsWith('.css') || file === TOKEN_FILE) continue;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  let m;
  CASING_CSS.lastIndex = 0;
  while ((m = CASING_CSS.exec(text)) !== null) {
    if (!m[2].includes('var(--')) {
      violations.push({
        key: `${rel}:${text.slice(0, m.index).split('\n').length}`,
        kind: 'raw-casing',
        line: `${m[1]}: ${m[2]}`,
        allowed: false,
      });
    }
  }
}

// --- Empty declarations (CSS only) ----------------------------------------
// An empty declaration is silently dropped by the CSS parser: the property
// reverts to its inherited or initial value with no error anywhere. Five of
// these shipped once (`background: ;` left a toast and the template selection
// bar transparent, and three borders vanished). It is invisible in review and
// invisible at runtime, so it is checked mechanically.
//
// CSS only, and `content` excluded: `content: ''` on a pseudo-element is
// required, not a mistake. In TypeScript an empty string is a legitimate value
// (a form field's initial state), and tsc is the right tool for those.
for (const file of walk(SRC)) {
  if (!file.endsWith('.css') || file === TOKEN_FILE) continue;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  const lineStart = (index) => text.slice(0, index).split('\n').length;
  let m;
  EMPTY_CSS.lastIndex = 0;
  while ((m = EMPTY_CSS.exec(text)) !== null) {
    if (!EMPTY_VALUE.test(m[2])) continue;
    violations.push({
      key: `${rel}:${lineStart(m.index)}`,
      kind: 'empty-declaration',
      line: `${m[1]}: ${m[2].trim()};`.replace(/\s+;/, ' ;'),
      allowed: false,
    });
  }
}

const blocking = violations.filter((v) => !v.allowed);

const byFile = new Map();
for (const v of blocking) {
  const file = v.key.split(':')[0];
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
}

if (blocking.length === 0) {
  console.log('theme tokens: OK — no raw colours outside the token file');
  process.exit(0);
}

console.log(`theme tokens: ${blocking.length} violation(s)\n`);
for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${file}`);
}
const kinds = new Set(blocking.map((v) => v.kind.split(':')[0]));
console.log(`\n  kinds: ${[...kinds].join(', ')}`);
console.log(`  mode: ${REPORT_ONLY ? 'report-only' : 'enforced'}`);

if (REPORT_ONLY) process.exit(0);
process.exit(1);