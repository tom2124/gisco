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