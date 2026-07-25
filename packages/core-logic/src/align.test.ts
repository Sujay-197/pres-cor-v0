import { describe, expect, it } from 'vitest';
import { needlemanWunsch } from './align.js';

const ops = (a: string[], b: string[]) => needlemanWunsch(a, b).map((p) => p.op);

describe('needlemanWunsch', () => {
  it('matches identical sequences', () => {
    expect(ops(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(['match', 'match', 'match']);
  });

  it('detects an insertion in the transcript as gapScript', () => {
    // Speaker said "um" that is not in the script.
    expect(ops(['a', 'b'], ['a', 'um', 'b'])).toEqual(['match', 'gapScript', 'match']);
  });

  it('detects a dropped script word as gapTranscript', () => {
    expect(ops(['a', 'b', 'c'], ['a', 'c'])).toEqual(['match', 'gapTranscript', 'match']);
  });

  it('detects a substitution as mismatch', () => {
    expect(ops(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual(['match', 'mismatch', 'match']);
  });

  it('maps indices on both sides for matches', () => {
    const pairs = needlemanWunsch(['a', 'b'], ['a', 'um', 'b']);
    const matched = pairs.filter((p) => p.op === 'match');
    expect(matched).toEqual([
      { scriptIdx: 0, transcriptIdx: 0, op: 'match' },
      { scriptIdx: 1, transcriptIdx: 2, op: 'match' },
    ]);
  });

  it('leaves the absent side null on gaps', () => {
    const gap = needlemanWunsch(['a'], ['a', 'um']).find((p) => p.op === 'gapScript')!;
    expect(gap.scriptIdx).toBeNull();
    expect(gap.transcriptIdx).toBe(1);
  });

  it('handles an empty script side', () => {
    expect(ops([], ['a', 'b'])).toEqual(['gapScript', 'gapScript']);
  });

  it('handles an empty transcript side', () => {
    expect(ops(['a', 'b'], [])).toEqual(['gapTranscript', 'gapTranscript']);
  });

  it('returns nothing for two empty sequences', () => {
    expect(needlemanWunsch([], [])).toEqual([]);
  });

  it('stays monotonic — indices never move backwards', () => {
    const pairs = needlemanWunsch(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    const sIdx = pairs.map((p) => p.scriptIdx).filter((i): i is number => i !== null);
    const tIdx = pairs.map((p) => p.transcriptIdx).filter((i): i is number => i !== null);
    expect(sIdx).toEqual([...sIdx].sort((x, y) => x - y));
    expect(tIdx).toEqual([...tIdx].sort((x, y) => x - y));
  });

  it('handles a realistic run within a few milliseconds', () => {
    const a = Array.from({ length: 450 }, (_, i) => `w${i}`);
    const b = Array.from({ length: 500 }, (_, i) => `w${i}`);
    const t0 = performance.now();
    needlemanWunsch(a, b);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
