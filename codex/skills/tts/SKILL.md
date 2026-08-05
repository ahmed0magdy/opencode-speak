# TTS Voice Output Skill

This skill enables text-to-speech for Codex CLI responses.

## What it does

After each assistant response, the text is spoken aloud using either Kokoro (82M) or Supertonic 3 TTS engines. Both run fully offline on CPU.

## Control TTS

Run `tts-config.sh` (located at `~/.local/share/opencode-speak/bin/tts-config.sh`):

```bash
CFGSH=~/.local/share/opencode-speak/bin/tts-config.sh

# Show full config panel
bash "$CFGSH" status

# Enable/disable
bash "$CFGSH" set enabled true
bash "$CFGSH" set enabled false

# Switch engine
bash "$CFGSH" set engine kokoro
bash "$CFGSH" set engine speak

# Set roleplay voice (best warm female)
bash "$CFGSH" roleplay

# Change voice manually
bash "$CFGSH" set voice_kokoro af_bella
bash "$CFGSH" set voice_speak emma
```

## Roleplay Voices (warm, expressive, female)

### Kokoro (A-grade, best quality)
| Voice | Style | Rating |
|-------|-------|--------|
| af_bella | Warm conversational, expressive | A (recommended) |
| af_heart | Natural narration, flagship | A |
| af_sarah | Warm storytelling | A |
| af_kore | Calm, friendly | B |
| af_sky | Light, youthful | B |

### Supertonic 3
| Voice | Style |
|-------|-------|
| emma | Soft, natural (recommended) |
| lily | Gentle, expressive |
| sara | Clear, default |

## All Available Voices

### Kokoro (54 voices)
- **Female (American)**: af_heart, af_bella, af_nova, af_sky, af_jessica, af_nicole, af_aoede, af_kore, af_alloy, af_river, af_sarah
- **Male (American)**: am_adam, am_echo, am_eric, am_fenrir, am_liam, am_michael, am_onyx, am_puck, am_santa
- **British**: bf_emma, bf_isabella, bf_lily, bf_alice, bm_daniel, bm_fable, bm_george, bm_lewis
- **Other languages**: ef_dora, ff_siwis, hf_alpha, hf_beta, if_sara, jf_alpha, pf_dora, zf_xiaobei, +more

### Supertonic 3 (10 voices)
- **Female**: sara, emma, lily, maya, nora
- **Male**: james, daniel, leo, ryan, noah

## Requirements

- `kokoro-cli`: `uv tool install kokoro-cli`
- `speak-cli`: `uv tool install speak-cli`
- `espeak-ng`: `sudo apt install espeak-ng` (Linux, required for Kokoro)
- `jq`: `sudo apt install jq`
