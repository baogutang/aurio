// Runtime settings the user edits from the UI (Navidrome creds, keys, etc.).
// Stored as a flat key/value map using the same names as .env, so saved values
// simply override env. Persisted to data/settings.json; applied live via
// applyOverrides (no restart needed). This file may contain secrets — it lives
// under data/ which is gitignored.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, applyOverrides } from './config.js';

const DATA_DIR = path.join(DATA_ROOT, 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

let cache = {};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadSettings() {
  try {
    if (fs.existsSync(FILE)) cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.error('[settings] load failed:', e.message);
    cache = {};
  }
  applyOverrides(cache);
  return cache;
}

export function getSettings() {
  return cache;
}

// Merge a partial update. Keys with undefined/null are ignored (so omitting a
// password leaves the stored one untouched); an explicit '' clears a value.
export function saveSettings(partial = {}) {
  const next = { ...cache };
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined || v === null) continue;
    next[k] = v;
  }
  cache = next;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[settings] save failed:', e.message);
  }
  applyOverrides(cache);
  return cache;
}
