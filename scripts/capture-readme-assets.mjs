/**
 * Capture README screenshots from a running Aurio server.
 * Usage: node scripts/capture-readme-assets.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const BASE = process.env.AURIO_URL || 'http://localhost:8080';

const VIEW = { width: 420, height: 760 };

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), type: 'png' });
  console.log('saved', name);
}

async function clickByAria(page, name) {
  await page.getByRole('button', { name }).click({ timeout: 8000 });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, 'home.png');

  await clickByAria(page, '设置');
  await page.waitForTimeout(900);
  await shot(page, 'settings.png');

  // AI brain panel
  await page.getByText('大脑 · AI', { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'brain.png');

  // Fresh page for chat / playing captures (settings overlay blocks clicks)
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  await page.getByLabel('打开对话').click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await shot(page, 'chat.png');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await clickByAria(page, '播放');
  await page.waitForTimeout(2500);
  await shot(page, 'playing.png');

  // Dark theme hero
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'DARK' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(ROOT, 'assets', 'hero.png'), type: 'png' });
  console.log('saved assets/hero.png');

  await browser.close();

  // Post-process marketing assets
  const { spawnSync } = await import('node:child_process');
  for (const script of ['make-hero-showcase.mjs', 'make-demo-gif.mjs']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
