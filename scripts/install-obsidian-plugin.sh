#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_VAULT_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
VAULT_ROOT="${1:-$DEFAULT_VAULT_ROOT}"
SOURCE="$REPO_ROOT/obsidian/pi-learning"
TARGET="$VAULT_ROOT/.obsidian/plugins/pi-learning"

if [[ ! -d "$VAULT_ROOT/.obsidian" ]]; then
  echo "Obsidian vault config not found at: $VAULT_ROOT/.obsidian" >&2
  echo "Open this folder as an Obsidian vault first, or pass the vault path explicitly:" >&2
  echo "  $0 /path/to/vault" >&2
  exit 1
fi

mkdir -p "$TARGET"
cp "$SOURCE/manifest.json" "$TARGET/manifest.json"
cp "$SOURCE/main.js" "$TARGET/main.js"
cp "$SOURCE/styles.css" "$TARGET/styles.css"

echo "Installed Pi Learning plugin to:"
echo "  $TARGET"
echo
echo "Next: Obsidian → Settings → Community plugins → enable 'Pi Learning'."
echo "If it was already enabled, reload Obsidian or toggle the plugin off/on."
