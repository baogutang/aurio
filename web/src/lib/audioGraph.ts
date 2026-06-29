// Shared Web Audio graph — createMediaElementSource() can only be called once per <audio>.
const graphs = new WeakMap<HTMLAudioElement, {
  ac: AudioContext;
  an: AnalyserNode;
  data: Uint8Array;
}>();

export function getAnalyser(audio: HTMLAudioElement) {
  let g = graphs.get(audio);
  if (g) {
    g.ac.resume().catch(() => {});
    return g;
  }
  try {
    const ac = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const src = ac.createMediaElementSource(audio);
    const an = ac.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.78;
    src.connect(an);
    an.connect(ac.destination);
    g = { ac, an, data: new Uint8Array(an.frequencyBinCount) };
    graphs.set(audio, g);
    return g;
  } catch {
    return null;
  }
}
