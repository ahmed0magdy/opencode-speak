# /opencode-speak:tts - TTS Control Command

Control text-to-speech voice output for Claude Code.

## Usage

- `/opencode-speak:tts on` — Enable TTS
- `/opencode-speak:tts off` — Disable TTS
- `/opencode-speak:tts kokoro` — Switch to Kokoro engine
- `/opencode-speak:tts speak` — Switch to Supertonic 3 engine
- `/opencode-speak:tts voice NAME` — Change voice (e.g., af_heart, sara)
- `/opencode-speak:tts status` — Show current config
- `/opencode-speak:tts test` — Speak a test phrase

## Implementation

When the user runs this command, execute the appropriate `tts-config.sh` command:

```bash
# Enable/disable
~/.config/opencode-speak/../bin/tts-config.sh set enabled true
~/.config/opencode-speak/../bin/tts-config.sh set enabled false

# Switch engine
~/.config/opencode-speak/../bin/tts-config.sh set engine kokoro
~/.config/opencode-speak/../bin/tts-config.sh set engine speak

# Change voice
~/.config/opencode-speak/../bin/tts-config.sh set voice_kokoro NAME
~/.config/opencode-speak/../bin/tts-config.sh set voice_speak NAME

# Status
~/.config/opencode-speak/../bin/tts-config.sh status

# Test
echo "TTS is working" | bash PATH_TO/bin/tts-speak.sh --text "TTS is working"
```

## Available Voices

### Kokoro
Female: af_heart (default), af_sky, af_bella, af_sarah, af_nicole

### Supertonic 3
Female: sara (default), zara, aria, luna, elena
