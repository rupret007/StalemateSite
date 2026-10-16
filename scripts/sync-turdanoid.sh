#!/usr/bin/env bash
# Vendors Turdanoid (github.com/rupret007/Turdanoid, owned by the same account) into /play/.
# Usage: scripts/sync-turdanoid.sh [ref]   (default: main)
set -euo pipefail
REF="${1:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 --branch "$REF" https://github.com/rupret007/Turdanoid.git "$TMP/t"
SHA="$(git -C "$TMP/t" rev-parse --short HEAD)"
DEST="$ROOT/play"
rm -rf "$DEST"; mkdir -p "$DEST"
cd "$TMP/t"
cp -r index.html TurdAnoid.html turdtris.html turdjack.html crapeights.html turdrummy.html turdspades.html neon-arkanoid.html hub.html game.js favicon.svg assets games "$DEST/"
find "$DEST/games" -name '*.test.*' -delete
cd "$DEST"
for f in *.html; do
  # noindex on every vendored page
  sed -i 's|<head>|<head>\n<meta name="robots" content="noindex,nofollow">|' "$f"
done
# Light Stalemate strip on the hub only; game pages keep their own full-screen UI untouched
for f in index.html; do
  sed -i 's|</head>|<link rel="stylesheet" href="stalemate-strip.css">\n</head>|' "$f"
  perl -0pi -e 's|(<body[^>]*>)|$1\n<nav class="stalemate-strip" aria-label="Stalemate"><a href="../" class="sm-home"><img src="../assets/mark.svg" alt="" width="22" height="22"> stalemate.band</a><a href="https://www.youtube.com/\@stalemate.punkband" class="sm-listen" rel="noopener">Listen to Manic</a></nav>|' "$f"
done
cp "$ROOT/scripts/stalemate-strip.css" "$DEST/stalemate-strip.css"
# Stalemate overlay (music + checkerboard), re-applied on every sync
mkdir -p "$DEST/stalemate"
cp "$ROOT/scripts/stalemate-overlay/"* "$DEST/stalemate/"
sed -i 's|</head>|<link rel="stylesheet" href="stalemate/stalemate-overlay.css">\n</head>|' TurdAnoid.html
sed -i 's|</body>|<script src="stalemate/stalemate-overlay.js"></script>\n</body>|' TurdAnoid.html
printf 'Vendored from github.com/rupret007/Turdanoid@%s (%s). Same owner as this repo; no separate license file upstream.\nDo not edit by hand: run scripts/sync-turdanoid.sh\n' "$SHA" "$REF" > "$DEST/VENDORED.txt"
echo "Synced Turdanoid $SHA into play/"
