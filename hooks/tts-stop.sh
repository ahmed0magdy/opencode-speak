#!/usr/bin/env bash
set -euo pipefail

# Claude Code Stop hook: speaks the assistant's last message.
# The payload arrives as JSON on stdin.

# ${CLAUDE_PLUGIN_ROOT} is the plugin's install directory, which contains
# bin/. Fall back to this script's own location for a plain clone or a
# --plugin-dir run, where the variable may not be set.
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$HOOK_DIR")}"

TTS_SPEAK="${PLUGIN_ROOT}/bin/tts-speak.sh"
[[ -f "$TTS_SPEAK" ]] || TTS_SPEAK="${HOOK_DIR}/../bin/tts-speak.sh"

# Missing engine script is not an error worth breaking the session over.
[[ -f "$TTS_SPEAK" ]] || exit 0

exec bash "$TTS_SPEAK" --stdin-json
