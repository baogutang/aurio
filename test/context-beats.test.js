import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Beat mapping + trigger labels for every scheduled kind (server/context.js).
// The point: BEATS_FOR_KIND entries must resolve against beats that actually
// exist in prompts/voice-bible.zh.json (real, not decorative), and each kind
// the machinery fires must render a named 「本次触发」 directive.

let tmpDir;
let db;
let context;

const bible = JSON.parse(fs.readFileSync(path.resolve('prompts', 'voice-bible.zh.json'), 'utf8'));
const bibleBeats = new Set(bible.links.map((l) => l.beat));

// Every kind the machinery can fire: scheduler crons, dj.js priorities,
// rituals.js ceremonies, imaging aside (identity, not conversation).
const TRIGGER_KINDS = [
  'chat', 'plan', 'morning', 'mood', 'station', 'refill',
  'show-open', 'recap', 'feedback', 'first-run',
];

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-beats-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  delete process.env.OPENWEATHER_KEY; // keep environment() offline
  ({ db } = await import('../server/store.js'));
  context = await import('../server/context.js');
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.state.prefs = {}; // exemplar cursor back to 0
});

describe('BEATS_FOR_KIND', () => {
  it('covers every trigger kind, including first-run and feedback', () => {
    for (const kind of TRIGGER_KINDS) {
      expect(context.BEATS_FOR_KIND[kind], `missing beats for kind "${kind}"`).toBeTruthy();
      expect(context.BEATS_FOR_KIND[kind].length).toBeGreaterThan(0);
    }
  });

  it('every mapped beat exists in the voice bible — the mapping resolves', () => {
    for (const [kind, beats] of Object.entries(context.BEATS_FOR_KIND)) {
      for (const beat of beats) {
        expect(bibleBeats.has(beat), `kind "${kind}" prefers unknown beat "${beat}"`).toBe(true);
      }
    }
  });
});

describe('本次触发 labels', () => {
  it('first-run renders its own directive, not the generic 触发', async () => {
    const prompt = await context.assemble({ kind: 'first-run', fact: '首次开台：这是这台电台第一次为这位听众开播。' });
    expect(prompt).toContain('## 本次触发\n[首次开台');
    expect(prompt).not.toContain('\n[触发]');
  });

  it('feedback renders the skip-streak directive', async () => {
    const prompt = await context.assemble({ kind: 'feedback', fact: '用户连续跳过了 3 首歌' });
    expect(prompt).toContain('## 本次触发\n[听众连着跳过了几首');
  });

  it('an unknown kind still falls back to the generic label', async () => {
    const prompt = await context.assemble({ kind: 'nosuch' });
    expect(prompt).toContain('## 本次触发\n[触发]');
  });
});

describe('exemplar rotation consumes the mapping', () => {
  // With a fresh cursor the first exemplar shown is the top-ranked beat for
  // the kind — proves the new entries steer the rotation, not just exist.
  async function firstExemplarSituation(kind) {
    db.state.prefs = {};
    const prompt = await context.assemble({ kind });
    const section = prompt.slice(prompt.indexOf('## 口播示范'));
    const m = /- 情境：(.+?)｜她注意到/.exec(section);
    return m && m[1];
  }

  it('first-run leads with a cold_open exemplar', async () => {
    const situation = await firstExemplarSituation('first-run');
    const coldOpens = bible.links.filter((l) => l.beat === 'cold_open').map((l) => l.situation);
    expect(coldOpens).toContain(situation);
  });

  it('feedback leads with a silence exemplar', async () => {
    const situation = await firstExemplarSituation('feedback');
    const silences = bible.links.filter((l) => l.beat === 'silence').map((l) => l.situation);
    expect(silences).toContain(situation);
  });
});
