#!/usr/bin/env bash
# Self-test for opencode-speak. Exercises the paths that platform hooks use,
# without needing Claude Code, Codex or OpenCode running.
#
#   bash bin/tts-selftest.sh          # full run (synthesizes audio, ~40s)
#   bash bin/tts-selftest.sh --quiet  # skip audio, config/plumbing checks only

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${REPO_DIR}/bin"
QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

# Run against a throwaway config directory. The tests flip settings on and off,
# so pointing them at the real config would leave the user's TTS in whatever
# state the last assertion happened to set.
CFG=$(mktemp -d)
export OPENCODE_SPEAK_CONFIG_DIR="$CFG"

PASS=0
FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

cleanup() { rm -rf "$CFG"; }
trap cleanup EXIT INT TERM

# Seed the sandbox with defaults so the tests start from a known state.
bash "$BIN/tts-config.sh" init >/dev/null 2>&1

head_ "1. Dependencies"
for c in jq pactl; do
  command -v "$c" >/dev/null 2>&1 && ok "$c present" || bad "$c MISSING (required)"
done
ENGINES=0
command -v kokoro >/dev/null 2>&1 && { ok "kokoro engine present"; ENGINES=$((ENGINES+1)); }
command -v speak  >/dev/null 2>&1 && { ok "speak engine present";  ENGINES=$((ENGINES+1)); }
(( ENGINES > 0 )) || bad "no TTS engine installed (uv tool install kokoro-cli)"
if pactl info >/dev/null 2>&1; then ok "audio server reachable"; else bad "audio server unreachable"; fi

head_ "2. Config validation (bad values must be rejected)"
while read -r k v; do
  if bash "$BIN/tts-config.sh" set "$k" "$v" >/dev/null 2>&1; then
    bad "accepted invalid $k=$v"
  else
    ok "rejected $k=$v"
  fi
done <<'EOF'
enabled 1
engine nonsense
voice_speak bogus
speed_kokoro 99
speak_steps 3
unknown_key x
EOF

head_ "3. Config validation (good values must be accepted)"
while read -r k v; do
  if bash "$BIN/tts-config.sh" set "$k" "$v" >/dev/null 2>&1; then
    ok "accepted $k=$v"
  else
    bad "rejected valid $k=$v"
  fi
done <<'EOF'
engine speak
voice_speak emma
speed_speak 1.0
speak_steps 12
lang_speak auto
EOF

head_ "4. Whitespace tolerance (all hosts must agree)"
for variant in 'true' ' true ' 'true
'; do
  printf '%s' "$variant" > "$CFG/enabled"
  got=$(bash "$BIN/tts-config.sh" get enabled)
  [[ "$got" == "true" ]] && ok "normalised $(printf '%q' "$variant")" \
                         || bad "got '$got' from $(printf '%q' "$variant")"
done

head_ "5. on / off / toggle / stop"
bash "$BIN/tts-config.sh" on  >/dev/null 2>&1
[[ "$(bash "$BIN/tts-config.sh" get enabled)" == "true"  ]] && ok "on  -> true"  || bad "on failed"
bash "$BIN/tts-config.sh" off >/dev/null 2>&1
[[ "$(bash "$BIN/tts-config.sh" get enabled)" == "false" ]] && ok "off -> false" || bad "off failed"
bash "$BIN/tts-config.sh" toggle >/dev/null 2>&1
[[ "$(bash "$BIN/tts-config.sh" get enabled)" == "true"  ]] && ok "toggle -> true" || bad "toggle failed"
bash "$BIN/tts-config.sh" toggle >/dev/null 2>&1
[[ "$(bash "$BIN/tts-config.sh" get enabled)" == "false" ]] && ok "toggle -> false" || bad "toggle failed"

head_ "6. Disabled means silent"
bash "$BIN/tts-config.sh" off >/dev/null 2>&1
before=$(ls /tmp/opencode-speak-* 2>/dev/null | wc -l)
bash "$BIN/tts-speak.sh" --text "This must not be spoken because TTS is disabled." >/dev/null 2>&1
after=$(ls /tmp/opencode-speak-* 2>/dev/null | wc -l)
[[ "$before" == "$after" ]] && ok "no work done while disabled" || bad "ran while disabled"

if (( QUIET )); then
  head_ "Skipping audio tests (--quiet)"
else
  head_ "7. Claude Code Stop-hook payload (real JSON on stdin)"
  bash "$BIN/tts-config.sh" on >/dev/null 2>&1
  if echo '{"last_assistant_message":"Self test speaking through the Claude Code hook path."}' \
     | CLAUDE_PLUGIN_ROOT="${REPO_DIR}" bash "${REPO_DIR}/hooks/tts-stop.sh" >/dev/null 2>&1
  then ok "claude hook exit 0 (you should have heard speech)"
  else bad "claude hook returned non-zero"
  fi

  head_ "8. Codex transcript payload"
  TR=$(mktemp /tmp/tts-selftest-XXXX.jsonl)
  printf '%s\n' '{"role":"user","content":"hi"}' \
    '{"role":"assistant","content":"Self test speaking through the Codex hook path."}' > "$TR"
  if bash "${REPO_DIR}/codex/hooks/tts-stop.sh" "$TR" >/dev/null 2>&1
  then ok "codex hook exit 0"
  else bad "codex hook returned non-zero"
  fi
  rm -f "$TR"

  head_ "9. off interrupts speech in progress"
  bash "$BIN/tts-config.sh" on >/dev/null 2>&1
  bash "$BIN/tts-speak.sh" --text "A deliberately long sentence so that the off command has time to interrupt playback before it finishes speaking." >/dev/null 2>&1 &
  sleep 7
  playing=$(pgrep -x mpv 2>/dev/null | wc -l)
  bash "$BIN/tts-config.sh" off >/dev/null 2>&1
  sleep 1
  stopped=$(pgrep -x mpv 2>/dev/null | wc -l)
  if (( playing > 0 && stopped == 0 )); then ok "off killed playback ($playing -> $stopped)"
  elif (( playing == 0 ));            then bad "nothing was playing to interrupt"
  else                                     bad "playback survived off ($playing -> $stopped)"
  fi
  wait 2>/dev/null
fi

head_ "10. No stale pidfiles left"
sleep 1
bash "$BIN/tts-config.sh" status >/dev/null 2>&1   # prunes as a side effect
left=$(ls "$CFG"/run/*.pid 2>/dev/null | wc -l)
(( left == 0 )) && ok "pidfiles cleaned" || bad "$left stale pidfile(s) remain"

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
(( FAIL == 0 ))
