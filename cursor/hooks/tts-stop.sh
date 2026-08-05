#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${SCRIPT_DIR}/../bin"

# Read transcript_path from stdin JSON
INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")

if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
  exec bash "${BIN_DIR}/tts-speak.sh" --transcript "$TRANSCRIPT_PATH"
else
  exit 0
fi
