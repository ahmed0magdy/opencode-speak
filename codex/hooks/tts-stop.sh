#!/usr/bin/env bash
set -euo pipefail

# Codex passes the transcript path as the first argument.
TRANSCRIPT_PATH="${1:-}"

# Locate tts-speak.sh across the supported install layouts:
#   1. plugin copied on its own     -> bin/ ships beside the hook
#   2. plugin dir inside a clone    -> bin/ is two levels up (repo root)
#   3. documented clone location    -> ~/.local/share/opencode-speak/bin
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${PLUGIN_ROOT:-$(dirname "$HOOK_DIR")}"

for candidate in \
  "${PLUGIN_ROOT}/bin/tts-speak.sh" \
  "${PLUGIN_ROOT}/../bin/tts-speak.sh" \
  "${HOOK_DIR}/../../bin/tts-speak.sh" \
  "${HOME}/.local/share/opencode-speak/bin/tts-speak.sh"
do
  if [[ -f "$candidate" ]]; then
    [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]] || exit 0
    exec bash "$candidate" --transcript "$TRANSCRIPT_PATH"
  fi
done

# No engine script found — stay silent rather than breaking the session.
exit 0
