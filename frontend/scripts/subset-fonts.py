#!/usr/bin/env python3
"""Build the terminal webfont from the upstream Iosevka Term release.

Iosevka Term has no npm/Fontsource package, so the webfont has to come from the
upstream release archive. Those archives are unsubsetted: every weight is ~1.6 MB
because they carry the full symbol repertoire. Committing two of them would add
3.3 MB of opaque binaries to the repository, so they are subset down to the
ranges a terminal actually renders.

Run from the frontend directory:

    npm run font:build -- /path/to/PkgWebFont-IosevkaTerm-<version>.zip

The output is deterministic for a given input, so re-running against a newer
release produces a reviewable diff rather than a mystery change.

Requires fontTools and brotli:  pip install fonttools brotli
"""

import io
import os
import sys
import zipfile

from fontTools import subset
from fontTools.ttLib import TTFont

# The upstream webfont package. Version is pinned in the provenance file so an
# upgrade is a deliberate act rather than an accident.
RELEASE = "https://github.com/be5invis/Iosevka/releases/download/v34.9.0/PkgWebFont-IosevkaTerm-34.9.0.zip"
VERSION = "34.9.0"
FAMILY = "Iosevka Term Web"

# xterm pins 400 for regular and 600 for SGR 1 bold. Those two are the only
# faces the terminal can ask for; bundling more would only cost bytes.
WEIGHTS = {"Regular": 400, "SemiBold": 600}

# What a terminal actually renders. Box drawing and block elements are the point
# of this font family and cannot be left out — without them `ls`, `tree`, TUI
# programs and progress bars render as broken gaps. The private-use range is
# the Powerline/Starship arrow set, which prompt themes emit constantly.
RANGES = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1 Supplement
    (0x0100, 0x017F),  # Latin Extended-A
    (0x02C6, 0x02C6),  # ˆ  MODIFIER LETTER CIRCUMFLEX
    (0x02DC, 0x02DC),  # ˜  SMALL TILDE
    (0x0300, 0x036F),  # Combining Diacritical Marks
    (0x0391, 0x03C9),  # Greek, for arithmetic in shell output
    (0x2000, 0x206F),  # General Punctuation — dashes, quotes, ellipsis
    (0x20A0, 0x20BF),  # Currency Symbols
    (0x2100, 0x214F),  # Letterlike Symbols: degree, numero, trade mark
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Mathematical Operators — ∀ ∑ ∏ √ ∫
    (0x2300, 0x23FF),  # Miscellaneous Technical — ⌘ ⏎ ⌫ ⌦
    (0x2500, 0x257F),  # Box Drawing
    (0x2580, 0x259F),  # Block Elements
    (0x25A0, 0x25FF),  # Geometric Shapes — ▲ ● ■
    (0x2600, 0x26FF),  # Miscellaneous Symbols
    (0x2700, 0x27BF),  # Dingbats — ✓ ✗ ✨
    (0xE0A0, 0xE0D4),  # Powerline / Starship prompt arrows
    (0xFE0E, 0xFE0F),  # Variation selectors
    (0xFFFD, 0xFFFD),  # Replacement character
]

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "fonts")


def build(zip_path):
    if not os.path.isfile(zip_path):
        sys.exit(f"archive not found: {zip_path}\ndownload it from {RELEASE}")

    os.makedirs(OUT_DIR, exist_ok=True)
    written = []

    with zipfile.ZipFile(zip_path) as zf:
        for style, weight in WEIGHTS.items():
            src = f"WOFF2/IosevkaTerm-{style}.woff2"
            font = TTFont(io.BytesIO(zf.read(src)))

            before = len(font.getGlyphOrder())
            options = subset.Options()
            options.flavor = "woff2"
            options.desubroutinize = True
            options.drop_tables += ["DSIG"]
            options.name_IDs = [1, 2, 4, 6]  # family, subfamily, full name, postscript
            options.name_legacy = False
            options.notdef_outline = True
            options.recalc_bounds = False
            # Ligatures are switched off in CSS for terminal text, so their
            # substitutions are dead weight here too. This keeps the file small
            # without changing what is drawn.
            options.layout_features = []
            options.hinting = True

            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=[c for a, b in RANGES for c in range(a, b + 1)])
            subsetter.subset(font)

            after = len(font.getGlyphOrder())
            out = os.path.join(OUT_DIR, f"iosevka-term-{weight}.woff2")
            font.flavor = "woff2"
            font.save(out)

            kb = os.path.getsize(out) // 1024
            written.append((style, weight, before, after, kb))
            print(f"  IosevkaTerm-{style} -> iosevka-term-{weight}.woff2  "
                  f"{before} -> {after} glyphs, {kb} KB")

    with open(os.path.join(OUT_DIR, "PROVENANCE.md"), "w") as fh:
        fh.write(f"""# Terminal webfont provenance

`iosevka-term-400.woff2` and `iosevka-term-600.woff2` are subsets of **Iosevka
Term {VERSION}**, family name `{FAMILY}`.

- Upstream: <{RELEASE}>
- Licence: SIL Open Font License 1.1 (see the upstream repository)
- Rebuild: `npm run font:build -- <path to the release archive>`

The subset covers the ranges a terminal renders, including box drawing, block
elements and the Powerline arrow set. If a glyph is ever missing, add its range
to `scripts/subset-fonts.py` and rebuild — do not drop in the unsubsetted
files, which are ~1.6 MB each.

Only two weights are bundled because the terminal pins 400 for regular text and
600 for SGR 1 bold. Any other weight would fall back to a different face and
break the grid's apparent monospacing.
""")
    print(f"  provenance written to public/fonts/PROVENANCE.md")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(sys.argv[1])