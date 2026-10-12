#!/usr/bin/env python3
"""Audit the token file: unused tokens, off-grid spacing, unadopted scales."""
import re, glob, collections, os

os.chdir(os.path.join(os.path.dirname(__file__), '..'))

# ---- collect every var(--x) reference outside the token file ----
refs = collections.Counter()
sources = []
for pat in ('src/**/*.css', 'src/**/*.tsx', 'src/**/*.ts'):
    for f in glob.glob(pat, recursive=True):
        if f.endswith('theme/tokens.css'):
            continue
        text = open(f).read()
        for m in re.finditer(r'var\((--[a-z0-9.-]+)', text):
            refs[m.group(1)] += 1
        # Some tokens are consumed by NAME rather than through var(): the terminal
        # and editor themes pass them as strings to resolveColors(), because
        # xterm cannot read a CSS variable. Missing those would report every ANSI
        # token as dead and send you deleting working code.
        for m in re.finditer(r"['\"](--[a-z0-9.-]+)['\"]", text):
            refs[m.group(1)] += 1
        sources.append((f, text))

# ---- tokens defined in tokens.css ----
tok_text = open('src/theme/tokens.css').read()
defined = set(re.findall(r'^\s*(--[a-z0-9.-]+):', tok_text, re.M))
# tokens referenced *within* tokens.css also count as used
internal = set(re.findall(r'var\((--[a-z0-9.-]+)', tok_text))

print('=== UNUSED tokens (never referenced anywhere) ===')
unused = sorted(t for t in defined if refs[t] == 0 and t not in internal)
for t in unused:
    print(f'  {t}')
print(f'  ({len(unused)} of {len(defined)})')

# ---- spacing scale consumption ----
scale = {}
for m in re.finditer(r'^\s*(--space-[a-z0-9.-]+):\s*([0-9.]+)px', tok_text, re.M):
    scale[m.group(1)] = float(m.group(2))

print('\n=== spacing scale ===')
off = 0
for name in sorted(scale, key=lambda k: scale[k]):
    n = refs[name]
    v = scale[name]
    if v != 0 and v % 4 != 0 and v != 2:
        off += 1
        mark = 'OFF-GRID'
    elif n == 0:
        mark = 'unused'
    else:
        mark = ''
    print(f'  {name:<16} {v:>5g}px  {n:>4} refs  {mark}')
print(f'  {len(scale)} steps, {off} off a 4px grid, '
      f'{len([1 for n in scale if refs[n] == 0])} unused')

print('\n=== unadopted scales ===')
dur = sum(len(re.findall(r'transition:[^;}]*', t)) for _, t in sources)
raw_dur = sum(len(re.findall(r'transition:[^;}]*?(?<![-\w])0\.\d+s', t)) for _, t in sources)
trans_all = sum(len(re.findall(r'transition:\s*all', t)) for _, t in sources)
z_tok = sum(len(re.findall(r'z-index:\s*var\(', t)) for _, t in sources)
print(f'  transition declarations: {dur}  (raw 0.xs: {raw_dur}, "all": {trans_all})')
print(f'  z-index using a token: {z_tok}')
col = collections.Counter()
COMMENT = re.compile(r'/\*.*?\*/', re.S)
for f, text in sources:
    for m in re.finditer(r'#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)',
                         COMMENT.sub('', text)):
        col[m.group(0)] += 1
print(f'  raw colour literals outside tokens.css: {sum(col.values())} '
      f'({len(col)} distinct)')
