# Terminal webfont provenance

`iosevka-term-400.woff2` and `iosevka-term-600.woff2` are subsets of **Iosevka
Term 34.9.0**, family name `Iosevka Term Web`.

- Upstream: <https://github.com/be5invis/Iosevka/releases/download/v34.9.0/PkgWebFont-IosevkaTerm-34.9.0.zip>
- Licence: SIL Open Font License 1.1 (see the upstream repository)
- Rebuild: `npm run font:build -- <path to the release archive>`

The subset covers the ranges a terminal renders, including box drawing, block
elements and the Powerline arrow set. If a glyph is ever missing, add its range
to `scripts/subset-fonts.py` and rebuild — do not drop in the unsubsetted
files, which are ~1.6 MB each.

Only two weights are bundled because the terminal pins 400 for regular text and
600 for SGR 1 bold. Any other weight would fall back to a different face and
break the grid's apparent monospacing.
