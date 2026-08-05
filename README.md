# opencode-speak

[![npm version](https://img.shields.io/npm/v/opencode-speak)](https://www.npmjs.com/package/opencode-speak)
[![license](https://img.shields.io/npm/l/opencode-speak)](LICENSE)

Text-to-speech plugin for [OpenCode](https://opencode.ai) — hear AI responses spoken aloud using local TTS engines. No cloud, no API keys, no subscriptions, everything runs on your machine.

## Features

- **Two local TTS engines** — [Kokoro](https://github.com/yoav0gal/kokoro-cli) (82M params, 54 voices) and [Supertonic 3](https://github.com/supertone-inc/supertonic) (99M params, 10 voices)
- **100% offline** — no cloud APIs, no tokens, fully private
- **On-demand** — TTS is off by default, toggle with `/tts on` and `/tts off`
- **No background processes** — models load per-request, zero idle RAM
- **Switch engines live** — swap between Kokoro and Supertonic without restarting
- **54+ voices** — multilingual support across English, Japanese, Chinese, Hindi, French, Italian, Portuguese, and more

---

## Install

### 1. Install the plugin

```bash
opencode plugin opencode-speak --global
```

Or with npm:

```bash
npm install opencode-speak
```

Then add to your OpenCode config (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-speak"],
  "command": {
    "tts": {
      "template": "$ARGUMENTS",
      "description": "TTS: on | off | kokoro | speak | voice NAME | voices | test | help"
    }
  }
}
```

> The `opencode plugin` command adds the plugin entry automatically. You only need to add the `command` block manually for the `/tts` slash command.

### 2. Install a TTS engine

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

### 3. Start

Restart OpenCode, type `/tts on`, and start chatting.

<details>
<summary>Alternative: install from source</summary>

```bash
git clone https://github.com/ahmed0magdy/opencode-speak.git
cp opencode-speak/src/index.ts ~/.config/opencode/plugins/opencode-speak.ts
```

Then add the `command` block to your `opencode.jsonc` (same as above).

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

---

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

## Voices

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

## Comparison

| | opencode-speak | [narrate](https://github.com/felores/narrate) | [vox](https://github.com/punt-labs/vox) | [voice-bridge](https://github.com/Tomorrow-You/voice-bridge) | [aftertone](https://github.com/omarelkhal/aftertone) |
|---|---|---|---|---|---|
| **Cloud-free** | Yes | Optional | Optional | Optional | Yes |
| **API keys needed** | No | Depends on provider | Depends on provider | Optional (edge-tts free) | No |
| **OpenCode** | Yes | Yes | No | No | Soon |
| **Claude Code** | Planned | Yes | Yes | Yes | Yes |
| **Cursor** | No | Yes | No | Yes (MCP) | Yes |
| **Codex** | No | Yes | No | No | Yes |
| **Local engines** | Kokoro, Supertonic 3 | Voicebox, Kokoro | System TTS | Kokoro, espeak-ng | Supertonic ONNX |
| **Cloud engines** | None | ElevenLabs, OpenAI, Gemini | ElevenLabs, Polly, OpenAI | ElevenLabs, edge-tts | None |
| **Background daemon** | No | Yes | Yes | No | Yes |
| **Install** | One command | Script | Script | Plugin marketplace | Script |

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
# Remove plugin from opencode config:
# Delete "opencode-speak" from the "plugin" array in opencode.jsonc
# Delete the "tts" command entry from opencode.jsonc

# Or remove local file:
rm ~/.config/opencode/plugins/opencode-speak.ts

# Remove TTS engines (optional):
uv tool uninstall kokoro-cli
uv tool uninstall speak-cli
rm -rf ~/.local/share/kokoro        # Kokoro models
rm -rf ~/.cache/supertonic3         # Supertonic 3 models
```

---

## Contributing

Issues and pull requests welcome at [github.com/ahmed0magdy/opencode-speak](https://github.com/ahmed0magdy/opencode-speak).

## License

[MIT](LICENSE)
