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

Keys: enabled, engine, voice_kokoro, voice_speak, speed_kokoro, speed_speak,
      lang_kokoro, lang_speak, kokoro_model, speak_steps

Examples:
  tts-config.sh set enabled true
  tts-config.sh set engine kokoro
  tts-config.sh set voice_kokoro af_bella
  tts-config.sh set speed_kokoro 0.9
  tts-config.sh set speak_steps 10
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
      enabled)       echo "false" ;;
      engine)        echo "kokoro" ;;
      voice_kokoro)  echo "af_heart" ;;
      voice_speak)   echo "sara" ;;
      speed_kokoro)  echo "1.0" ;;
      speed_speak)   echo "1.0" ;;
      lang_kokoro)   echo "en-us" ;;
      lang_speak)    echo "auto" ;;
      kokoro_model)  echo "int8" ;;
      speak_steps)   echo "8" ;;
      *)             echo "" ;;
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
  [[ -f "${CONFIG_DIR}/enabled" ]]       || echo -n "false"    > "${CONFIG_DIR}/enabled"
  [[ -f "${CONFIG_DIR}/engine" ]]        || echo -n "kokoro"   > "${CONFIG_DIR}/engine"
  [[ -f "${CONFIG_DIR}/voice_kokoro" ]]  || echo -n "af_heart" > "${CONFIG_DIR}/voice_kokoro"
  [[ -f "${CONFIG_DIR}/voice_speak" ]]   || echo -n "sara"     > "${CONFIG_DIR}/voice_speak"
  [[ -f "${CONFIG_DIR}/speed_kokoro" ]]  || echo -n "1.0"      > "${CONFIG_DIR}/speed_kokoro"
  [[ -f "${CONFIG_DIR}/speed_speak" ]]   || echo -n "1.0"      > "${CONFIG_DIR}/speed_speak"
  [[ -f "${CONFIG_DIR}/lang_kokoro" ]]   || echo -n "en-us"    > "${CONFIG_DIR}/lang_kokoro"
  [[ -f "${CONFIG_DIR}/lang_speak" ]]    || echo -n "auto"     > "${CONFIG_DIR}/lang_speak"
  [[ -f "${CONFIG_DIR}/kokoro_model" ]]  || echo -n "int8"     > "${CONFIG_DIR}/kokoro_model"
  [[ -f "${CONFIG_DIR}/speak_steps" ]]   || echo -n "8"        > "${CONFIG_DIR}/speak_steps"
  echo "Config initialized at ${CONFIG_DIR}"
}

config_status() {
  echo "═══ opencode-speak config ═══"
  echo ""
  echo "  Status:       $(config_get enabled)"
  echo "  Engine:       $(config_get engine)"
  echo ""
  echo "── Kokoro Settings ──"
  echo "  Voice:  $(config_get voice_kokoro)  [options: /tts voices]"
  echo "  Speed:  $(config_get speed_kokoro)  [0.5 - 4.0]"
  echo "  Lang:   $(config_get lang_kokoro)  [en-us, en-gb, ja, zh, hi, fr, it, pt, es, ko]"
  echo "  Model:  $(config_get kokoro_model)  [int8, fp16, full]"
  echo ""
  echo "── Supertonic 3 Settings ──"
  echo "  Voice:  $(config_get voice_speak)  [options: /tts voices]"
  echo "  Speed:  $(config_get speed_speak)  [0.7 - 2.0]"
  echo "  Lang:   $(config_get lang_speak)  [auto, na, ar, de, es, fr, hi, it, ja, ko, pt, ru, zh]"
  echo "  Steps:  $(config_get speak_steps)  [5-12, higher=better quality]"
  echo ""
  echo "── Set via: tts-config.sh set <key> <value> ──"
  echo "  Keys: enabled, engine, voice_kokoro, voice_speak,"
  echo "        speed_kokoro, speed_speak, lang_kokoro, lang_speak,"
  echo "        kokoro_model, speak_steps"
  echo "═════════════════════════════════"
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
