// Generative background music + UI sounds, all synthesized with WebAudio.
// No audio files ship with the app.

let ctx = null;
let musicGain = null;
let musicTimer = null;
let musicOn = false;
let sfxOn = true;
let chordIndex = 0;

// Am, F, C, G progression (frequencies in Hz), airy pad voicing
const CHORDS = [
  [220.0, 261.63, 329.63, 440.0],
  [174.61, 220.0, 261.63, 349.23],
  [196.0, 261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66, 392.0]
];
const CHORD_SECONDS = 8;

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;
    musicGain.connect(lp);
    lp.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function scheduleChord() {
  if (!musicOn || !ctx) return;
  const chord = CHORDS[chordIndex % CHORDS.length];
  chordIndex += 1;
  const now = ctx.currentTime;

  for (const freq of chord) {
    for (const detune of [-4, 3]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.detune.value = detune;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.028, now + 2.4);
      g.gain.setValueAtTime(0.028, now + CHORD_SECONDS - 2.2);
      g.gain.linearRampToValueAtTime(0, now + CHORD_SECONDS + 0.4);

      // slow tremolo
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.22 + Math.random() * 0.1;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.008;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);

      osc.connect(g);
      g.connect(musicGain);
      osc.start(now);
      osc.stop(now + CHORD_SECONDS + 0.6);
      lfo.start(now);
      lfo.stop(now + CHORD_SECONDS + 0.6);
    }
  }
  // sparse sparkle note on top
  if (Math.random() < 0.7) {
    const top = chord[chord.length - 1] * 2;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = top;
    const g = ctx.createGain();
    const t0 = now + 1.5 + Math.random() * 3.5;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.012, t0 + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(t0);
    osc.stop(t0 + 3.4);
  }
}

export function setMusicEnabled(enabled) {
  musicOn = !!enabled;
  if (musicOn) {
    ensureCtx();
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
    if (!musicTimer) {
      scheduleChord();
      musicTimer = setInterval(scheduleChord, CHORD_SECONDS * 1000);
    }
  } else if (ctx) {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }
}

export function setSfxEnabled(enabled) {
  sfxOn = !!enabled;
}

export function click() {
  if (!sfxOn) return;
  const c = ensureCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 1850;
  const g = c.createGain();
  g.gain.setValueAtTime(0.055, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

export function success() {
  if (!sfxOn) return;
  const c = ensureCtx();
  const now = c.currentTime;
  for (const [freq, at] of [[523.25, 0], [783.99, 0.09]]) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, now + at);
    g.gain.linearRampToValueAtTime(0.06, now + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.5);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.55);
  }
}
