/**
 * Build premium README hero + showcase images from captured screenshots.
 * Usage: node scripts/make-hero-showcase.mjs
 */
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function roundedMask(w, h, r) {
  return Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
}

async function frameShot(input, w, h, radius = 28) {
  return sharp(input)
    .resize(w, h, { fit: 'cover' })
    .composite([{ input: roundedMask(w, h, radius), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function withShadow(buf, blur = 36, yOffset = 14) {
  const meta = await sharp(buf).metadata();
  const w = meta.width;
  const h = meta.height;
  const pad = 48;
  const blurred = await sharp(buf).blur(blur).modulate({ brightness: 0.15 }).ensureAlpha().toBuffer();
  return sharp({
    create: {
      width: w + pad * 2,
      height: h + pad * 2 + yOffset,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: blurred, left: pad, top: pad + yOffset },
      { input: buf, left: pad, top: pad },
    ])
    .png()
    .toBuffer();
}

function sceneSvg(w, h) {
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g1" cx="22%" cy="18%" r="58%">
      <stop offset="0%" stop-color="#ff6a3d" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#ff6a3d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="78%" cy="82%" r="52%">
      <stop offset="0%" stop-color="#5ad19a" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#5ad19a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#151518"/>
      <stop offset="100%" stop-color="#040405"/>
    </linearGradient>
    <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1.4" cy="1.4" r="0.9" fill="#ffffff" fill-opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#base)"/>
  <rect width="${w}" height="${h}" fill="url(#grid)"/>
  <rect width="${w}" height="${h}" fill="url(#g1)"/>
  <rect width="${w}" height="${h}" fill="url(#g2)"/>
</svg>`);
}

async function main() {
  const darkSrc = path.join(ROOT, 'assets', 'hero.png');
  const lightSrc = path.join(ROOT, 'screenshots', 'home.png');
  const playSrc = path.join(ROOT, 'screenshots', 'playing.png');

  for (const f of [darkSrc, lightSrc, playSrc]) {
    if (!existsSync(f)) throw new Error(`Missing ${f} — run: node scripts/capture-readme-assets.mjs`);
  }

  const phoneW = 248;
  const phoneH = Math.round(phoneW * (760 / 420));

  const dark = await withShadow(await frameShot(darkSrc, phoneW, phoneH, 30));
  const light = await withShadow(await frameShot(lightSrc, phoneW, phoneH, 30));
  const play = await withShadow(await frameShot(playSrc, phoneW, phoneH, 30));

  const dMeta = await sharp(dark).metadata();
  const lMeta = await sharp(light).metadata();
  const pMeta = await sharp(play).metadata();

  const showcaseW = 1200;
  const showcaseH = 620;
  const yBase = Math.round((showcaseH - dMeta.height) / 2);

  await sharp(sceneSvg(showcaseW, showcaseH))
    .composite([
      { input: light, left: 120, top: yBase + 18 },
      { input: dark, left: 420, top: yBase - 8 },
      { input: play, left: 720, top: yBase + 12 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'assets', 'hero-showcase.png'));

  const heroW = 920;
  const heroH = 660;
  const bigW = 280;
  const bigH = Math.round(bigW * (760 / 420));
  const device = await withShadow(await frameShot(darkSrc, bigW, bigH, 34), 48, 18);
  const devMeta = await sharp(device).metadata();

  await sharp(sceneSvg(heroW, heroH))
    .composite([
      {
        input: device,
        left: Math.round((heroW - devMeta.width) / 2),
        top: Math.round((heroH - devMeta.height) / 2) + 6,
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'assets', 'hero-banner.png'));

  console.log('saved assets/hero-showcase.png');
  console.log('saved assets/hero-banner.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
