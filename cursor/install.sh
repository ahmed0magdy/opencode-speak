#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/../bin"
HOOK_SCRIPT="${SCRIPT_DIR}/hooks/tts-stop.sh"
CURSOR_HOOKS="${HOME}/.cursor/hooks.json"

echo "=== opencode-speak: Cursor Hook Installer ==="
echo ""

# Ensure bin scripts are executable
chmod +x "${BIN_DIR}/tts-speak.sh" "${BIN_DIR}/tts-config.sh"
chmod +x "${HOOK_SCRIPT}"

# Initialize config
bash "${BIN_DIR}/tts-config.sh" init

# Install the stop hook into ~/.cursor/hooks.json
HOOK_CMD="bash \"${HOOK_SCRIPT}\""

if [[ -f "$CURSOR_HOOKS" ]]; then
  EXISTING=$(cat "$CURSOR_HOOKS")
  # Check if already installed
  if echo "$EXISTING" | grep -q "opencode-speak" 2>/dev/null; then
    echo "Hook already installed in ${CURSOR_HOOKS}"
    echo "Done!"
    exit 0
  fi

  # Merge new stop hook into existing hooks
  NEW_HOOK=$(jq --arg cmd "$HOOK_CMD" '
    .hooks.stop = (.hooks.stop // []) + [{
      "command": $cmd,
      "description": "opencode-speak: TTS voice output"
    }]
  ' <<< "$EXISTING")
  echo "$NEW_HOOK" > "$CURSOR_HOOKS"
else
  mkdir -p "$(dirname "$CURSOR_HOOKS")"
  cat > "$CURSOR_HOOKS" <<ENDJSON
{
  "version": 1,
  "hooks": {
    "stop": [
      {
        "command": "${HOOK_CMD}",
        "description": "opencode-speak: TTS voice output"
      }
    ]
  }
}
ENDJSON
fi

echo "Installed stop hook to: ${CURSOR_HOOKS}"
echo ""
echo "TTS is disabled by default. Enable with:"
echo "  bash ${BIN_DIR}/tts-config.sh set enabled true"
echo ""
echo "Done!"
