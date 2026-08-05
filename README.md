# opencode-speak

Text-to-speech plugin for [OpenCode](https://opencode.ai) — hear LLM responses spoken aloud using local TTS engines. No cloud, no API keys, runs entirely on your machine.

## Features

- **Two TTS engines** — [Kokoro](https://github.com/yoav0gal/kokoro-cli) (82M params, 54 voices) and [Supertonic 3](https://github.com/supertone-inc/supertonic) (99M params, 10 voices)
- **On-demand** — TTS is off by default, toggle with `/tts on` and `/tts off`
- **No background processes** — models load per-request, zero idle RAM
- **Switch engines live** — `/tts kokoro` or `/tts speak`, no restart needed
- **54+ voices** — multilingual support across English, Japanese, Chinese, Hindi, French, Italian, and more

## Requirements

- [OpenCode](https://opencode.ai) v1.18+
- Linux (tested on WSL2 Ubuntu 24.04) or macOS
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Audio output (PulseAudio, PipeWire, or macOS CoreAudio)
- At least one TTS engine installed (see below)

### Install TTS engines

You need at least one. Both are optional — the plugin auto-detects what's available.

**Kokoro** (recommended — 86MB model, 54 voices, CPU-optimized):

```bash
uv tool install kokoro-cli
sudo apt install espeak-ng    # required dependency on Linux
kokoro setup                  # downloads model on first run
```

**Supertonic 3** (99M params, 10 voices, 31 languages):

```bash
uv tool install speak-cli
speak "hello"                 # downloads model (~400MB) on first run
speak --stop                  # stop the background daemon after first run
```

### WSL2 audio setup

If you're on WSL2, make sure WSLg is enabled for audio output:

1. Edit `C:\Users\<you>\.wslconfig` on the Windows side:
   ```ini
   [wsl2]
   guiApplications=true
   ```
2. Restart WSL: `wsl --shutdown` from PowerShell, then reopen your terminal.
3. Verify: `pactl info | grep "Server Name"` should show `PulseAudio (on PipeWire)`.

## Installation

### Option A: Local file (recommended)

Copy the plugin file directly:

```bash
cp src/index.ts ~/.config/opencode/plugins/opencode-speak.ts
```

Add the `/tts` command to your OpenCode config (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "command": {
    "tts": {
      "template": "$ARGUMENTS",
      "description": "TTS control: on | off | kokoro | speak | voice NAME | voices | test | help"
    }
  }
}
```

Restart OpenCode.

### Option B: From npm (once published)

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-speak"],
  "command": {
    "tts": {
      "template": "$ARGUMENTS",
      "description": "TTS control: on | off | kokoro | speak | voice NAME | voices | test | help"
    }
  }
}
```

### Configuration (optional)

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
| `defaultEngine` | `"kokoro"` \| `"speak"` | First available | TTS engine to use on startup |
| `defaultVoice.kokoro` | `string` | `"af_heart"` | Default Kokoro voice |
| `defaultVoice.speak` | `string` | `"sara"` | Default Supertonic voice |
| `maxChars` | `number` | `2000` | Max characters to speak per response |
| `autoStart` | `boolean` | `false` | Enable TTS automatically on startup |

## Usage

All commands use the `/tts` slash command inside OpenCode:

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

### Kokoro voices (female)

`af_heart` `af_bella` `af_nova` `af_sky` `af_jessica` `af_nicole` `af_aoede` `af_kore` `af_alloy` `af_river` `af_sarah`

### Supertonic voices (female)

`sara` `emma` `lily` `maya` `nora`

### How it works

1. You type `/tts on` to enable
2. You chat with the LLM as normal
3. When the LLM finishes responding, the plugin:
   - Fetches the latest assistant message via the OpenCode SDK
   - Strips markdown formatting to clean text
   - Pipes the text to the selected TTS engine CLI
   - Audio plays through your system speakers
4. Type `/tts off` to disable

No background processes run while TTS is off. Models load on-demand and release memory after each synthesis.

## Uninstall

### Remove the plugin

**Local install:**

```bash
rm ~/.config/opencode/plugins/opencode-speak.ts
```

**npm install:** remove `"opencode-speak"` from the `plugin` array in your `opencode.jsonc`.

### Remove the `/tts` command

Delete the `"tts"` entry from the `"command"` block in `opencode.jsonc`.

### Remove TTS engines (optional)

```bash
uv tool uninstall kokoro-cli
uv tool uninstall speak-cli
speak --stop  # stop daemon if running
```

### Remove downloaded models (optional)

```bash
rm -rf ~/.local/share/kokoro          # Kokoro models + recordings
rm -rf ~/.cache/supertonic3           # Supertonic 3 models
```

## Architecture

```
opencode-speak.ts
├── command.execute.before   ← intercepts /tts commands
├── event (session.idle)     ← triggers speech after LLM responds
├── synthesize()             ← pipes text to CLI via temp file + stdin
├── stripMarkdown()          ← cleans LLM output for natural speech
└── dispose()                ← cleanup on plugin unload
```

The plugin uses `command.execute.before` to intercept `/tts` slash commands before they reach the LLM — turning them into pure control commands. The `event` hook listens for `session.idle` (LLM finished responding) and speaks the last assistant message.

Text is piped via temporary files to avoid shell escaping issues with special characters in LLM output. Both engines run with flags that prevent background daemons (`--service off` for Kokoro, `--no-daemon` for speak-cli).

## License

MIT
