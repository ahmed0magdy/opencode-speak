# /speak - TTS Voice Control

Control text-to-speech voice output in Cursor.

## Config Panel

Run with no arguments to see full configuration:

```bash
~/.local/share/opencode-speak/bin/tts-config.sh status
```

Output shows:
- Current status (on/off)
- Active engine (kokoro/speak)
- Current voices for both engines
- Roleplay voice recommendations
- Available commands

## Commands

| Command | Description |
|---------|-------------|
| `status` | Show full config panel |
| `set enabled true` | Enable TTS |
| `set enabled false` | Disable TTS |
| `set engine kokoro` | Switch to Kokoro |
| `set engine speak` | Switch to Supertonic 3 |
| `roleplay` | Set best warm female voice |
| `set voice_kokoro NAME` | Change Kokoro voice |
| `set voice_speak NAME` | Change Supertonic voice |

## Quick Setup for Roleplay

```bash
CFGSH=~/.local/share/opencode-speak/bin/tts-config.sh

# Enable + set roleplay voice in one go
bash "$CFGSH" set enabled true
bash "$CFGSH" roleplay
```

## Roleplay Voices (warm, expressive, female)

### Kokoro
- **af_bella** — warm, conversational (A-grade, recommended)
- **af_heart** — natural narration, flagship
- **af_sarah** — warm storytelling
- **af_kore** — calm, friendly
- **af_sky** — light, youthful

### Supertonic 3
- **emma** — soft, natural (recommended)
- **lily** — gentle, expressive
- **sara** — clear, default

## All Voices

### Kokoro Female
af_heart, af_bella, af_nova, af_sky, af_jessica, af_nicole, af_aoede, af_kore, af_alloy, af_river, af_sarah

### Supertonic 3 Female
sara, emma, lily, maya, nora
