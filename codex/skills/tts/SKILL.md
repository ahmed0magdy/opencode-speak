# TTS Voice Output Skill

This skill enables text-to-speech for Codex CLI responses.

## What it does

After each assistant response, the text is spoken aloud using either Kokoro (82M) or Supertonic 3 TTS engines. Both run fully offline on CPU.

## Control TTS

To control TTS, run these commands in your terminal:

```bash
# Enable/disable
~/.config/opencode-speak/../bin/tts-config.sh set enabled true
~/.config/opencode-speak/../bin/tts-config.sh set enabled false

# Switch engine
~/.config/opencode-speak/../bin/tts-config.sh set engine kokoro
~/.config/opencode-speak/../bin/tts-config.sh set engine speak

# Change voice
~/.config/opencode-speak/../bin/tts-config.sh set voice_kokoro af_heart
~/.config/opencode-speak/../bin/tts-config.sh set voice_speak sara

# Show status
~/.config/opencode-speak/../bin/tts-config.sh status
```

## Available Voices

### Kokoro (default engine)
- **Female**: af_heart (default), af_sky, af_bella, af_sarah, af_nicole, af_nova, af_river
- **Male**: am_adam, am_michael, am_echo

### Supertonic 3
- **Female**: sara (default), zara, aria, luna, elena
- **Male**: leo, dan, milo, kai, raj

## Requirements

- `kokoro-cli`: `uv tool install kokoro-cli`
- `speak-cli`: `uv tool install speak-cli`
- `espeak-ng`: `sudo apt install espeak-ng` (Linux, required for Kokoro)
- `jq`: `sudo apt install jq`
