import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRAMES = ['home.png', 'playing.png', 'chat.png', 'settings.png', 'brain.png'];

function loadRgba(file) {
  const png = PNG.sync.read(readFileSync(path.join(ROOT, 'screenshots', file)));
  return { width: png.width, height: png.height, data: png.data };
}

const first = loadRgba(FRAMES[0]);
const gif = GIFEncoder();

for (const file of FRAMES) {
  const { width, height, data } = loadRgba(file);
  const palette = quantize(data, 256);
  const index = applyPalette(data, palette);
  gif.writeFrame(index, width, height, { palette, delay: 1200 });
}

gif.finish();
writeFileSync(path.join(ROOT, 'assets', 'demo.gif'), Buffer.from(gif.bytes()));
console.log('saved assets/demo.gif');
