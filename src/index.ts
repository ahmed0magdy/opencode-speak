import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { spawn } from "bun"
import { existsSync, readFileSync, mkdirSync, unlinkSync, writeFileSync } from "fs"
import { writeFile } from "fs/promises"
import { tmpdir, homedir } from "os"
import { join } from "path"
import { randomBytes } from "crypto"

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
  pendingText: string | null
  lastSpokenMessageID: string
  activeProc: ReturnType<typeof spawn> | null
  lastSynthesisEnd: number
  audioAvailable: boolean
  audioCheckedAt: number
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

const VALID_KOKORO_LANGS = ["en-us", "en-gb", "ja", "zh", "hi", "fr", "it", "pt", "es", "ko"]
const VALID_SPEAK_LANGS = ["auto", "na", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "zh"]
const VALID_MODELS = ["int8", "fp16", "full"]

const DEFAULT_MAX_CHARS = 2000
const CONFIG_DIR = join(homedir(), ".config", "opencode-speak")
const CONFIG_CACHE_MS = 5000
const AUDIO_CHECK_CACHE_MS = 30000
let lastConfigRead = 0

function readConfig(key: string, fallback: string): string {
  try {
    return readFileSync(join(CONFIG_DIR, key), "utf-8").trim() || fallback
  } catch {
    return fallback
  }
}

async function writeConfig(key: string, value: string): Promise<void> {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    await writeFile(join(CONFIG_DIR, key), value, "utf-8")
  } catch (err: any) {
    console.error(`[opencode-speak] config write ${key}: ${err?.message}`)
  }
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

async function syncStateToConfig(state: TTSState): Promise<void> {
  await Promise.all([
    writeConfig("enabled", state.enabled ? "true" : "false"),
    writeConfig("engine", state.engine),
    writeConfig("voice_kokoro", state.voice.kokoro),
    writeConfig("voice_speak", state.voice.speak),
    writeConfig("speed_kokoro", state.speed.kokoro),
    writeConfig("speed_speak", state.speed.speak),
    writeConfig("lang_kokoro", state.lang.kokoro),
    writeConfig("lang_speak", state.lang.speak),
    writeConfig("kokoro_model", state.kokoroModel),
    writeConfig("speak_steps", state.speakSteps),
  ])
}

function resolveExecutable(name: string): string | null {
  const localBin = join(homedir(), ".local", "bin", name)
  if (existsSync(localBin)) return localBin
  for (const dir of (process.env.PATH ?? "").split(":")) {
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

function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(" ", maxLen)
  return cut > maxLen * 0.5 ? text.slice(0, cut) : text.slice(0, maxLen)
}

async function checkAudioAvailable(state: TTSState): Promise<boolean> {
  const now = Date.now()
  if (now - state.audioCheckedAt < AUDIO_CHECK_CACHE_MS) return state.audioAvailable
  try {
    const proc = spawn({ cmd: ["pactl", "info"], stdout: "ignore", stderr: "ignore" })
    state.audioAvailable = (await proc.exited) === 0
  } catch {
    state.audioAvailable = false
  }
  state.audioCheckedAt = now
  return state.audioAvailable
}

function killTTS(state: TTSState): void {
  if (state.activeProc) {
    try { process.kill(-state.activeProc.pid, "SIGTERM") } catch {
      try { state.activeProc.kill() } catch {}
    }
    state.activeProc = null
  }
  const kokoroBin = resolveExecutable("kokoro")
  const speakBin = resolveExecutable("speak")
  if (kokoroBin) {
    try { spawn({ cmd: ["pkill", "-P", "1", "-x", "ffplay"], stdout: "ignore", stderr: "ignore" }) } catch {}
  }
}

async function synthesize(
  text: string,
  engine: Engine,
  voice: string,
  binaries: Record<Engine, string>,
  state: TTSState,
): Promise<void> {
  const bin = binaries[engine]
  const suffix = randomBytes(8).toString("hex")
  const tmp = join(tmpdir(), `opencode-speak-${suffix}.txt`)

  try {
    writeFileSync(tmp, text, "utf-8")

    const args: string[] =
      engine === "kokoro"
        ? [bin, "speak", "--voice", voice, "--speed", state.speed.kokoro, "--lang", state.lang.kokoro, "--model", state.kokoroModel, "--play", "--service", "off"]
        : [bin, "-v", voice, "-s", state.speed.speak, "-l", state.lang.speak, "--steps", state.speakSteps, "--no-daemon"]

    const proc = spawn({
      cmd: ["setsid", ...args],
      stdin: Bun.file(tmp),
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, ONNX_PROVIDER: process.env.ONNX_PROVIDER || "CUDAExecutionProvider" },
    })

    state.activeProc = proc
    const exitCode = await proc.exited
    state.activeProc = null
    state.lastSynthesisEnd = Date.now()

    if (exitCode !== 0 && state.enabled) {
      throw new Error(`${engine} exited ${exitCode}`)
    }
  } finally {
    state.activeProc = null
    try { unlinkSync(tmp) } catch {}
  }
}

function formatStatus(state: TTSState): string {
  if (!state.enabled) return "TTS: OFF"
  return `TTS: ON | engine: ${state.engine} | voice: ${state.voice[state.engine]}`
}

function formatConfig(state: TTSState, availableEngines: Engine[]): string {
  return [
    `═ TTS: ${state.enabled ? "ON" : "OFF"} ═ Engine: ${state.engine} [${availableEngines.join(", ")}] ═`,
    "",
    "Kokoro:",
    `  Voice: ${state.voice.kokoro}`,
    `  Speed: ${state.speed.kokoro}  [0.5 - 4.0]`,
    `  Lang:  ${state.lang.kokoro}  [${VALID_KOKORO_LANGS.join(", ")}]`,
    `  Model: ${state.kokoroModel}  [${VALID_MODELS.join(", ")}]`,
    "",
    "Supertonic 3:",
    `  Voice: ${state.voice.speak}`,
    `  Speed: ${state.speed.speak}  [0.7 - 2.0]`,
    `  Lang:  ${state.lang.speak}  [${VALID_SPEAK_LANGS.join(", ")}]`,
    `  Steps: ${state.speakSteps}  [5-12, higher=better]`,
    "",
    "/tts on|off|kokoro|speak|voice|speed|lang|model|steps|voices|test",
  ].join("\n")
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
    opts.defaultEngine ?? (kokoroBin ? "kokoro" : "speak")

  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS

  const state: TTSState = {
    enabled: opts.autoStart ?? false,
    engine: defaultEngine,
    voice: {
      kokoro: opts.defaultVoice?.kokoro ?? "af_heart",
      speak: opts.defaultVoice?.speak ?? "sara",
    },
    speed: { kokoro: "0.9", speak: "0.9" },
    lang: { kokoro: "en-us", speak: "auto" },
    kokoroModel: "full",
    speakSteps: "12",
    speaking: false,
    pendingText: null,
    lastSpokenMessageID: readConfig("last_message_id_opencode", ""),
    activeProc: null,
    lastSynthesisEnd: 0,
    audioAvailable: true,
    audioCheckedAt: 0,
  }

  syncStateFromConfig(state)

  const availableEngines: Engine[] = []
  if (kokoroBin) availableEngines.push("kokoro")
  if (speakBin) availableEngines.push("speak")

  await log("info",
    `Plugin loaded | engines: ${availableEngines.join(", ")} | default: ${defaultEngine} | auto-start: ${state.enabled}`,
  )

  async function speakText(text: string): Promise<void> {
    try {
      await synthesize(text, state.engine, state.voice[state.engine], binaries, state)
    } catch (err: any) {
      await log("error", `TTS error: ${err?.message || String(err)}`)
    }

    if (state.pendingText) {
      const next = state.pendingText
      state.pendingText = null
      await log("info", `Speaking queued text (${next.length} chars)`)
      try {
        await synthesize(next, state.engine, state.voice[state.engine], binaries, state)
      } catch (err: any) {
        await log("error", `TTS error: ${err?.message || String(err)}`)
      }
    }

    state.speaking = false
  }

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
      await syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      return
    }

    if (args === "off") {
      state.enabled = false
      state.speaking = false
      state.pendingText = null
      await syncStateToConfig(state)
      killTTS(state)
      await toast("TTS: OFF", "info")
      return
    }

    if (args === "kokoro" || args === "speak") {
      const engine = args as Engine
      if (!binaries[engine]) {
        await toast(`Engine "${engine}" not installed. Install: uv tool install ${engine === "kokoro" ? "kokoro-cli" : "speak-cli"}`, "error")
        return
      }
      state.engine = engine
      await syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      return
    }

    if (args === "voices") {
      await toast(`[${state.engine}] All voices:\n${VOICES[state.engine].join(", ")}`, "info", 20000)
      return
    }

    if (args.startsWith("voice ")) {
      const v = args.slice(6).trim()
      if (!v) { await toast(`Current voice: ${state.voice[state.engine]}`, "info"); return }
      if (!VOICES[state.engine].includes(v)) {
        await toast(`Unknown voice "${v}" for ${state.engine}. Try /tts voices`, "warning")
        return
      }
      state.voice[state.engine] = v
      await syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      return
    }

    if (args.startsWith("speed ")) {
      const raw = args.slice(6).trim()
      const val = Number(raw)
      const min = state.engine === "kokoro" ? 0.5 : 0.7
      const max = state.engine === "kokoro" ? 4.0 : 2.0
      if (!raw || isNaN(val) || val < min || val > max) {
        await toast(`Speed must be ${min}-${max} for ${state.engine}`, "warning")
        return
      }
      state.speed[state.engine] = val.toString()
      await syncStateToConfig(state)
      await toast(`Speed set: ${val} (${state.engine})`, "success")
      return
    }

    if (args.startsWith("lang ")) {
      const val = args.slice(5).trim()
      const valid = state.engine === "kokoro" ? VALID_KOKORO_LANGS : VALID_SPEAK_LANGS
      if (!valid.includes(val)) {
        await toast(`Invalid lang "${val}". Options: ${valid.join(", ")}`, "warning")
        return
      }
      state.lang[state.engine] = val
      await syncStateToConfig(state)
      await toast(`Language set: ${val} (${state.engine})`, "success")
      return
    }

    if (args.startsWith("model ")) {
      const val = args.slice(6).trim()
      if (!VALID_MODELS.includes(val)) {
        await toast(`Invalid model. Options: ${VALID_MODELS.join(", ")}`, "warning")
        return
      }
      state.kokoroModel = val
      await syncStateToConfig(state)
      await toast(`Kokoro model set: ${val}`, "success")
      return
    }

    if (args.startsWith("steps ")) {
      const raw = args.slice(6).trim()
      const val = Number(raw)
      if (!raw || !Number.isInteger(val) || val < 5 || val > 12) {
        await toast("Steps must be 5-12 (higher=better quality, slower)", "warning")
        return
      }
      state.speakSteps = val.toString()
      await syncStateToConfig(state)
      await toast(`Speak steps set: ${val}`, "success")
      return
    }

    if (args === "test") {
      if (!binaries[state.engine]) {
        await toast(`Engine "${state.engine}" not installed`, "error")
        return
      }
      if (!await checkAudioAvailable(state)) {
        await toast("Audio unavailable — PulseAudio not responding. Try: wsl --shutdown", "error")
        return
      }
      state.speaking = true
      await toast(`Testing ${state.engine}/${state.voice[state.engine]}...`, "info")
      try {
        await synthesize(
          "Hello! This is your text-to-speech voice. How do I sound?",
          state.engine, state.voice[state.engine], binaries, state,
        )
        await toast("Test complete", "success")
      } catch (err: any) {
        await toast(`Test failed: ${err.message}`, "error")
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
        "info", 20000,
      )
      return
    }

    await toast(`Unknown: "${args}". Try /tts help`, "warning")
  }

  return {
    "command.execute.before": async (input, output) => {
      if (input.command !== "tts") return
      await handleTTSCommand(input.arguments?.trim() ?? "")
      if (typeof (output as any).cancelled !== "undefined") {
        ;(output as any).cancelled = true
      } else {
        throw new Error("__tts_handled__")
      }
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      const now = Date.now()
      if (now - lastConfigRead > CONFIG_CACHE_MS) {
        syncStateFromConfig(state)
        lastConfigRead = now
      }
      if (!state.enabled) return

      const sessionID = (event as any).properties?.sessionID
      if (!sessionID) return

      try {
        const resp = await client.session.messages({ path: { id: sessionID } })
        const messages = (resp as any)?.data ?? resp
        if (!Array.isArray(messages) || messages.length === 0) return
        const last = messages[messages.length - 1]
        if (!last.info || last.info.role !== "assistant") return
        if (last.info.id === state.lastSpokenMessageID) return

        state.lastSpokenMessageID = last.info.id
        writeConfig("last_message_id_opencode", last.info.id)

        const textParts = (last.parts ?? [])
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text ?? "")

        let text = stripMarkdown(textParts.join("\n"))
        if (!text || text.length < 5) return
        text = truncateAtWordBoundary(text, maxChars)

        if (!await checkAudioAvailable(state)) {
          await log("warn", "PulseAudio unavailable — skipping TTS")
          return
        }

        if (state.speaking) {
          killTTS(state)
          state.pendingText = null
          state.speaking = false
        }

        state.speaking = true
        await log("info", `Speaking ${text.length} chars [${state.engine}/${state.voice[state.engine]}]`)
        speakText(text)
      } catch (err: any) {
        await log("error", `TTS error: ${err?.message || String(err)}`)
      }
    },

    dispose: async () => {
      state.enabled = false
      state.speaking = false
      state.pendingText = null
      killTTS(state)
    },
  }
}
