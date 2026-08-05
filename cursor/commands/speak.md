# /speak - TTS Voice Control

Control text-to-speech voice output in Cursor.

## Commands

| Command | Description |
|---------|-------------|
| `/speak on` | Enable TTS |
| `/speak off` | Disable TTS |
| `/speak kokoro` | Switch to Kokoro engine |
| `/speak supertonic` | Switch to Supertonic 3 engine |
| `/speak voice NAME` | Change voice |
| `/speak status` | Show current settings |
| `/speak test` | Speak a test phrase |

## How to Use

After running `cursor/install.sh`, assistant responses are automatically spoken when TTS is enabled. Use the commands above (in your terminal, not in Cursor chat) to control behavior:

```bash
# Quick path to config
CFG=~/.config/opencode-speak

# Enable
echo -n "true" > $CFG/enabled

# Disable
echo -n "false" > $CFG/enabled

# Switch to kokoro
echo -n "kokoro" > $CFG/engine

# Switch to supertonic
echo -n "speak" > $CFG/engine

# Change kokoro voice
echo -n "af_sky" > $CFG/voice_kokoro
```

## Available Voices

### Kokoro
af_heart, af_sky, af_bella, af_sarah, af_nicole, af_nova, af_river

### Supertonic 3
sara, zara, aria, luna, elena
