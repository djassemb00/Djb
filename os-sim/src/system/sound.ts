// Minimal, dependency-free SFX engine built on the Web Audio API.
// Everything is synthesised at runtime — no asset downloads needed.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

let muted = false;
export function setMuted(value: boolean) {
  muted = value;
}
export function isMuted() {
  return muted;
}

type Tone = {
  freq: number;
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
};

function play(tones: Tone[]) {
  const ac = audio();
  if (!ac || muted) return;
  const now = ac.currentTime;
  for (const t of tones) {
    const start = now + (t.delay ?? 0);
    const dur = t.dur ?? 0.12;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, t.to), start + dur);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(t.gain ?? 0.08, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp).connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

export const sfx = {
  tap: () => play([{ freq: 880, to: 1180, dur: 0.06, type: 'triangle', gain: 0.05 }]),
  open: () => play([
    { freq: 420, to: 720, dur: 0.18, type: 'sine', gain: 0.06 },
    { freq: 630, to: 980, dur: 0.16, type: 'triangle', gain: 0.03, delay: 0.05 },
  ]),
  close: () => play([{ freq: 620, to: 300, dur: 0.14, type: 'sine', gain: 0.05 }]),
  error: () => play([
    { freq: 220, dur: 0.14, type: 'square', gain: 0.04 },
    { freq: 170, dur: 0.2, type: 'square', gain: 0.04, delay: 0.12 },
  ]),
  boot: () => play([
    { freq: 196, to: 392, dur: 0.9, type: 'sine', gain: 0.05 },
    { freq: 294, to: 588, dur: 0.9, type: 'triangle', gain: 0.03, delay: 0.25 },
    { freq: 587, to: 880, dur: 0.7, type: 'sine', gain: 0.02, delay: 0.5 },
  ]),
  unlock: () => play([
    { freq: 520, to: 780, dur: 0.14, type: 'sine', gain: 0.06 },
    { freq: 780, to: 1040, dur: 0.2, type: 'sine', gain: 0.045, delay: 0.1 },
  ]),
  notify: () => play([
    { freq: 1046, dur: 0.1, type: 'sine', gain: 0.05 },
    { freq: 1318, dur: 0.16, type: 'sine', gain: 0.045, delay: 0.09 },
  ]),
};
