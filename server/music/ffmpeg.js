// Shared ffmpeg front-end — feature detection + a bounded runner, and nothing
// else. cue.js drives it for silence/loudness analysis, imaging.js for
// stitching the hourly station ID; the detection logic lives once, here.
import { spawn } from 'node:child_process';

export const FFMPEG_RUN_TIMEOUT_MS = 10000;
const VERSION_TIMEOUT_MS = 5000;

// Spawn `bin args…`, capture stderr (where ffmpeg logs everything), resolve
// { code, stderr }. Kills the child and rejects on timeout — an ffmpeg stuck
// on a dead stream must never wedge the caller's queue.
export function runFfmpeg(bin, args, timeoutMs = FFMPEG_RUN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) { reject(e); return; }
    let stderr = '';
    let done = false;
    const killer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      // silencedetect+summary is tiny; bound memory anyway on pathological logs
      if (stderr.length > 512 * 1024) stderr = stderr.slice(-256 * 1024);
    });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      reject(e);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({ code, stderr });
    });
  });
}

export function ffmpegBin() {
  return process.env.AURIO_FFMPEG || 'ffmpeg';
}

// Feature detection, cached per process: most users won't have ffmpeg, and the
// answer doesn't change under us. `AURIO_FFMPEG` overrides the PATH lookup.
let ffmpegCheck = null;
export function ffmpegAvailable({ exec = runFfmpeg } = {}) {
  if (!ffmpegCheck) {
    ffmpegCheck = Promise.resolve()
      .then(() => exec(ffmpegBin(), ['-version'], VERSION_TIMEOUT_MS))
      .then((r) => r?.code === 0)
      .catch(() => false);
  }
  return ffmpegCheck;
}

/** Test seam: forget the cached probe result. */
export function resetFfmpegProbe() {
  ffmpegCheck = null;
}
