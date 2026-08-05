#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${HOME}/.config/opencode-speak"

usage() {
  cat <<'EOF'
Usage: tts-config.sh <command> [args]

Commands:
  get <key>              Read a config value
  set <key> <value>      Write a config value
  init                   Initialize config with defaults
  status                 Show all current settings

Keys: enabled, engine, voice_kokoro, voice_speak

Examples:
  tts-config.sh set enabled true
  tts-config.sh set engine kokoro
  tts-config.sh get voice_kokoro
  tts-config.sh status
EOF
}

ensure_dir() {
  mkdir -p "$CONFIG_DIR"
}

config_get() {
  local key="$1"
  local file="${CONFIG_DIR}/${key}"
  if [[ -f "$file" ]]; then
    cat "$file"
  else
    case "$key" in
      enabled)      echo "false" ;;
      engine)       echo "kokoro" ;;
      voice_kokoro) echo "af_heart" ;;
      voice_speak)  echo "sara" ;;
      *)            echo "" ;;
    esac
  fi
}

config_set() {
  local key="$1" value="$2"
  ensure_dir
  echo -n "$value" > "${CONFIG_DIR}/${key}"
}

config_init() {
  ensure_dir
  [[ -f "${CONFIG_DIR}/enabled" ]]      || echo -n "false"    > "${CONFIG_DIR}/enabled"
  [[ -f "${CONFIG_DIR}/engine" ]]       || echo -n "kokoro"   > "${CONFIG_DIR}/engine"
  [[ -f "${CONFIG_DIR}/voice_kokoro" ]] || echo -n "af_heart" > "${CONFIG_DIR}/voice_kokoro"
  [[ -f "${CONFIG_DIR}/voice_speak" ]]  || echo -n "sara"     > "${CONFIG_DIR}/voice_speak"
  echo "Config initialized at ${CONFIG_DIR}"
}

config_status() {
  echo "opencode-speak configuration (${CONFIG_DIR}):"
  echo "  enabled:      $(config_get enabled)"
  echo "  engine:       $(config_get engine)"
  echo "  voice_kokoro: $(config_get voice_kokoro)"
  echo "  voice_speak:  $(config_get voice_speak)"
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

case "$1" in
  get)
    [[ $# -lt 2 ]] && { echo "Error: key required"; exit 1; }
    config_get "$2"
    ;;
  set)
    [[ $# -lt 3 ]] && { echo "Error: key and value required"; exit 1; }
    config_set "$2" "$3"
    ;;
  init)
    config_init
    ;;
  status)
    config_status
    ;;
  *)
    usage
    exit 1
    ;;
esac
