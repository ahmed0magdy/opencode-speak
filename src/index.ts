import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { spawn } from "bun"
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from "fs"
import { tmpdir, homedir } from "os"
import { join } from "path"

type Engine = "kokoro" | "speak"

interface TTSState {
  enabled: boolean
  engine: Engine
  voice: Record<Engine, string>
  speaking: boolean
  lastSpokenMessageID: string
  activeProc: ReturnType<typeof spawn> | null
  lastSynthesisEnd: number
}

interface SpeakOptions {
  defaultEngine?: Engine
  defaultVoice?: { kokoro?: string; speak?: string }
  maxChars?: number
  autoStart?: boolean
}

const KOKORO_FEMALE_VOICES = [
  "af_heart", "af_bella", "af_nova", "af_sky", "af_jessica",
  "af_nicole", "af_aoede", "af_kore", "af_alloy", "af_river", "af_sarah",
]

const KOKORO_ROLEPLAY_VOICES = ["af_bella", "af_heart", "af_sarah", "af_kore", "af_sky"]

const KOKORO_ALL_VOICES = [
  ...KOKORO_FEMALE_VOICES,
  "bf_emma", "bf_isabella", "bf_lily", "bf_alice",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
  "am_michael", "am_onyx", "am_puck", "am_santa",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa", "ff_siwis",
  "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
  "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo",
  "pf_dora", "pm_alex", "pm_santa",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi",
  "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
]

const SPEAK_FEMALE_VOICES = ["sara", "emma", "lily", "maya", "nora"]
const SPEAK_ROLEPLAY_VOICES = ["emma", "lily", "sara"]
const SPEAK_ALL_VOICES = [
  ...SPEAK_FEMALE_VOICES,
  "james", "daniel", "leo", "ryan", "noah",
]

const VOICES: Record<Engine, string[]> = {
  kokoro: KOKORO_ALL_VOICES,
  speak: SPEAK_ALL_VOICES,
}

const DEFAULT_MAX_CHARS = 1000
const CHUNK_MAX_CHARS = 300
const SYNTHESIS_COOLDOWN_MS = 500
const CHUNK_TIMEOUT_MS = 30_000
const CONFIG_DIR = join(homedir(), ".config", "opencode-speak")

function readConfig(key: string, fallback: string): string {
  const file = join(CONFIG_DIR, key)
  try {
    return readFileSync(file, "utf-8").trim() || fallback
  } catch {
    return fallback
  }
}

function writeConfig(key: string, value: string): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(join(CONFIG_DIR, key), value, "utf-8")
  } catch {}
}

function syncStateFromConfig(state: TTSState): void {
  state.enabled = readConfig("enabled", "false") === "true"
  const engine = readConfig("engine", state.engine)
  if (engine === "kokoro" || engine === "speak") state.engine = engine
  state.voice.kokoro = readConfig("voice_kokoro", state.voice.kokoro)
  state.voice.speak = readConfig("voice_speak", state.voice.speak)
}

function syncStateToConfig(state: TTSState): void {
  writeConfig("enabled", state.enabled ? "true" : "false")
  writeConfig("engine", state.engine)
  writeConfig("voice_kokoro", state.voice.kokoro)
  writeConfig("voice_speak", state.voice.speak)
}

function resolveExecutable(name: string): string | null {
  const localBin = join(process.env.HOME ?? "/root", ".local", "bin", name)
  if (existsSync(localBin)) return localBin

  const paths = (process.env.PATH ?? "").split(":")
  for (const dir of paths) {
    const full = join(dir, name)
    if (existsSync(full)) return full
  }
  return null
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

async function checkAudioAvailable(): Promise<boolean> {
  try {
    const proc = spawn({
      cmd: ["pactl", "info"],
      stdout: "ignore",
      stderr: "ignore",
    })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

function chunkText(text: string, maxPerChunk: number): string[] {
  if (text.length <= maxPerChunk) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxPerChunk) {
      chunks.push(remaining)
      break
    }

    let splitAt = -1
    const searchWindow = remaining.slice(0, maxPerChunk)

    // Split at sentence boundaries
    const sentenceEnd = Math.max(
      searchWindow.lastIndexOf(". "),
      searchWindow.lastIndexOf("! "),
      searchWindow.lastIndexOf("? "),
      searchWindow.lastIndexOf(".\n"),
      searchWindow.lastIndexOf("!\n"),
      searchWindow.lastIndexOf("?\n"),
    )

    if (sentenceEnd > maxPerChunk * 0.3) {
      splitAt = sentenceEnd + 1
    } else {
      // Fall back to comma or space
      const commaAt = searchWindow.lastIndexOf(", ")
      if (commaAt > maxPerChunk * 0.3) {
        splitAt = commaAt + 1
      } else {
        const spaceAt = searchWindow.lastIndexOf(" ")
        splitAt = spaceAt > 0 ? spaceAt : maxPerChunk
      }
    }

    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  return chunks.filter(c => c.length > 0)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function synthesize(
  text: string,
  engine: Engine,
  voice: string,
  binaries: Record<Engine, string>,
  state: TTSState,
): Promise<void> {
  const bin = binaries[engine]
  const chunks = chunkText(text, CHUNK_MAX_CHARS)

  for (const chunk of chunks) {
    if (!state.enabled || !state.speaking) break

    // Enforce cooldown between chunks
    const elapsed = Date.now() - state.lastSynthesisEnd
    if (elapsed < SYNTHESIS_COOLDOWN_MS) {
      await sleep(SYNTHESIS_COOLDOWN_MS - elapsed)
    }

    const tmp = join(tmpdir(), `opencode-speak-${Date.now()}.txt`)
    try {
      writeFileSync(tmp, chunk, "utf-8")

      const cmd =
        engine === "kokoro"
          ? `cat "${tmp}" | "${bin}" speak --voice ${voice} --play --service off`
          : `cat "${tmp}" | "${bin}" -v ${voice} --no-daemon`

      const proc = spawn({
        cmd: ["bash", "-c", cmd],
        stdout: "ignore",
        stderr: "pipe",
      })

      state.activeProc = proc

      // Race between process exit and timeout
      const timeout = setTimeout(() => {
        try { process.kill(-proc.pid, "SIGTERM"); } catch {
          try { proc.kill(); } catch {}
        }
      }, CHUNK_TIMEOUT_MS)

      const exitCode = await proc.exited
      clearTimeout(timeout)
      state.activeProc = null
      state.lastSynthesisEnd = Date.now()

      if (exitCode !== 0 && state.enabled) {
        const stderr = await new Response(proc.stderr).text()
        throw new Error(`${engine} exited with code ${exitCode}: ${stderr.slice(0, 200)}`)
      }
    } finally {
      state.activeProc = null
      try { unlinkSync(tmp) } catch {}
    }
  }
}

function formatStatus(state: TTSState): string {
  if (!state.enabled) return "TTS: OFF"
  return `TTS: ON | engine: ${state.engine} | voice: ${state.voice[state.engine]}`
}

function formatConfig(state: TTSState, availableEngines: Engine[]): string {
  const lines = [
    "═══ opencode-speak config ═══",
    "",
    `  Status:       ${state.enabled ? "ON" : "OFF"}`,
    `  Engine:       ${state.engine}${availableEngines.length > 1 ? ` (available: ${availableEngines.join(", ")})` : ""}`,
    `  Voice:        ${state.voice[state.engine]}`,
    `  Kokoro voice: ${state.voice.kokoro}`,
    `  Speak voice:  ${state.voice.speak}`,
    "",
    "── Roleplay Voices (warm/expressive) ──",
    `  Kokoro: ${KOKORO_ROLEPLAY_VOICES.join(", ")}`,
    `  Speak:  ${SPEAK_ROLEPLAY_VOICES.join(", ")}`,
    "",
    "── Commands ──",
    "  /tts on         enable",
    "  /tts off        disable",
    "  /tts kokoro     switch engine",
    "  /tts speak      switch engine",
    "  /tts voice X    change voice",
    "  /tts voices     list all voices",
    "  /tts roleplay   set best roleplay voice",
    "  /tts test       test current voice",
    "═════════════════════════════════",
  ]
  return lines.join("\n")
}

export const OpenCodeSpeak: Plugin = async ({ client }, options?: PluginOptions) => {
  const opts = (options ?? {}) as SpeakOptions

  const log = (level: "info" | "warn" | "error", message: string) =>
    client.app.log({ body: { service: "opencode-speak", level, message } })

  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
    client.tui.showToast({ body: { message, variant, duration: 4000 } })

  const kokoroBin = resolveExecutable("kokoro")
  const speakBin = resolveExecutable("speak")

  if (!kokoroBin && !speakBin) {
    await log("error", "No TTS engine found. Install kokoro-cli or speak-cli.")
    return {}
  }

  const binaries: Record<Engine, string> = {
    kokoro: kokoroBin ?? "",
    speak: speakBin ?? "",
  }

  const defaultEngine: Engine =
    opts.defaultEngine ??
    (kokoroBin ? "kokoro" : "speak")

  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS

  const state: TTSState = {
    enabled: opts.autoStart ?? false,
    engine: defaultEngine,
    voice: {
      kokoro: opts.defaultVoice?.kokoro ?? "af_heart",
      speak: opts.defaultVoice?.speak ?? "sara",
    },
    speaking: false,
    lastSpokenMessageID: "",
    activeProc: null,
    lastSynthesisEnd: 0,
  }

  syncStateFromConfig(state)

  const availableEngines: Engine[] = []
  if (kokoroBin) availableEngines.push("kokoro")
  if (speakBin) availableEngines.push("speak")

  await log("info",
    `Plugin loaded | engines: ${availableEngines.join(", ")} | default: ${defaultEngine} | auto-start: ${state.enabled}`,
  )

  const handleTTSCommand = async (args: string): Promise<void> => {
    if (!args || args === "status" || args === "config") {
      await toast(formatConfig(state, availableEngines), "info")
      return
    }

    if (args === "on") {
      if (!binaries[state.engine]) {
        await toast(`Engine "${state.engine}" not installed`, "error")
        return
      }
      state.enabled = true
      syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      await log("info", "TTS enabled")
      return
    }

    if (args === "off") {
      state.enabled = false
      syncStateToConfig(state)
      if (state.activeProc) {
        try { process.kill(-state.activeProc.pid, "SIGTERM"); } catch {
          try { state.activeProc.kill(); } catch {}
        }
        state.activeProc = null
      }
      await toast("TTS: OFF", "info")
      await log("info", "TTS disabled")
      return
    }

    if (args === "kokoro" || args === "speak") {
      const engine = args as Engine
      if (!binaries[engine]) {
        await toast(`Engine "${engine}" not installed. Install: uv tool install ${engine === "kokoro" ? "kokoro-cli" : "speak-cli"}`, "error")
        return
      }
      state.engine = engine
      syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      await log("info", `Switched to engine: ${engine}`)
      return
    }

    if (args === "roleplay") {
      const voice = state.engine === "kokoro" ? "af_bella" : "emma"
      state.voice[state.engine] = voice
      syncStateToConfig(state)
      await toast(`Roleplay voice set: ${voice} (${state.engine})`, "success")
      await log("info", `Roleplay voice: ${voice}`)
      return
    }

    if (args === "voices") {
      const voices = VOICES[state.engine]
      const femaleLabel = state.engine === "kokoro" ? "Female (roleplay)" : "Female (roleplay)"
      const roleplay = state.engine === "kokoro" ? KOKORO_ROLEPLAY_VOICES : SPEAK_ROLEPLAY_VOICES
      const all = voices
      await toast(
        `[${state.engine}] ★ ${femaleLabel}: ${roleplay.join(", ")}\n\nAll: ${all.join(", ")}`,
        "info",
      )
      return
    }

    if (args.startsWith("voice ")) {
      const v = args.slice(6).trim()
      if (!v) {
        await toast(`Current voice: ${state.voice[state.engine]}`, "info")
        return
      }
      if (!VOICES[state.engine].includes(v)) {
        await toast(`Unknown voice "${v}" for ${state.engine}. Try /tts voices`, "warning")
        return
      }
      state.voice[state.engine] = v
      syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      await log("info", `Voice changed to: ${v}`)
      return
    }

    if (args === "test") {
      if (!binaries[state.engine]) {
        await toast(`Engine "${state.engine}" not installed`, "error")
        return
      }
      if (!await checkAudioAvailable()) {
        await toast("Audio unavailable — PulseAudio not responding. Try: wsl --shutdown", "error")
        return
      }
      state.speaking = true
      await toast(`Testing ${state.engine}/${state.voice[state.engine]}...`, "info")
      try {
        await synthesize(
          "Hello! This is your text-to-speech voice. How do I sound?",
          state.engine,
          state.voice[state.engine],
          binaries,
          state,
        )
        await toast("Test complete", "success")
      } catch (err: any) {
        await toast(`Test failed: ${err.message}`, "error")
        await log("error", `Test failed: ${err.message}`)
      } finally {
        state.speaking = false
      }
      return
    }

    if (args === "help") {
      await toast(
        [
          "/tts             — show config panel",
          "/tts on          — start speaking responses",
          "/tts off         — stop (kills active speech)",
          "/tts kokoro      — use Kokoro engine",
          "/tts speak       — use Supertonic 3 engine",
          "/tts roleplay    — set best warm female voice",
          "/tts voice X     — change voice",
          "/tts voices      — list voices (★ = roleplay)",
          "/tts test        — speak a test phrase",
          "/tts status      — show config panel",
        ].join("\n"),
        "info",
      )
      return
    }

    await toast(`Unknown: "${args}". Try /tts help`, "warning")
  }

  return {
    "command.execute.before": async (input, _output) => {
      if (input.command !== "tts") return
      await handleTTSCommand(input.arguments?.trim() ?? "")
      throw new Error("__tts_handled__")
    },

    event: async ({ event }) => {
      syncStateFromConfig(state)
      if (!state.enabled) return
      if (event.type !== "session.idle") return
      if (state.speaking) return

      const sessionID = (event as any).properties?.sessionID
      if (!sessionID) return

      state.speaking = true
      try {
        const resp = await client.session.messages({ path: { id: sessionID } })
        const messages = (resp as any)?.data ?? resp
        if (!Array.isArray(messages) || messages.length === 0) return

        const last = messages[messages.length - 1]
        if (!last.info || last.info.role !== "assistant") return
        if (last.info.id === state.lastSpokenMessageID) return

        state.lastSpokenMessageID = last.info.id

        const textParts = (last.parts ?? [])
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text ?? "")

        let text = stripMarkdown(textParts.join("\n"))
        if (!text || text.length < 5) return
        if (text.length > maxChars) text = text.slice(0, maxChars)

        await log("info", `Speaking ${text.length} chars [${state.engine}/${state.voice[state.engine]}]`)

        if (!await checkAudioAvailable()) {
          await log("warn", "PulseAudio unavailable — skipping TTS")
          return
        }

        await synthesize(text, state.engine, state.voice[state.engine], binaries, state)
      } catch (err: any) {
        await log("error", `TTS error: ${err?.message || String(err)}`)
      } finally {
        state.speaking = false
      }
    },

    dispose: async () => {
      state.enabled = false
      state.speaking = false
      if (state.activeProc) {
        try {
          process.kill(-state.activeProc.pid, "SIGTERM")
        } catch {
          try { state.activeProc.kill(); } catch {}
        }
        state.activeProc = null
      }
    },
  }
}
