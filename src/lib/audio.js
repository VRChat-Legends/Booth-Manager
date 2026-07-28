// UI sounds, all synthesized with WebAudio. No audio files ship with the app.

let ctx = null;
let sfxOn = true;
let pingOn = true;

function ensureCtx() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setSfxEnabled(enabled) {
  sfxOn = !!enabled;
}

export function setPingEnabled(enabled) {
  pingOn = !!enabled;
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

/* soft two-note chime for @mentions and new activity */
export function ping() {
  if (!pingOn) return;
  const c = ensureCtx();
  const now = c.currentTime;
  for (const [freq, at, vol] of [[880, 0, 0.05], [1174.66, 0.11, 0.045]]) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now + at);
    g.gain.linearRampToValueAtTime(vol, now + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.6);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.65);
  }
}
