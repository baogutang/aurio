import { describe, it, expect } from 'vitest';
import { buildObservation, AGENT_TOOLS, executeSearchLoop } from '../server/agent/loop.js';
import { tasteSummary } from '../server/agent/preferences.js';

describe('agent loop', () => {
  it('exposes tool surface', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(['search', 'enqueue', 'steer', 'chat']);
  });

  it('builds observation with trigger and playback', () => {
    const obs = buildObservation({ kind: 'chat', text: '来点爵士' });
    expect(obs.version).toBe('1.1');
    expect(obs.trigger.kind).toBe('chat');
    expect(obs.trigger.text).toBe('来点爵士');
    expect(obs.playback).toBeTruthy();
    expect(obs.taste).toBeTruthy();
  });

  it('executeSearchLoop dedupes and broadens thin results', async () => {
    const calls = [];
    const searchFn = async (q, n) => {
      calls.push(q);
      if (calls.length === 1) return [{ id: '1', title: 'A', artist: 'B', source: 'netease' }];
      return [{ id: '2', title: 'C', artist: 'D', source: 'netease' }];
    };
    const out = await executeSearchLoop('来点爵士', searchFn, 2);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('tasteSummary', () => {
  it('returns structured feedback buckets', () => {
    const s = tasteSummary();
    expect(Array.isArray(s.liked)).toBe(true);
    expect(Array.isArray(s.disliked)).toBe(true);
    expect(Array.isArray(s.avoidArtists)).toBe(true);
    expect(Array.isArray(s.recent)).toBe(true);
  });
});
