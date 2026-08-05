# opencode-speak

[![npm version](https://img.shields.io/npm/v/opencode-speak)](https://www.npmjs.com/package/opencode-speak)
[![license](https://img.shields.io/npm/l/opencode-speak)](LICENSE)

Text-to-speech plugin for [OpenCode](https://opencode.ai) — hear AI responses spoken aloud using local TTS engines. No cloud, no API keys, everything runs on your machine.

## Features

- **Two TTS engines** — [Kokoro](https://github.com/yoav0gal/kokoro-cli) (82M params, 54 voices) and [Supertonic 3](https://github.com/supertone-inc/supertonic) (99M params, 10 voices)
- **On-demand** — TTS is off by default, toggle on/off with a single command
- **No background processes** — models load per-request, zero idle RAM usage
- **Switch engines live** — swap between Kokoro and Supertonic without restarting
- **54+ voices** — multilingual support across English, Japanese, Chinese, Hindi, French, Italian, and more

---

## Install

### Step 1: Install the plugin

```bash
opencode plugin opencode-speak --global
```

This installs the npm package and adds it to your global OpenCode config automatically.

Then add the `/tts` command to your config (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "command": {
    "tts": {
      "template": "$ARGUMENTS",
      "description": "TTS: on | off | kokoro | speak | voice NAME | voices | test | help"
    }
  }
}
```

### Step 2: Install a TTS engine

You need at least one. Both are optional — the plugin auto-detects what's available.

```bash
# Kokoro (recommended) — 86MB model, 54 voices, CPU-optimized
uv tool install kokoro-cli
sudo apt install espeak-ng          # required dependency on Linux
kokoro speak "hello" --play         # downloads model on first run
```

```bash
# Supertonic 3 — 400MB model, 10 voices, 31 languages
uv tool install speak-cli
speak "hello"                       # downloads model on first run
speak --stop                        # stop background daemon after first run
```

### Step 3: Start

Restart OpenCode, then type `/tts on` and start chatting — you'll hear the AI speak.

<details>
<summary>Alternative install methods</summary>

**Manual npm config** — add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-speak"]
}
```

**From source** — copy the plugin file directly:

```bash
git clone https://github.com/ahmed0magdy/opencode-speak.git
cp opencode-speak/src/index.ts ~/.config/opencode/plugins/opencode-speak.ts
```

</details>

---

## Commands

| Command | Description |
|---------|-------------|
| `/tts on` | Start speaking LLM responses |
| `/tts off` | Stop speaking |
| `/tts kokoro` | Switch to Kokoro engine |
| `/tts speak` | Switch to Supertonic 3 engine |
| `/tts voice af_bella` | Change voice |
| `/tts voices` | List available voices for current engine |
| `/tts test` | Speak a test phrase |
| `/tts status` | Show current settings |
| `/tts help` | Show all commands |

## Configuration (optional)

Pass options when using as an npm plugin:

```jsonc
{
  "plugin": [
    ["opencode-speak", {
      "defaultEngine": "kokoro",
      "defaultVoice": { "kokoro": "af_bella", "speak": "emma" },
      "maxChars": 3000,
      "autoStart": false
    }]
  ]
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultEngine` | `"kokoro"` \| `"speak"` | First available | TTS engine on startup |
| `defaultVoice.kokoro` | `string` | `"af_heart"` | Default Kokoro voice |
| `defaultVoice.speak` | `string` | `"sara"` | Default Supertonic voice |
| `maxChars` | `number` | `2000` | Max characters to speak per response |
| `autoStart` | `boolean` | `false` | Enable TTS automatically on startup |

---

## Available Voices

### Kokoro — Female

`af_heart` `af_bella` `af_nova` `af_sky` `af_jessica` `af_nicole` `af_aoede` `af_kore` `af_alloy` `af_river` `af_sarah`

### Kokoro — All 54 voices

English (American): `af_*`, `am_*` | English (British): `bf_*`, `bm_*` | Spanish: `ef_*`, `em_*` | French: `ff_*` | Hindi: `hf_*`, `hm_*` | Italian: `if_*`, `im_*` | Japanese: `jf_*`, `jm_*` | Portuguese: `pf_*`, `pm_*` | Chinese: `zf_*`, `zm_*`

### Supertonic 3 — Female

`sara` `emma` `lily` `maya` `nora`

### Supertonic 3 — Male

`james` `daniel` `leo` `ryan` `noah`

---

## How It Works

1. You type `/tts on` to enable
2. You chat with the LLM as normal
3. When the LLM finishes responding (`session.idle` event), the plugin:
   - Fetches the latest assistant message via the OpenCode SDK
   - Strips markdown formatting to clean, speakable text
   - Pipes the text to the selected TTS engine CLI
   - Audio plays through your system speakers
4. Type `/tts off` to disable

No background processes run while TTS is off. Models load on-demand and release memory after each synthesis. Text is piped via temporary files to avoid shell escaping issues. Both engines run with flags that prevent background daemons (`--service off` for Kokoro, `--no-daemon` for speak-cli).

---

## WSL2 Audio Setup

If you're on WSL2, make sure WSLg is enabled:

1. Edit `C:\Users\<you>\.wslconfig`:
   ```ini
   [wsl2]
   guiApplications=true
   ```
2. Restart WSL: `wsl --shutdown` from PowerShell
3. Verify: `pactl info | grep "Server Name"` should show `PulseAudio (on PipeWire)`

---

## Uninstall

```bash
# npm plugin: remove "opencode-speak" from plugin array in opencode.jsonc
# Local file:
rm ~/.config/opencode/plugins/opencode-speak.ts

# Remove /tts command from opencode.jsonc

# Remove TTS engines (optional):
uv tool uninstall kokoro-cli
uv tool uninstall speak-cli
rm -rf ~/.local/share/kokoro        # Kokoro models
rm -rf ~/.cache/supertonic3         # Supertonic 3 models
```

## Contributing

Issues and pull requests welcome at [github.com/ahmed0magdy/opencode-speak](https://github.com/ahmed0magdy/opencode-speak).

## License

[MIT](LICENSE)
