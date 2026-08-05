# /opencode-speak:tts - TTS Control Command

Control text-to-speech voice output for Claude Code.

## Usage

- `/opencode-speak:tts` — Show full config panel (status, engine, voice, available voices)
- `/opencode-speak:tts on` — Enable TTS
- `/opencode-speak:tts off` — Disable TTS
- `/opencode-speak:tts kokoro` — Switch to Kokoro engine
- `/opencode-speak:tts speak` — Switch to Supertonic 3 engine
- `/opencode-speak:tts roleplay` — Set best warm female voice for roleplay
- `/opencode-speak:tts voice NAME` — Change voice (e.g., af_bella, emma)
- `/opencode-speak:tts voices` — List all available voices
- `/opencode-speak:tts status` — Show full config
- `/opencode-speak:tts test` — Speak a test phrase

## Implementation

When the user runs this command, execute the `tts-config.sh` script. The script lives at the path where opencode-speak was cloned (typically `~/.local/share/opencode-speak/bin/tts-config.sh`).

```bash
CFGSH="~/.local/share/opencode-speak/bin/tts-config.sh"

# Show config panel (no args or "status")
bash "$CFGSH" status

# Enable/disable
bash "$CFGSH" set enabled true
bash "$CFGSH" set enabled false

# Switch engine
bash "$CFGSH" set engine kokoro
bash "$CFGSH" set engine speak

# Set roleplay voice
bash "$CFGSH" roleplay

# Change voice
bash "$CFGSH" set voice_kokoro af_bella
bash "$CFGSH" set voice_speak emma

# Test (speak a phrase)
echo "Hello, this is a test" | ~/.local/share/opencode-speak/bin/tts-speak.sh --text "Hello, this is a test"
```

## Roleplay Voices (warm, expressive, female)

### Kokoro (A-grade, best quality)
- **af_bella** — warm conversational, great for roleplay (recommended)
- **af_heart** — natural narration, flagship voice
- **af_sarah** — warm storytelling
- **af_kore** — calm, friendly
- **af_sky** — light, youthful

### Supertonic 3
- **emma** — soft, natural (recommended for roleplay)
- **lily** — gentle, expressive
- **sara** — clear, default

## All Voices

### Kokoro Female
af_heart, af_bella, af_nova, af_sky, af_jessica, af_nicole, af_aoede, af_kore, af_alloy, af_river, af_sarah

### Supertonic 3 Female
sara, emma, lily, maya, nora
