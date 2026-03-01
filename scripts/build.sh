#!/usr/bin/env bash
# Ouro static build script
# Copies static game files to build/ with cache-busting hash suffixes

set -e

SRC="ouro/web/static"
DEST="build"

# Clean and recreate build directory
rm -rf "$DEST"
mkdir -p "$DEST"

# Compute short hashes for cache-busting
hash_engine=$(sha256sum "$SRC/engine.js"  | cut -c1-8)
hash_game=$(sha256sum   "$SRC/game.js"    | cut -c1-8)
hash_style=$(sha256sum  "$SRC/style.css"  | cut -c1-8)

# Copy assets with hashed filenames
cp "$SRC/engine.js"  "$DEST/engine.${hash_engine}.js"
cp "$SRC/game.js"    "$DEST/game.${hash_game}.js"
cp "$SRC/style.css"  "$DEST/style.${hash_style}.css"
cp -r "$SRC/icons"   "$DEST/icons"

# Rewrite index.html to reference hashed filenames
sed \
  -e "s|href=\"style.css\"|href=\"style.${hash_style}.css\"|g" \
  -e "s|src=\"engine.js\"|src=\"engine.${hash_engine}.js\"|g" \
  -e "s|src=\"game.js\"|src=\"game.${hash_game}.js\"|g" \
  "$SRC/index.html" > "$DEST/index.html"

# Azure SWA routing config must live in app_location
cp staticwebapp.config.json "$DEST/staticwebapp.config.json"

echo "Build complete → $DEST/"
ls -lh "$DEST"
