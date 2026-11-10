// gen-sfx-pack.mjs — synthesize the Canvix offline sound pack (Wave: Sound).
//
// Every file is an ORIGINAL synthesis (oscillators, shaped noise, envelopes
// — no samples, no third-party recordings), so the pack ships CC0 with a
// licence manifest we can actually grant (docs/SOUND.md). Sounds are small
// (mono 16-bit 44.1 kHz WAV, 0.12–1.4 s) because they double as animation
// SFX played in tight succession.
//
// Output: public/sfx/<id>.wav (16 sounds) — the catalogue lives in
// src/lib/assets/sfx-pack.ts (ids must match; sfx-pack.test.ts pins it).
// Run: node scripts/gen-sfx-pack.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SR = 44100

// ── tiny DSP kit ──────────────────────────────────────────────
/** deterministic LCG noise (same seed ⇒ same bytes ⇒ reproducible builds) */
function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

/** one-pole lowpass — smooths noise into whooshes/airs */
function lowpass(samples, cutoffHz, sr = SR) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / sr)
  let y = 0
  return samples.map((x) => (y = x * (1 - a) + y * a))
}

/** attack/decay envelope: 0→1 over attack s, 1→0 over the rest */
function env(n, attackS, releaseS = 0, sr = SR) {
  const a = Math.max(1, Math.round(attackS * sr))
  const rel = Math.max(0, Math.round(releaseS * sr))
  return (i) => {
    if (i < a) return i / a
    if (rel && i > n - rel) return Math.max(0, (n - i) / rel)
    return 1
  }
}

/** pad/truncate to exact length */
function fit(buf, n) {
  const out = new Float64Array(n)
  for (let i = 0; i < Math.min(n, buf.length); i++) out[i] = buf[i]
  return out
}

/** soft clip to [-1, 1] with gentle saturation */
function clip(x) {
  return Math.tanh(x * 1.2) * 0.92
}

// ── synth recipes (each returns Float64Array) ─────────────────

/** pure sine with exponential decay — chimes, pings */
function tone(freq, durS, { decay = 6, harmonics = [], attack = 0.004, sr = SR } = {}) {
  const n = Math.round(durS * sr)
  const out = new Float64Array(n)
  const e = env(n, attack, 0, sr)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const d = Math.exp(-decay * t) * e(i)
    let v = Math.sin(2 * Math.PI * freq * t)
    for (const [mult, amp] of harmonics) v += amp * Math.sin(2 * Math.PI * freq * mult * t)
    out[i] = clip(v * d)
  }
  return out
}

/** frequency sweep with an envelope — whooshes, risers */
function sweep(fromHz, toHz, durS, { decay = 3, attack = 0.05, tail = 0.15, sr = SR } = {}) {
  const n = Math.round(durS * sr)
  const out = new Float64Array(n)
  const e = env(n, attack, tail * 0, sr)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const p = i / n
    const f = fromHz * Math.pow(toHz / fromHz, p)
    phase += (2 * Math.PI * f) / sr
    const d = Math.exp(-decay * p * 2) * e(i) * (p < 0.9 ? 1 : (1 - p) / 0.1)
    out[i] = clip(Math.sin(phase) * d * 0.8)
  }
  return out
}

/** shaped noise — whoosh bodies, tape-ish textures */
function noise(durS, { cutoff = 900, attack = 0.08, release = 0.25, gain = 0.8, seed = 7, sr = SR } = {}) {
  const n = Math.round(durS * sr)
  const rnd = lcg(seed)
  const raw = new Float64Array(n)
  for (let i = 0; i < n; i++) raw[i] = rnd() * 2 - 1
  const smooth = lowpass(Array.from(raw), cutoff, sr)
  const e = env(n, attack, release, sr)
  return smooth.map((x, i) => clip(x * e(i) * gain))
}

/** kick — sine pitch drop with fast decay (classic 808-ish shape) */
function kick(fromHz = 160, toHz = 46, durS = 0.42, { sr = SR } = {}) {
  const n = Math.round(durS * sr)
  const out = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const p = i / n
    const f = fromHz * Math.pow(toHz / fromHz, Math.pow(p, 0.55))
    phase += (2 * Math.PI * f) / sr
    const d = Math.exp(-7 * p) * Math.min(1, i / (0.004 * sr))
    out[i] = clip(Math.sin(phase) * d)
  }
  return out
}

/** pop — short sine blip with a pitch flip and tiny click */
function pop(durS = 0.14, { sr = SR } = {}) {
  const n = Math.round(durS * sr)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const p = i / n
    const f = 340 + 900 * Math.exp(-26 * t)
    const d = Math.exp(-16 * t)
    out[i] = clip(Math.sin(2 * Math.PI * f * t) * d * 0.9 + (i < 40 ? (i / 40) * 0.25 : 0))
  }
  return out
}

/** sparkle — staggered high sine pings (arpeggio-ish shimmer) */
function sparkle(notes, noteDur, { decay = 7, sr = SR } = {}) {
  const n = Math.round((notes.length * noteDur + 0.5) * sr)
  const out = new Float64Array(n)
  notes.forEach((f, k) => {
    const seg = tone(f, noteDur + 0.4, { decay, attack: 0.002, sr })
    const off = Math.round(k * noteDur * sr)
    for (let i = 0; i < seg.length && off + i < n; i++) out[off + i] = clip(out[off + i] + seg[i] * 0.7)
  })
  return out
}

/** click — the shortest useful UI tick */
function click(durS = 0.045, { sr = SR } = {}) {
  const n = Math.round(durS * sr)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    out[i] = clip((Math.sin(2 * Math.PI * 2100 * t) * 0.6 + (i < 30 ? 0.35 * (1 - i / 30) : 0)) * Math.exp(-70 * t))
  }
  return out
}

// ── the pack (16 sounds, 4 categories) ────────────────────────
const SOUNDS = [
  // Transitions — played on page changes / big element entrances
  { id: 'whoosh-soft', make: () => noise(0.85, { cutoff: 650, attack: 0.12, release: 0.3, gain: 0.85, seed: 11 }) },
  { id: 'whoosh-fast', make: () => noise(0.45, { cutoff: 1400, attack: 0.03, release: 0.12, gain: 0.9, seed: 23 }) },
  { id: 'swoosh-reverse', make: () => sweep(180, 900, 0.9, { decay: 0.6, attack: 0.02, tail: 0.2 }) },
  { id: 'slide-in', make: () => sweep(700, 240, 0.5, { decay: 1.2, attack: 0.01, tail: 0.1 }) },
  // Impacts — pops, drops, hits
  { id: 'pop', make: () => pop() },
  { id: 'thud', make: () => kick(120, 38, 0.35) },
  { id: 'boom', make: () => kick(95, 30, 0.9) },
  { id: 'impact-hit', make: () => fit([...noise(0.18, { cutoff: 2600, attack: 0.002, release: 0.1, gain: 0.7, seed: 41 }), ...kick(220, 70, 0.3)], Math.round(0.5 * SR)) },
  // UI — clicks, ticks, camera
  { id: 'click', make: () => click() },
  { id: 'tick', make: () => click(0.03) },
  { id: 'toggle', make: () => fit([...click(0.035), ...new Float64Array(Math.round(0.03 * SR)), ...click(0.05)], Math.round(0.14 * SR)) },
  { id: 'camera', make: () => fit([...noise(0.03, { cutoff: 3800, attack: 0.001, release: 0.02, gain: 0.8, seed: 5 }), ...new Float64Array(Math.round(0.045 * SR)), ...noise(0.05, { cutoff: 3000, attack: 0.001, release: 0.03, gain: 0.6, seed: 9 })], Math.round(0.16 * SR)) },
  // Musical — chimes, drums, shimmer
  { id: 'chime', make: () => tone(880, 1.1, { decay: 4.2, harmonics: [[2, 0.28], [3, 0.1]], attack: 0.003 }) },
  { id: 'chime-sparkle', make: () => sparkle([1174.7, 1318.5, 1760, 2093], 0.09) },
  { id: 'drum-kick', make: () => kick(150, 48, 0.4) },
  { id: 'hat', make: () => noise(0.09, { cutoff: 6800, attack: 0.001, release: 0.05, gain: 0.55, seed: 77 }) },
]

// ── WAV writer (mono 16-bit PCM) ─────────────────────────────
function wav(samples) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

// ── emit ──────────────────────────────────────────────────────
const OUT = join(process.cwd(), 'public', 'sfx')
mkdirSync(OUT, { recursive: true })
const manifest = []
for (const { id, make } of SOUNDS) {
  const samples = make()
  const bytes = wav(samples)
  writeFileSync(join(OUT, `${id}.wav`), bytes)
  manifest.push({ id, seconds: +(samples.length / SR).toFixed(2), bytes: bytes.length })
}
console.log(`sfx pack: ${manifest.length} sounds → public/sfx/`)
for (const m of manifest) console.log(`  ${m.id}.wav  ${m.seconds}s  ${(m.bytes / 1024).toFixed(1)} kB`)
