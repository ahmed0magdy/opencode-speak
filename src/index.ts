import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { spawn } from "bun"
import { unlinkSync, existsSync, mkdirSync } from "fs"
import { readFile, writeFile } from "fs/promises"
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

const VALID_KOKORO_LANGS = ["en-us", "en-gb", "ja", "zh", "hi", "fr", "it", "pt", "es", "ko"]
const VALID_SPEAK_LANGS = ["auto", "na", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "zh"]
const VALID_MODELS = ["int8", "fp16", "full"]

const DEFAULT_MAX_CHARS = 2000
const CONFIG_DIR = join(homedir(), ".config", "opencode-speak")
const CONFIG_CACHE_MS = 5000
let lastConfigRead = 0

function readConfigSync(key: string, fallback: string): string {
  const file = join(CONFIG_DIR, key)
  try {
    const { readFileSync } = require("fs")
    return (readFileSync(file, "utf-8") as string).trim() || fallback
  } catch {
    return fallback
  }
}

async function writeConfigAsync(key: string, value: string): Promise<void> {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    await writeFile(join(CONFIG_DIR, key), value, "utf-8")
  } catch (err: any) {
    console.error(`[opencode-speak] config write failed: ${key}=${value}: ${err?.message}`)
  }
}

function syncStateFromConfig(state: TTSState): void {
  state.enabled = readConfigSync("enabled", "false") === "true"
  const engine = readConfigSync("engine", state.engine)
  if (engine === "kokoro" || engine === "speak") state.engine = engine
  state.voice.kokoro = readConfigSync("voice_kokoro", state.voice.kokoro)
  state.voice.speak = readConfigSync("voice_speak", state.voice.speak)
  state.speed.kokoro = readConfigSync("speed_kokoro", state.speed.kokoro)
  state.speed.speak = readConfigSync("speed_speak", state.speed.speak)
  state.lang.kokoro = readConfigSync("lang_kokoro", state.lang.kokoro)
  state.lang.speak = readConfigSync("lang_speak", state.lang.speak)
  state.kokoroModel = readConfigSync("kokoro_model", state.kokoroModel)
  state.speakSteps = readConfigSync("speak_steps", state.speakSteps)
}

async function syncStateToConfig(state: TTSState): Promise<void> {
  await Promise.all([
    writeConfigAsync("enabled", state.enabled ? "true" : "false"),
    writeConfigAsync("engine", state.engine),
    writeConfigAsync("voice_kokoro", state.voice.kokoro),
    writeConfigAsync("voice_speak", state.voice.speak),
    writeConfigAsync("speed_kokoro", state.speed.kokoro),
    writeConfigAsync("speed_speak", state.speed.speak),
    writeConfigAsync("lang_kokoro", state.lang.kokoro),
    writeConfigAsync("lang_speak", state.lang.speak),
    writeConfigAsync("kokoro_model", state.kokoroModel),
    writeConfigAsync("speak_steps", state.speakSteps),
  ])
}

function resolveExecutable(name: string): string | null {
  const localBin = join(homedir(), ".local", "bin", name)
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
    const proc = spawn({ cmd: ["pactl", "info"], stdout: "ignore", stderr: "ignore" })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

function killTTS(state: TTSState): void {
  if (state.activeProc) {
    try { process.kill(-state.activeProc.pid, "SIGTERM") } catch {
      try { state.activeProc.kill() } catch {}
    }
    state.activeProc = null
  }
  try { spawn({ cmd: ["pkill", "-f", "ffplay.*kokoro"], stdout: "ignore", stderr: "ignore" }) } catch {}
  try { spawn({ cmd: ["pkill", "-f", "ffplay.*opencode-speak"], stdout: "ignore", stderr: "ignore" }) } catch {}
  try { spawn({ cmd: ["pkill", "-f", "mpv.*kokoro"], stdout: "ignore", stderr: "ignore" }) } catch {}
  try { spawn({ cmd: ["pkill", "-f", "mpv.*opencode-speak"], stdout: "ignore", stderr: "ignore" }) } catch {}
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
    await writeFile(tmp, text, "utf-8")

    const args: string[] =
      engine === "kokoro"
        ? [bin, "speak", "--voice", voice, "--speed", state.speed.kokoro, "--lang", state.lang.kokoro, "--model", state.kokoroModel, "--play", "--service", "off"]
        : [bin, "-v", voice, "-s", state.speed.speak, "-l", state.lang.speak, "--steps", state.speakSteps, "--no-daemon"]

    const proc = spawn({
      cmd: ["setsid", ...args],
      stdin: Bun.file(tmp),
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, ONNX_PROVIDER: process.env.ONNX_PROVIDER || "CUDAExecutionProvider" },
    })

    state.activeProc = proc

    const exitCode = await proc.exited
    state.activeProc = null
    state.lastSynthesisEnd = Date.now()

    if (exitCode !== 0 && state.enabled) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`${engine} exited ${exitCode}: ${stderr.slice(0, 200)}`)
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
  const lines = [
    `═ TTS: ${state.enabled ? "ON" : "OFF"} ═ Engine: ${state.engine} [${availableEngines.join(", ")}] ═`,
    "",
    "Kokoro:",
    `  Voice: ${state.voice.kokoro}`,
    `  Speed: ${state.speed.kokoro}  [0.5 - 4.0]`,
    `  Lang:  ${state.lang.kokoro}  [en-us, en-gb, ja, zh, hi, fr, it, pt, es, ko]`,
    `  Model: ${state.kokoroModel}  [int8, fp16, full]`,
    "",
    "Supertonic 3:",
    `  Voice: ${state.voice.speak}`,
    `  Speed: ${state.speed.speak}  [0.7 - 2.0]`,
    `  Lang:  ${state.lang.speak}  [auto, na, ar, de, es, fr, hi, it, ja, ko, pt, ru, zh]`,
    `  Steps: ${state.speakSteps}  [5-12, higher=better]`,
    "",
    "/tts on|off|kokoro|speak|voice|speed|lang|model|steps|voices|test",
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
    kokoroModel: "full",
    speakSteps: "12",
    speaking: false,
    lastSpokenMessageID: readConfigSync("last_message_id", ""),
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
      await syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      await log("info", "TTS enabled")
      return
    }

    if (args === "off") {
      state.enabled = false
      state.speaking = false
      await syncStateToConfig(state)
      killTTS(state)
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
      await syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      await log("info", `Switched to engine: ${engine}`)
      return
    }

    if (args === "voices") {
      const voices = VOICES[state.engine]
      await toast(`[${state.engine}] All voices:\n${voices.join(", ")}`, "info", 20000)
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
      await syncStateToConfig(state)
      await toast(formatStatus(state), "success")
      await log("info", `Voice changed to: ${v}`)
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
      const val = parseInt(args.slice(6).trim(), 10)
      if (isNaN(val) || val < 5 || val > 12) {
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
      if (!await checkAudioAvailable()) {
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
        "info", 20000,
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
      if (event.type !== "session.idle") return
      if (state.speaking) return

      const now = Date.now()
      if (now - lastConfigRead > CONFIG_CACHE_MS) {
        syncStateFromConfig(state)
        lastConfigRead = now
      }
      if (!state.enabled) return

      const sessionID = (event as any).properties?.sessionID
      if (!sessionID) return

      state.speaking = true
      synthesize_background: {
        try {
          const resp = await client.session.messages({ path: { id: sessionID } })
          const messages = (resp as any)?.data ?? resp
          if (!Array.isArray(messages) || messages.length === 0) break synthesize_background
          const last = messages[messages.length - 1]
          if (!last.info || last.info.role !== "assistant") break synthesize_background
          if (last.info.id === state.lastSpokenMessageID) break synthesize_background

          state.lastSpokenMessageID = last.info.id
          writeConfigAsync("last_message_id", last.info.id)

          const textParts = (last.parts ?? [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text ?? "")

          let text = stripMarkdown(textParts.join("\n"))
          if (!text || text.length < 5) break synthesize_background
          if (text.length > maxChars) text = text.slice(0, maxChars)

          await log("info", `Speaking ${text.length} chars [${state.engine}/${state.voice[state.engine]}]`)

          if (!await checkAudioAvailable()) {
            await log("warn", "PulseAudio unavailable — skipping TTS")
            break synthesize_background
          }

          await synthesize(text, state.engine, state.voice[state.engine], binaries, state)
        } catch (err: any) {
          await log("error", `TTS error: ${err?.message || String(err)}`)
        }
      }
      state.speaking = false
    },

    dispose: async () => {
      state.enabled = false
      state.speaking = false
      killTTS(state)
    },
  }
}
