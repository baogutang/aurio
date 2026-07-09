// Shared Web Audio mixer bus. Both <audio> elements are tapped exactly once
// (createMediaElementSource throws on a second tap), summed through a master
// gain, so ducking happens on musicGain — a schedulable a-rate ramp that does
// NOT dim the spectrum — instead of el.volume (a pre-tap instantaneous step).
//
//   music -> musicSource -> musicGain -> musicAnalyser -> masterGain -> dest
//   voice -> voiceSource -> voiceGain -> [booth chain] -> voiceAnalyser -> masterGain

export interface Mixer {
  ac: AudioContext;
  musicGain: GainNode;
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

export function initMixer(music: HTMLAudioElement, voice: HTMLAudioElement): Mixer | null {
  if (mixer) return mixer;
  if (initTried) return null;
  initTried = true;
  try {
    const AC = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();

    const musicGain = ac.createGain();
    const voiceGain = ac.createGain();
    const masterGain = ac.createGain();

    const musicAnalyser = ac.createAnalyser();
    musicAnalyser.fftSize = 256;
    musicAnalyser.smoothingTimeConstant = 0.78;

    const voiceAnalyser = ac.createAnalyser();
    voiceAnalyser.fftSize = 256;
    voiceAnalyser.smoothingTimeConstant = 0.6;

    masterGain.connect(ac.destination);

    // Wire the music path fully before tapping the voice element: a throw on the
    // second tap must not leave the (already-tapped) music element routed to a
    // dead end and silent.
    const musicSource = ac.createMediaElementSource(music);
    musicSource.connect(musicGain);
    musicGain.connect(musicAnalyser);
    musicAnalyser.connect(masterGain);

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

export function resumeMixer(): void {
  if (!mixer) return;
  mixer.ac.resume().catch(() => {});
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
