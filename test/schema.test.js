import { describe, it, expect } from 'vitest';
import { normalizeRadioAction, validateRadioAction } from '../server/agent/schema.js';

describe('normalizeRadioAction', () => {
  it('trims and caps string fields', () => {
    const action = normalizeRadioAction({
      say: '  hello  ',
      segue: 'next up',
      reason: 'mood match',
      intent: 'enqueue',
      placement: 'next',
      play: [{ query: '  jazz  ', title: 'Take Five', artist: 'Dave Brubeck' }],
    });
    expect(action.say).toBe('hello');
    expect(action.intent).toBe('enqueue');
    expect(action.play).toHaveLength(1);
    expect(action.play[0].query).toBe('jazz');
  });

  it('drops empty play entries', () => {
    const action = normalizeRadioAction({ play: [{ query: '' }, { title: 'A' }] });
    expect(action.play).toHaveLength(1);
    expect(action.play[0].title).toBe('A');
  });

  it('defaults invalid intent and placement', () => {
    const action = normalizeRadioAction({ intent: 'bogus', placement: 'bogus' });
    expect(action.intent).toBe('');
    expect(action.placement).toBe('next');
  });
});

describe('validateRadioAction', () => {
  it('accepts a normalized action', () => {
    const { ok, errors } = validateRadioAction({ intent: 'enqueue', say: 'hi' });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });
});
