import { describe, it, expect } from 'vitest';
import { toAction, extractJson, normalizeAction } from '../server/brain/parse.js';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"say":"hi","play":[]}')).toEqual({ say: 'hi', play: [] });
  });

  it('digs a JSON object out of surrounding prose', () => {
    expect(extractJson('sure! {"say":"hi"} done')).toEqual({ say: 'hi' });
  });

  it('returns null when there is no JSON', () => {
    expect(extractJson('just talking')).toBeNull();
  });
});

describe('normalizeAction', () => {
  it('coerces play strings into {query, reason}', () => {
    const a = normalizeAction({ say: 'x', play: ['周杰伦 - 晴天', 'Adele - Hello'] });
    expect(a.play).toEqual([
      { query: '周杰伦 - 晴天', reason: '' },
      { query: 'Adele - Hello', reason: '' },
    ]);
  });

  it('drops play entries with no query', () => {
    const a = normalizeAction({ play: [{ reason: 'nope' }, { query: 'ok' }] });
    expect(a.play).toEqual([{ query: 'ok', reason: '' }]);
  });

  it('keeps only whitelisted intent / placement values', () => {
    expect(normalizeAction({ intent: 'enqueue', placement: 'next' })).toMatchObject({ intent: 'enqueue', placement: 'next' });
    expect(normalizeAction({ intent: 'bogus', placement: 'sideways' })).toMatchObject({ intent: '', placement: '' });
  });

  it('lifts an action accidentally nested inside say', () => {
    const a = normalizeAction({ say: '{"say":"inner","play":[{"query":"q"}]}' });
    expect(a.say).toBe('inner');
    expect(a.play).toEqual([{ query: 'q', reason: '' }]);
  });
});

describe('toAction', () => {
  it('unwraps a fenced ```json block', () => {
    const a = toAction('```json\n{"say":"hey","play":[{"query":"a - b","reason":"r"}]}\n```');
    expect(a.say).toBe('hey');
    expect(a.play).toEqual([{ query: 'a - b', reason: 'r' }]);
  });

  it('falls back to plain patter when the reply is not JSON', () => {
    const a = toAction('就放点轻松的吧');
    expect(a.say).toBe('就放点轻松的吧');
    expect(a.play).toEqual([]);
  });
});
