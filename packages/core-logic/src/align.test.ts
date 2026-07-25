import { describe, expect, it } from 'vitest';
import { needlemanWunsch } from './align.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoachError } from './errors.js';
import { alignSegments } from './align.js';
import { parseScript } from './parse-script.js';

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

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const demoScript = readFileSync(join(fixtures, 'script.demo.md'), 'utf8');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));

/** Same 1-decimal rounding the implementation uses, so wpm can be asserted exactly. */
const r1 = (n: number) => Math.round(n * 10) / 10;

describe('alignSegments', () => {
  const segments = parseScript(demoScript);
  const result = alignSegments(rough, segments);

  it('returns one alignment per segment, in order', () => {
    expect(result.alignments.map((a) => a.segmentId)).toEqual(segments.map((s) => s.id));
  });

  it('matches most of the script', () => {
    expect(result.matchRate).toBeGreaterThan(0.75);
  });

  it('produces monotonically increasing, non-overlapping spans', () => {
    const a = result.alignments;
    for (let i = 1; i < a.length; i++) {
      expect(a[i]!.startSec).toBeGreaterThanOrEqual(a[i - 1]!.endSec);
    }
  });

  it('keeps every span inside the recording', () => {
    for (const a of result.alignments) {
      expect(a.startSec).toBeGreaterThanOrEqual(0);
      expect(a.endSec).toBeLessThanOrEqual(rough.durationSec);
      expect(a.endSec).toBeGreaterThan(a.startSec);
    }
  });

  it('degrades no segment on a good take', () => {
    expect(result.alignments.every((a) => !a.degraded)).toBe(true);
    expect(result.alignments.filter((a) => a.degraded)).toHaveLength(0);
  });

  it('finds the rushed key point — seg-003 is the fastest segment', () => {
    const byWpm = [...result.alignments].sort((x, y) => y.wpm - x.wpm);
    expect(byWpm[0]!.segmentId).toBe('seg-003');
  });

  it('does NOT treat "like" in seg-006 as a filler', () => {
    // script.demo.md:11 — "I'd like to talk about ... look like".
    const seg6 = result.alignments.find((a) => a.segmentId === 'seg-006')!;
    expect(seg6.fillerCount).toBe(0);
  });

  it('tags hard fillers spoken in seg-002', () => {
    const seg2 = result.alignments.find((a) => a.segmentId === 'seg-002')!;
    expect(seg2.fillerCount).toBeGreaterThan(0);
  });

  it('computes precedingPauseSec from the previous segment end', () => {
    const a = result.alignments;
    expect(a[0]!.precedingPauseSec).toBeCloseTo(a[0]!.startSec, 5);
    for (let i = 1; i < a.length; i++) {
      expect(a[i]!.precedingPauseSec).toBeCloseTo(a[i]!.startSec - a[i - 1]!.endSec, 5);
    }
  });

  it('excludes fillers from wpm', () => {
    // Derive the expected value from the PUBLIC outputs rather than a hand-guess:
    // count the non-filler words the alignment attributed to seg-002, and use the
    // segment's own rounded startSec/endSec. The implementation computes wpm from
    // those same rounded fields, so the equality is exact, not approximate.
    const seg2 = result.alignments.find((a) => a.segmentId === 'seg-002')!;
    const n = result.words.slice(seg2.wordIdxStart, seg2.wordIdxEnd).filter((w) => !w.isFiller).length;
    expect(seg2.wpm).toBe(r1((n / (seg2.endSec - seg2.startSec)) * 60));
  });

  it('throws ALIGNMENT_FAILED when the audio is not this script', () => {
    const wrong = parseScript('completely unrelated words about marine biology\n\nand tidal patterns');
    try {
      alignSegments(rough, wrong);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CoachError);
      expect((e as CoachError).code).toBe('ALIGNMENT_FAILED');
    }
  });
});
