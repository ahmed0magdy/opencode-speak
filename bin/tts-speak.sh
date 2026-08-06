#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${HOME}/.config/opencode-speak"
MAX_CHARS=2000

read_config() {
  local key="$1" default="$2"
  local file="${CONFIG_DIR}/${key}"
  if [[ -f "$file" ]]; then
    cat "$file"
  else
    echo "$default"
  fi
}

ENABLED=$(read_config "enabled" "false")
ENGINE=$(read_config "engine" "kokoro")
VOICE_KOKORO=$(read_config "voice_kokoro" "af_heart")
VOICE_SPEAK=$(read_config "voice_speak" "sara")
SPEED_KOKORO=$(read_config "speed_kokoro" "0.9")
SPEED_SPEAK=$(read_config "speed_speak" "0.9")
LANG_KOKORO=$(read_config "lang_kokoro" "en-us")
LANG_SPEAK=$(read_config "lang_speak" "auto")
KOKORO_MODEL=$(read_config "kokoro_model" "full")
SPEAK_STEPS=$(read_config "speak_steps" "12")

if [[ "$ENABLED" != "true" ]]; then
  exit 0
fi

if ! pactl info >/dev/null 2>&1; then
  exit 0
fi

TEXT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --text)
      TEXT="$2"
      shift 2
      ;;
    --stdin-json)
      INPUT=$(cat)
      TEXT=$(echo "$INPUT" | jq -r '.last_assistant_message // empty')
      shift
      ;;
    --transcript)
      TRANSCRIPT_PATH="$2"
      shift 2
      if [[ -f "$TRANSCRIPT_PATH" ]]; then
        TEXT=$(jq -rs '[.[] | select(.role == "assistant")] | last | .content // .text // ""' "$TRANSCRIPT_PATH" 2>/dev/null || echo "")
      fi
      ;;
    --engine)
      ENGINE="$2"
      shift 2
      ;;
    --voice)
      if [[ "$ENGINE" == "kokoro" ]]; then
        VOICE_KOKORO="$2"
      else
        VOICE_SPEAK="$2"
      fi
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$TEXT" || ${#TEXT} -lt 5 ]]; then
  exit 0
fi

strip_markdown() {
  sed -E \
    -e 's/```[^`]*```/ /g' \
    -e 's/`([^`]+)`/\1/g' \
    -e 's/^#{1,6} *//g' \
    -e 's/\*\*([^*]+)\*\*/\1/g' \
    -e 's/\*([^*]+)\*/\1/g' \
    -e 's/__([^_]+)__/\1/g' \
    -e 's/_([^_]+)_/\1/g' \
    -e 's/~~([^~]+)~~/\1/g' \
    -e 's/\[([^]]+)\]\([^)]+\)/\1/g' \
    -e 's/!\[[^]]*\]\([^)]+\)//g' \
    -e 's/^[[:space:]]*[-*+] //g' \
    -e 's/^[[:space:]]*[0-9]+\. //g' \
    -e 's/^[[:space:]]*> //g'
}

sanitize_for_speech() {
  sed -E \
    -e 's/--([a-zA-Z][a-zA-Z0-9_-]*)/\1/g' \
    -e 's/([a-zA-Z0-9_]+)\.([a-z]{1,4}):([0-9]+)/\1 dot \2, line \3/g' \
    -e 's/([a-zA-Z0-9_]+)\.([a-z]{1,4})/\1 dot \2/g' \
    -e 's|https?://[^ ]*||g' \
    -e 's/[<>{}|\\^~`]+/ /g' \
    -e 's/"{2,}/ /g' \
    -e "s/'{2,}/ /g" \
    -e 's/-{2,}/ /g' \
    -e 's/_{2,}/ /g' \
    -e 's/={2,}/ /g' \
    -e 's/0x[0-9a-fA-F]+/hex value/g' \
    -e 's/  +/ /g'
}

TEXT=$(echo "$TEXT" | strip_markdown | sanitize_for_speech | tr '\n' ' ' | sed 's/  */ /g')
TEXT="${TEXT:0:$MAX_CHARS}"

if [[ ${#TEXT} -lt 5 ]]; then
  exit 0
fi

TMP_TEXT=$(mktemp /tmp/opencode-speak-XXXXXXXX.txt)
TMP_WAV=$(mktemp /tmp/opencode-speak-XXXXXXXX.wav)
TTS_PID=""
PLAYER_PID=""
cleanup() {
  [[ -n "$TTS_PID" ]] && kill "$TTS_PID" 2>/dev/null; wait "$TTS_PID" 2>/dev/null
  [[ -n "$PLAYER_PID" ]] && kill "$PLAYER_PID" 2>/dev/null; wait "$PLAYER_PID" 2>/dev/null
  rm -f "$TMP_TEXT" "$TMP_WAV"
}
trap cleanup EXIT INT TERM
echo "$TEXT" > "$TMP_TEXT"

KOKORO_BIN=$(command -v kokoro 2>/dev/null || echo "${HOME}/.local/bin/kokoro")
SPEAK_BIN=$(command -v speak 2>/dev/null || echo "${HOME}/.local/bin/speak")

export ONNX_PROVIDER="${ONNX_PROVIDER:-CUDAExecutionProvider}"

if [[ "$ENGINE" == "kokoro" ]]; then
  if [[ -x "$KOKORO_BIN" ]]; then
    "$KOKORO_BIN" speak --voice "$VOICE_KOKORO" --speed "$SPEED_KOKORO" --lang "$LANG_KOKORO" --model "$KOKORO_MODEL" -o "$TMP_WAV" --service off < "$TMP_TEXT" >/dev/null 2>&1 &
    TTS_PID=$!
    wait "$TTS_PID" 2>/dev/null
  fi
else
  if [[ -x "$SPEAK_BIN" ]]; then
    "$SPEAK_BIN" -v "$VOICE_SPEAK" -s "$SPEED_SPEAK" -l "$LANG_SPEAK" --steps "$SPEAK_STEPS" --no-daemon -o "$TMP_WAV" < "$TMP_TEXT" >/dev/null 2>&1 &
    TTS_PID=$!
    wait "$TTS_PID" 2>/dev/null
  fi
fi

if [[ -s "$TMP_WAV" ]]; then
  if command -v mpv >/dev/null 2>&1; then
    mpv --no-terminal --no-video "$TMP_WAV" >/dev/null 2>&1 &
  elif command -v ffplay >/dev/null 2>&1; then
    ffplay -nodisp -autoexit "$TMP_WAV" >/dev/null 2>&1 &
  fi
  PLAYER_PID=$!
  wait "$PLAYER_PID" 2>/dev/null
fi
