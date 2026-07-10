// Shared Web Audio mixer bus. All three <audio> elements are tapped exactly
// once (createMediaElementSource throws on a second tap), summed through a
// master gain, so ducking happens on the shared music bus gain — a schedulable
// a-rate ramp that does NOT dim the spectrum — instead of el.volume (a pre-tap
// instantaneous step).
//
// Two music elements (A/B) alternate so the next track can be prefetched and
// crossfaded in with equal-power (cos/sin) curves. Each channel has its own
// GainNode for the fade; both feed the shared musicGain (the duck target), so
// duck × crossfade compose multiplicatively and the analyser sees the sum.
//
//   musicA -> srcA -> channelGain[0] ─┐
//                                     ├-> musicGain -> musicAnalyser ─┐
//   musicB -> srcB -> channelGain[1] ─┘        (duck bus)             ├-> masterGain -> limiter -> dest
//                                                                     │
//   voice -> voiceSource -> voiceGain -> [booth chain] -> voiceAnalyser ─┘
//
// The limiter is a brick-wall safety net (−1 dB ceiling, 20:1) so the per-item
// loudness normalization can boost quiet tracks toward −16 LUFS without ever
// clipping the DAC on inter-sample peaks.

export type MusicChannel = 0 | 1;

export interface Mixer {
  ac: AudioContext;
  /** Shared music bus gain — the duck target for the DJ voice. */
  musicGain: GainNode;
  /** Per-element gains upstream of the bus; the crossfade happens here. */
  musicChannelGains: [GainNode, GainNode];
  voiceGain: GainNode;
  masterGain: GainNode;
  musicAnalyser: AnalyserNode;
  voiceAnalyser: AnalyserNode;
  musicData: Uint8Array;
  voiceData: Uint8Array;
}

let mixer: Mixer | null = null;
let initTried = false;
const voiceTime = new Uint8Array(256);

// White-noise burst shaped by an exponential decay — a small procedural room
// so the voice bus does not sound like it is playing in a vacuum.
function makeImpulse(ac: AudioContext, seconds = 0.3): AudioBuffer {
  const n = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
  }
  return buf;
}

function buildVoiceChain(ac: AudioContext): { input: AudioNode; output: AudioNode } {
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 90;
  hp.Q.value = 0.707;

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 6;
  comp.ratio.value = 3;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;

  const deEss = ac.createBiquadFilter();
  deEss.type = 'peaking';
  deEss.frequency.value = 6500;
  deEss.Q.value = 2.5;
  deEss.gain.value = -4;

  const presence = ac.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 4000;
  presence.Q.value = 1.0;
  presence.gain.value = 3.5;

  hp.connect(comp);
  comp.connect(deEss);
  deEss.connect(presence);

  // Parallel dry/wet room off the presence tap.
  const dry = ac.createGain();
  dry.gain.value = 0.88;
  const wet = ac.createGain();
  wet.gain.value = 0.12;
  const conv = ac.createConvolver();
  conv.buffer = makeImpulse(ac);

  presence.connect(dry);
  presence.connect(conv);
  conv.connect(wet);

  const out = ac.createGain();
  dry.connect(out);
  wet.connect(out);

  return { input: hp, output: out };
}

// A context constructed outside a user gesture starts suspended, and once the
// music element is routed through the graph, suspended means total silence —
// not just a dead spectrum. Electron sets autoplayPolicy so it starts running;
// the browser PWA does not. Every play path calls resumeMixer(), but one that
// ever forgets would be silent forever, so arm the first gesture as a net.
function armGestureResume(ac: AudioContext): void {
  if (ac.state === 'running') return;
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const off = () => events.forEach((e) => window.removeEventListener(e, wake));
  const wake = () => { ac.resume().then(off).catch(() => {}); };
  events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
}

export function initMixer(
  musicA: HTMLAudioElement,
  musicB: HTMLAudioElement,
  voice: HTMLAudioElement,
): Mixer | null {
  if (mixer) return mixer;
  if (initTried) return null;
  initTried = true;
  try {
    const AC = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();

    const musicGain = ac.createGain();
    const chanA = ac.createGain();
    const chanB = ac.createGain();
    const voiceGain = ac.createGain();
    const masterGain = ac.createGain();

    const musicAnalyser = ac.createAnalyser();
    musicAnalyser.fftSize = 256;
    musicAnalyser.smoothingTimeConstant = 0.78;

    const voiceAnalyser = ac.createAnalyser();
    voiceAnalyser.fftSize = 256;
    voiceAnalyser.smoothingTimeConstant = 0.6;

    // Brick-wall limiter on the master bus (ADDITIVE — the graph shape above
    // is unchanged, this only sits between masterGain and the destination).
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.25;

    masterGain.connect(limiter);
    limiter.connect(ac.destination);

    // Wire each music path fully before tapping the next element: a throw on a
    // later tap must not leave an already-tapped element routed to a dead end
    // and silent.
    musicGain.connect(musicAnalyser);
    musicAnalyser.connect(masterGain);

    const srcA = ac.createMediaElementSource(musicA);
    srcA.connect(chanA);
    chanA.connect(musicGain);

    const srcB = ac.createMediaElementSource(musicB);
    srcB.connect(chanB);
    chanB.connect(musicGain);

    const voiceSource = ac.createMediaElementSource(voice);
    const chain = buildVoiceChain(ac);
    voiceSource.connect(voiceGain);
    voiceGain.connect(chain.input);
    chain.output.connect(voiceAnalyser);
    voiceAnalyser.connect(masterGain);

    ac.resume().catch(() => {});
    armGestureResume(ac);

    mixer = {
      ac,
      musicGain,
      musicChannelGains: [chanA, chanB],
      voiceGain,
      masterGain,
      musicAnalyser,
      voiceAnalyser,
      musicData: new Uint8Array(musicAnalyser.frequencyBinCount),
      voiceData: new Uint8Array(voiceAnalyser.frequencyBinCount),
    };
    return mixer;
  } catch {
    mixer = null;
    return null;
  }
}

export function getMixer(): Mixer | null {
  return mixer;
}

export function getMusicAnalyser(): { an: AnalyserNode; data: Uint8Array } | null {
  return mixer ? { an: mixer.musicAnalyser, data: mixer.musicData } : null;
}

export function getVoiceAnalyser(): { an: AnalyserNode; data: Uint8Array } | null {
  return mixer ? { an: mixer.voiceAnalyser, data: mixer.voiceData } : null;
}

// Cancel any in-flight ramp and re-anchor at the current value so overlapping
// ducks do not fight, then glide to target with the given time constant.
function ramp(gain: GainNode, ac: AudioContext, target: number, tau: number): void {
  const now = ac.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.setTargetAtTime(target, now, tau);
}

export function duckMusic(target = 0.25, tau = 0.08): void {
  if (!mixer) return;
  ramp(mixer.musicGain, mixer.ac, target, tau);
}

export function unduckMusic(tau = 0.5): void {
  if (!mixer) return;
  ramp(mixer.musicGain, mixer.ac, 1, tau);
}

// --- per-channel fades (the crossfade lives here, not on the duck bus) ------

const CURVE_POINTS = 33;

// Capture the current value, cancel whatever is scheduled (an interrupted fade
// must not snap), re-anchor, then draw the shaped curve. The curve starts a
// few ms out so it never collides with the anchor event; a browser that still
// rejects the curve gets a plain linear ramp instead of a click.
function scheduleFade(
  gain: GainNode,
  ac: AudioContext,
  shape: (t: number, v0: number) => number,
  seconds: number,
  endValue: number,
): void {
  const p = gain.gain;
  const now = ac.currentTime;
  const v0 = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(v0, now);
  if (seconds <= 0.02) {
    p.setValueAtTime(endValue, now);
    return;
  }
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    curve[i] = Math.max(0, shape(i / (CURVE_POINTS - 1), v0));
  }
  curve[0] = v0;
  curve[CURVE_POINTS - 1] = endValue;
  try {
    p.setValueCurveAtTime(curve, now + 0.006, seconds - 0.006);
  } catch {
    p.linearRampToValueAtTime(endValue, now + seconds);
  }
}

const fadeOutShape = (t: number, v0: number) => v0 * Math.cos((t * Math.PI) / 2);
const fadeInShapeTo = (peak: number) =>
  (t: number, v0: number) => v0 + (peak - v0) * Math.sin((t * Math.PI) / 2);

/** Hard-set a channel gain (cancels any in-flight fade). */
export function setMusicChannelGain(ch: MusicChannel, value: number): void {
  if (!mixer) return;
  const p = mixer.musicChannelGains[ch].gain;
  const now = mixer.ac.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(Math.max(0, value), now);
}

/**
 * Equal-power crossfade between the two music channels: cos out, sin in, so
 * the summed power stays flat and there is no mid-fade dip. `toPeak` is the
 * incoming channel's resting gain — the per-track loudness normalization
 * factor (−16 LUFS, from the cue analysis) multiplies into the fade here.
 */
export function crossfadeMusic(from: MusicChannel, to: MusicChannel, seconds = 2, toPeak = 1): void {
  if (!mixer || from === to) return;
  scheduleFade(mixer.musicChannelGains[from], mixer.ac, fadeOutShape, seconds, 0);
  scheduleFade(mixer.musicChannelGains[to], mixer.ac, fadeInShapeTo(toPeak), seconds, toPeak);
}

/** Quick fade-out of one channel (manual skip: no 2s drag, just no click). */
export function fadeOutMusic(ch: MusicChannel, seconds = 0.25): void {
  if (!mixer) return;
  scheduleFade(mixer.musicChannelGains[ch], mixer.ac, fadeOutShape, seconds, 0);
}

export function resumeMixer(): void {
  if (!mixer) return;
  mixer.ac.resume().catch(() => {});
}

// --- UI sounds (retune) ------------------------------------------------------
// A dedicated small gain straight into masterGain: UI sounds must not ride the
// voice booth chain (the compressor would pump under them) and must not sit on
// the ducked music bus. No mixer → no sound, no crash.

let uiGain: GainNode | null = null;
let retuneNoise: AudioBuffer | null = null;

function uiBus(m: Mixer): GainNode {
  if (!uiGain) {
    uiGain = m.ac.createGain();
    uiGain.gain.value = 1;
    uiGain.connect(m.masterGain);
  }
  return uiGain;
}

/**
 * ~0.3s procedural retune: a band-passed white-noise burst sweeping up the
 * dial plus a short heterodyne-style whistle falling into place. Same
 * generated-not-sampled approach as makeImpulse above.
 */
export function playRetuneSound(): void {
  const m = mixer;
  if (!m) return;
  try {
    const ac = m.ac;
    ac.resume().catch(() => {});
    const out = uiBus(m);
    const t0 = ac.currentTime + 0.02;
    const dur = 0.3;

    if (!retuneNoise) {
      const n = Math.max(1, Math.floor(ac.sampleRate * dur));
      retuneNoise = ac.createBuffer(1, n, ac.sampleRate);
      const d = retuneNoise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }

    // Static burst: noise through a band-pass whose center sweeps upward,
    // like scrubbing across stations.
    const noise = ac.createBufferSource();
    noise.buffer = retuneNoise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(700, t0);
    bp.frequency.exponentialRampToValueAtTime(2600, t0 + dur * 0.8);
    const nGain = ac.createGain();
    nGain.gain.setValueAtTime(0, t0);
    nGain.gain.linearRampToValueAtTime(0.14, t0 + 0.03);
    nGain.gain.setTargetAtTime(0, t0 + 0.16, 0.05);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(out);

    // The whistle: a quick downward chirp locking onto the new frequency.
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, t0);
    osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.22);
    const oGain = ac.createGain();
    oGain.gain.setValueAtTime(0, t0);
    oGain.gain.linearRampToValueAtTime(0.045, t0 + 0.04);
    oGain.gain.setTargetAtTime(0, t0 + 0.18, 0.04);
    osc.connect(oGain);
    oGain.connect(out);

    const tEnd = t0 + dur + 0.15;
    noise.start(t0);
    noise.stop(tEnd);
    osc.start(t0);
    osc.stop(tEnd);
    noise.onended = () => { noise.disconnect(); bp.disconnect(); nGain.disconnect(); };
    osc.onended = () => { osc.disconnect(); oGain.disconnect(); };
  } catch {
    // UI sound is best-effort; never let it break playback.
  }
}

// 0..1 RMS-ish level off the voice bus, for driving the UI.
export function voiceLevel(): number {
  if (!mixer) return 0;
  mixer.voiceAnalyser.getByteTimeDomainData(voiceTime as Uint8Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < voiceTime.length; i++) {
    const v = (voiceTime[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / voiceTime.length) * 2);
}
