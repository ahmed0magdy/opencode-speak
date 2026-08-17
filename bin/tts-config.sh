#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${HOME}/.config/opencode-speak"

usage() {
  cat <<'EOF'
Usage: tts-config.sh <command> [args]

Commands:
  on                     Enable TTS
  off                    Disable TTS and stop any speech in progress
  toggle                 Flip between on and off
  stop                   Stop speech in progress, leave TTS enabled
  get <key>              Read a config value
  set <key> <value>      Write a config value
  init                   Initialize config with defaults
  status                 Show all current settings

Keys: enabled, engine, voice_kokoro, voice_speak, speed_kokoro, speed_speak,
      lang_kokoro, lang_speak, kokoro_model, speak_steps

Examples:
  tts-config.sh on
  tts-config.sh off
  tts-config.sh toggle
  tts-config.sh set engine kokoro
  tts-config.sh set voice_kokoro af_bella
  tts-config.sh set speak_steps 10
  tts-config.sh status
EOF
}

VALID_KOKORO_VOICES="af_heart af_bella af_nova af_sky af_jessica af_nicole af_aoede af_kore af_alloy af_river af_sarah bf_emma bf_isabella bf_lily bf_alice am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa bm_daniel bm_fable bm_george bm_lewis ef_dora em_alex em_santa ff_siwis hf_alpha hf_beta hm_omega hm_psi if_sara im_nicola jf_alpha jf_gongitsune jf_nezumi jf_tebukuro jm_kumo pf_dora pm_alex pm_santa zf_xiaobei zf_xiaoni zf_xiaoxiao zf_xiaoyi zm_yunjian zm_yunxi zm_yunxia zm_yunyang"
VALID_SPEAK_VOICES="sara emma lily maya nora james daniel leo ryan noah"
VALID_KOKORO_LANGS="en-us en-gb ja zh hi fr it pt es ko"
VALID_SPEAK_LANGS="auto na ar de es fr hi it ja ko pt ru zh"
VALID_MODELS="int8 fp16 full"

# Is $1 one of the space-separated words in $2?
in_list() {
  case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# Numeric range check that works without bc.
in_range() {
  awk -v v="$1" -v lo="$2" -v hi="$3" \
    'BEGIN { exit !(v+0 == v && v >= lo && v <= hi) }' 2>/dev/null
}

# Reject bad values instead of writing them: an invalid "enabled" reads as
# off and an invalid "engine" silently falls through to Supertonic, so a
# typo would otherwise look like a broken install.
validate() {
  local key="$1" value="$2"
  case "$key" in
    enabled)
      in_list "$value" "true false" || {
        echo "Error: enabled must be true or false (got '$value')" >&2; return 1; }
      ;;
    engine)
      in_list "$value" "kokoro speak" || {
        echo "Error: engine must be kokoro or speak (got '$value')" >&2; return 1; }
      ;;
    voice_kokoro)
      in_list "$value" "$VALID_KOKORO_VOICES" || {
        echo "Error: unknown Kokoro voice '$value'" >&2; return 1; }
      ;;
    voice_speak)
      in_list "$value" "$VALID_SPEAK_VOICES" || {
        echo "Error: unknown Supertonic voice '$value' (valid: $VALID_SPEAK_VOICES)" >&2; return 1; }
      ;;
    speed_kokoro)
      in_range "$value" 0.5 4.0 || {
        echo "Error: speed_kokoro must be 0.5-4.0 (got '$value')" >&2; return 1; }
      ;;
    speed_speak)
      in_range "$value" 0.7 2.0 || {
        echo "Error: speed_speak must be 0.7-2.0 (got '$value')" >&2; return 1; }
      ;;
    lang_kokoro)
      in_list "$value" "$VALID_KOKORO_LANGS" || {
        echo "Error: invalid Kokoro lang '$value' (valid: $VALID_KOKORO_LANGS)" >&2; return 1; }
      ;;
    lang_speak)
      in_list "$value" "$VALID_SPEAK_LANGS" || {
        echo "Error: invalid Supertonic lang '$value' (valid: $VALID_SPEAK_LANGS)" >&2; return 1; }
      ;;
    kokoro_model)
      in_list "$value" "$VALID_MODELS" || {
        echo "Error: model must be one of: $VALID_MODELS (got '$value')" >&2; return 1; }
      ;;
    speak_steps)
      [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 5 && value <= 12 )) || {
        echo "Error: speak_steps must be an integer 5-12 (got '$value')" >&2; return 1; }
      ;;
    *)
      echo "Error: unknown key '$key'" >&2
      echo "Valid keys: enabled, engine, voice_kokoro, voice_speak, speed_kokoro," >&2
      echo "            speed_speak, lang_kokoro, lang_speak, kokoro_model, speak_steps" >&2
      return 1
      ;;
  esac
}

ensure_dir() {
  mkdir -p "$CONFIG_DIR"
}

config_get() {
  local key="$1" value
  local file="${CONFIG_DIR}/${key}"
  if [[ -f "$file" ]]; then
    # Trim to match tts-speak.sh and the plugin, so `status` reports the value
    # the engines will actually act on.
    value=$(< "$file")
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s\n' "$value"
  else
    case "$key" in
      enabled)       echo "false" ;;
      engine)        echo "kokoro" ;;
      voice_kokoro)  echo "af_heart" ;;
      voice_speak)   echo "sara" ;;
      speed_kokoro)  echo "0.9" ;;
      speed_speak)   echo "0.9" ;;
      lang_kokoro)   echo "en-us" ;;
      lang_speak)    echo "auto" ;;
      kokoro_model)  echo "full" ;;
      speak_steps)   echo "12" ;;
      *)             echo "" ;;
    esac
  fi
}

config_set() {
  local key="$1" value="$2"
  validate "$key" "$value" || return 1
  ensure_dir
  # Write via a temp file + atomic rename so a concurrent reader never sees a
  # half-written value (hooks on several platforms may read at any moment).
  local dest="${CONFIG_DIR}/${key}"
  local tmp="${dest}.$$"
  printf '%s' "$value" > "$tmp" && mv -f "$tmp" "$dest"
}

# Stop speech in progress. Uses the pidfiles written by tts-speak.sh rather
# than matching command lines: pgrep -f would also match the shell that
# invoked this script, since its own command line contains the pattern.
stop_speech() {
  local pidfile pid
  for pidfile in "${CONFIG_DIR}"/run/*.pid; do
    [[ -e "$pidfile" ]] || continue
    # Each pidfile holds "<wrapper-pid> [<child-pid>]". Kill the child first so
    # audio stops immediately, then the wrapper.
    for pid in $(cat "$pidfile" 2>/dev/null || true); do
      is_our_pid "$pid" || continue
      kill -TERM "$pid" 2>/dev/null || true
    done
    rm -f "$pidfile" 2>/dev/null || true
  done
  sweep_orphans
  return 0
}

# A pidfile can outlive a hard-killed run (SIGKILL bypasses the cleanup trap),
# and the OS reuses PIDs — so confirm the process is still one of ours before
# signalling it, or we could SIGTERM an unrelated program.
is_our_pid() {
  local pid="$1" cmd
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
  [[ -z "$cmd" ]] && return 1
  case "$cmd" in
    *opencode-speak-*|*tts-speak.sh*) return 0 ;;
    *) return 1 ;;
  esac
}

# Delete pidfiles whose processes are all gone. Called on every status/stop so
# crashed runs cannot accumulate stale PIDs indefinitely.
prune_pidfiles() {
  local pidfile pid alive
  for pidfile in "${CONFIG_DIR}"/run/*.pid; do
    [[ -e "$pidfile" ]] || continue
    alive=0
    for pid in $(cat "$pidfile" 2>/dev/null || true); do
      is_our_pid "$pid" && alive=1
    done
    (( alive )) || rm -f "$pidfile" 2>/dev/null || true
  done
}

# Remove temp files left behind by a host that exited mid-synthesis. Only
# touches files older than 5 minutes and not currently open, so a synthesis
# running in another session is never pulled out from under it.
sweep_orphans() {
  local f
  for f in /tmp/opencode-speak-*.txt /tmp/opencode-speak-*.wav; do
    [[ -e "$f" ]] || continue
    # -mmin +5 is the guard against deleting an in-flight file.
    if [[ -n "$(find "$f" -maxdepth 0 -mmin +5 2>/dev/null)" ]]; then
      if command -v fuser >/dev/null 2>&1; then
        fuser -s "$f" 2>/dev/null && continue   # still open by some process
      fi
      rm -f "$f" 2>/dev/null || true
    fi
  done
}

config_init() {
  ensure_dir
  [[ -f "${CONFIG_DIR}/enabled" ]]       || echo -n "false"    > "${CONFIG_DIR}/enabled"
  [[ -f "${CONFIG_DIR}/engine" ]]        || echo -n "kokoro"   > "${CONFIG_DIR}/engine"
  [[ -f "${CONFIG_DIR}/voice_kokoro" ]]  || echo -n "af_heart" > "${CONFIG_DIR}/voice_kokoro"
  [[ -f "${CONFIG_DIR}/voice_speak" ]]   || echo -n "sara"     > "${CONFIG_DIR}/voice_speak"
  [[ -f "${CONFIG_DIR}/speed_kokoro" ]]  || echo -n "0.9"      > "${CONFIG_DIR}/speed_kokoro"
  [[ -f "${CONFIG_DIR}/speed_speak" ]]   || echo -n "0.9"      > "${CONFIG_DIR}/speed_speak"
  [[ -f "${CONFIG_DIR}/lang_kokoro" ]]   || echo -n "en-us"    > "${CONFIG_DIR}/lang_kokoro"
  [[ -f "${CONFIG_DIR}/lang_speak" ]]    || echo -n "auto"     > "${CONFIG_DIR}/lang_speak"
  [[ -f "${CONFIG_DIR}/kokoro_model" ]]  || echo -n "full"     > "${CONFIG_DIR}/kokoro_model"
  [[ -f "${CONFIG_DIR}/speak_steps" ]]   || echo -n "12"       > "${CONFIG_DIR}/speak_steps"
  echo "Config initialized at ${CONFIG_DIR}"
}

config_status() {
  prune_pidfiles
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
  on)
    config_set enabled true
    echo "TTS: ON  (engine: $(config_get engine), voice: $(config_get "voice_$(config_get engine)"))"
    ;;
  off)
    config_set enabled false
    stop_speech
    echo "TTS: OFF"
    ;;
  toggle)
    if [[ "$(config_get enabled)" == "true" ]]; then
      config_set enabled false
      stop_speech
      echo "TTS: OFF"
    else
      config_set enabled true
      echo "TTS: ON  (engine: $(config_get engine), voice: $(config_get "voice_$(config_get engine)"))"
    fi
    ;;
  stop)
    stop_speech
    echo "Speech stopped (TTS still $(config_get enabled))"
    ;;
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
