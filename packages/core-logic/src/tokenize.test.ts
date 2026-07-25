import { describe, expect, it } from 'vitest';
import { fillerMatchLength, isHardFiller, isSoftFiller, normaliseText, tagHardFillers } from './tokenize.js';

describe('normaliseText', () => {
  it('lowercases, strips punctuation, splits on whitespace', () => {
    expect(normaliseText('Good morning. I am Sujay!')).toEqual(['good', 'morning', 'i', 'am', 'sujay']);
  });

  it('splits hyphenated words so script and transcript agree', () => {
    // Script says "ninety-eight"; Deepgram (smart_format=false) says "ninety eight".
    expect(normaliseText('ninety-eight percent')).toEqual(normaliseText('ninety eight percent'));
  });

  it('returns an empty array for whitespace only', () => {
    expect(normaliseText('   \n  ')).toEqual([]);
  });

  it('keeps digits', () => {
    expect(normaliseText('98% match')).toEqual(['98', 'match']);
  });
});

describe('filler classification', () => {
  it('treats uh and um as hard fillers', () => {
    expect(isHardFiller('uh')).toBe(true);
    expect(isHardFiller('um')).toBe(true);
  });

  it('does not treat like as a hard filler', () => {
    // "I'd like to talk about..." — script.demo.md:11 uses it legitimately.
    expect(isHardFiller('like')).toBe(false);
  });

  it('matches two-word soft fillers as bigrams', () => {
    expect(isSoftFiller(['you', 'know', 'what'], 0)).toBe(2);
    expect(isSoftFiller(['i', 'mean', 'it'], 0)).toBe(2);
  });

  it('matches single-word soft fillers', () => {
    expect(isSoftFiller(['basically', 'we'], 0)).toBe(1);
  });

  it('returns 0 for ordinary words', () => {
    expect(isSoftFiller(['reconcile', 'inventory'], 0)).toBe(0);
  });

  it('prefers the longer bigram over the unigram', () => {
    // "know" alone is not a filler; "you know" is. Bigram must win.
    expect(fillerMatchLength(['you', 'know'], 0)).toBe(2);
  });
});

describe('tagHardFillers', () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.2, confidence: 0.9, isFiller: false });

  it('flags hard fillers and leaves soft ones alone', () => {
    const out = tagHardFillers([w('um', 0), w('like', 1), w('reconcile', 2)]);
    expect(out.map((x) => x.isFiller)).toEqual([true, false, false]);
  });

  it('does not mutate its input', () => {
    const input = [w('um', 0)];
    tagHardFillers(input);
    expect(input[0]!.isFiller).toBe(false);
  });
});
