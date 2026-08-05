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
  speed: Record<Engine, string>
  lang: Record<Engine, string>
  kokoroModel: string
  speakSteps: string
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

const KOKORO_ALL_VOICES = [
  "af_heart", "af_bella", "af_nova", "af_sky", "af_jessica",
  "af_nicole", "af_aoede", "af_kore", "af_alloy", "af_river", "af_sarah",
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

const SPEAK_ALL_VOICES = ["sara", "emma", "lily", "maya", "nora", "james", "daniel", "leo", "ryan", "noah"]

const VOICES: Record<Engine, string[]> = {
  kokoro: KOKORO_ALL_VOICES,
  speak: SPEAK_ALL_VOICES,
}

const DEFAULT_MAX_CHARS = 1000
const CHUNK_MAX_CHARS = 300
const SYNTHESIS_COOLDOWN_MS = 500
const CHUNK_TIMEOUT_MS = 30_000
const CONFIG_DIR = join(homedir(), ".config", "opencode-speak")
const CONFIG_CACHE_MS = 5000
let lastConfigRead = 0

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
  state.speed.kokoro = readConfig("speed_kokoro", state.speed.kokoro)
  state.speed.speak = readConfig("speed_speak", state.speed.speak)
  state.lang.kokoro = readConfig("lang_kokoro", state.lang.kokoro)
  state.lang.speak = readConfig("lang_speak", state.lang.speak)
  state.kokoroModel = readConfig("kokoro_model", state.kokoroModel)
  state.speakSteps = readConfig("speak_steps", state.speakSteps)
}

function syncStateToConfig(state: TTSState): void {
  writeConfig("enabled", state.enabled ? "true" : "false")
  writeConfig("engine", state.engine)
  writeConfig("voice_kokoro", state.voice.kokoro)
  writeConfig("voice_speak", state.voice.speak)
  writeConfig("speed_kokoro", state.speed.kokoro)
  writeConfig("speed_speak", state.speed.speak)
  writeConfig("lang_kokoro", state.lang.kokoro)
  writeConfig("lang_speak", state.lang.speak)
  writeConfig("kokoro_model", state.kokoroModel)
  writeConfig("speak_steps", state.speakSteps)
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

    const searchWindow = remaining.slice(0, maxPerChunk)
    let splitAt: number

    const sentenceEnd = Math.max(
      searchWindow.lastIndexOf(". "),
      searchWindow.lastIndexOf("! "),
      searchWindow.lastIndexOf("? "),
      searchWindow.lastIndexOf(".\n"),
      searchWindow.lastIndexOf("!\n"),
      searchWindow.lastIndexOf("?\n"),
    )

    if (sentenceEnd > maxPerChunk * 0.3) {
      splitAt = sentenceEnd + 2
    } else {
      const commaAt = searchWindow.lastIndexOf(", ")
      if (commaAt > maxPerChunk * 0.3) {
        splitAt = commaAt + 2
      } else {
        const spaceAt = searchWindow.lastIndexOf(" ")
        splitAt = spaceAt > 0 ? spaceAt + 1 : maxPerChunk
      }
    }

    const piece = remaining.slice(0, splitAt).trim()
    if (piece.length > 0) chunks.push(piece)
    remaining = remaining.slice(splitAt).trim()
  }

  return chunks
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

    const elapsed = Date.now() - state.lastSynthesisEnd
    if (elapsed < SYNTHESIS_COOLDOWN_MS) {
      await sleep(SYNTHESIS_COOLDOWN_MS - elapsed)
      if (!state.enabled || !state.speaking) break
    }

    const tmp = join(tmpdir(), `opencode-speak-${Date.now()}.txt`)
    try {
      writeFileSync(tmp, chunk, "utf-8")

      const cmd =
        engine === "kokoro"
          ? `cat "${tmp}" | "${bin}" speak --voice ${voice} --speed ${state.speed.kokoro} --lang ${state.lang.kokoro} --model ${state.kokoroModel} --play --service off`
          : `cat "${tmp}" | "${bin}" -v ${voice} -s ${state.speed.speak} -l ${state.lang.speak} --steps ${state.speakSteps} --no-daemon`

      const proc = spawn({
        cmd: ["bash", "-c", cmd],
        stdout: "ignore",
        stderr: "pipe",
      })

      state.activeProc = proc

      const killTimer = setTimeout(() => {
        try { process.kill(-proc.pid, "SIGTERM"); } catch {
          try { proc.kill(); } catch {}
        }
      }, CHUNK_TIMEOUT_MS)

      const exitCode = await proc.exited
      clearTimeout(killTimer)
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
    `═ TTS: ${state.enabled ? "ON" : "OFF"} ═ Engine: ${state.engine} [${availableEngines.join(", ")}] ═`,
    "",
    "Kokoro:",
    `  Voice: ${state.voice.kokoro}  Speed: ${state.speed.kokoro}  Lang: ${state.lang.kokoro}  Model: ${state.kokoroModel}`,
    "Supertonic 3:",
    `  Voice: ${state.voice.speak}  Speed: ${state.speed.speak}  Lang: ${state.lang.speak}  Steps: ${state.speakSteps}`,
    "",
    "on|off kokoro|speak voice|speed|lang|model|steps X voices test help",
  ]
  return lines.join("\n")
}

export const OpenCodeSpeak: Plugin = async ({ client }, options?: PluginOptions) => {
  const opts = (options ?? {}) as SpeakOptions

  const log = (level: "info" | "warn" | "error", message: string) =>
    client.app.log({ body: { service: "opencode-speak", level, message } })

  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info", duration = 4000) =>
    client.tui.showToast({ body: { message, variant, duration } })

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
    speed: { kokoro: "1.0", speak: "1.0" },
    lang: { kokoro: "en-us", speak: "auto" },
    kokoroModel: "int8",
    speakSteps: "8",
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
      await toast(formatConfig(state, availableEngines), "info", 30000)
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

    if (args === "voices") {
      const voices = VOICES[state.engine]
      await toast(
        `[${state.engine}] All voices:\n${voices.join(", ")}`,
        "info",
        20000,
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

    if (args.startsWith("speed ")) {
      const val = parseFloat(args.slice(6).trim())
      const min = state.engine === "kokoro" ? 0.5 : 0.7
      const max = state.engine === "kokoro" ? 4.0 : 2.0
      if (isNaN(val) || val < min || val > max) {
        await toast(`Speed must be ${min}-${max} for ${state.engine}`, "warning")
        return
      }
      state.speed[state.engine] = val.toString()
      syncStateToConfig(state)
      await toast(`Speed set: ${val} (${state.engine})`, "success")
      return
    }

    if (args.startsWith("lang ")) {
      const val = args.slice(5).trim()
      const validKokoro = ["en-us", "en-gb", "ja", "zh", "hi", "fr", "it", "pt", "es", "ko"]
      const validSpeak = ["auto", "na", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "zh"]
      const valid = state.engine === "kokoro" ? validKokoro : validSpeak
      if (!valid.includes(val)) {
        await toast(`Invalid lang "${val}". Options: ${valid.join(", ")}`, "warning")
        return
      }
      state.lang[state.engine] = val
      syncStateToConfig(state)
      await toast(`Language set: ${val} (${state.engine})`, "success")
      return
    }

    if (args.startsWith("model ")) {
      const val = args.slice(6).trim()
      const valid = ["int8", "fp16", "full"]
      if (!valid.includes(val)) {
        await toast(`Invalid model. Options: ${valid.join(", ")}`, "warning")
        return
      }
      state.kokoroModel = val
      syncStateToConfig(state)
      await toast(`Kokoro model set: ${val}`, "success")
      return
    }

    if (args.startsWith("steps ")) {
      const val = parseInt(args.slice(6).trim(), 10)
      if (isNaN(val) || val < 5 || val > 12) {
        await toast("Steps must be 5-12 (higher=better quality, slower)", "warning")
        return
      }
      state.speakSteps = val.toString()
      syncStateToConfig(state)
      await toast(`Speak steps set: ${val}`, "success")
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
          "/tts voice X     — change voice",
          "/tts speed X     — set speed (kokoro: 0.5-4, speak: 0.7-2)",
          "/tts lang X      — set language",
          "/tts model X     — kokoro model (int8/fp16/full)",
          "/tts steps X     — speak quality (5-12)",
          "/tts voices      — list all voices",
          "/tts test        — test current config",
        ].join("\n"),
        "info",
        20000,
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
      const now = Date.now()
      if (now - lastConfigRead > CONFIG_CACHE_MS) {
        syncStateFromConfig(state)
        lastConfigRead = now
      }
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
