#!/usr/bin/env bash
# Generate (or regenerate) the Safari Web Extension Xcode wrapper from src/.
#
# The web extension in src/ is the source of truth. We run Apple's converter
# WITHOUT --copy-resources so the generated Xcode project *references* src/
# directly: editing files in src/ and rebuilding in Xcode picks up the changes
# with no copy step. Re-run this script only if you change the manifest's
# structure or want a fresh project.
#
# Usage: ./scripts/convert.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"
PROJECT_DIR="$ROOT/xcode"
APP_NAME="Pinmark"
BUNDLE_ID="com.mculnane.Pinmark"

echo "Generating Xcode project at $PROJECT_DIR (references $SRC)…"
xcrun safari-web-extension-converter "$SRC" \
  --project-location "$PROJECT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --no-open \
  --no-prompt \
  --force

echo
echo "Done. Open the project with:"
echo "  open \"$PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj\""
