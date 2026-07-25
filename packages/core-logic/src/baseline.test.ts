import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignSegments } from './align.js';
import { computeBaseline } from './baseline.js';
import { parseScript } from './parse-script.js';

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));
const segments = parseScript(readFileSync(join(fixtures, 'script.demo.md'), 'utf8'));
const empty = { frames: [], frameHopSec: 0.01 };

describe('computeBaseline', () => {
  const { alignments, words } = alignSegments(rough, segments);
  const baseline = computeBaseline(alignments, words, empty);

  it('produces a plausible speaking pace', () => {
    expect(baseline.avgPaceWpm).toBeGreaterThan(90);
    expect(baseline.avgPaceWpm).toBeLessThan(200);
  });

  it('divides by voiced time, not wall-clock', () => {
    // Wall-clock includes inter-segment silence, which would drag pace down.
    const voiced = alignments.reduce((s, a) => s + (a.endSec - a.startSec), 0);
    const content = words.filter((w) => !w.isFiller).length;
    expect(baseline.avgPaceWpm).toBeCloseTo(Math.round(((content / voiced) * 60) * 10) / 10, 0);
  });

  it('reports a non-zero pace spread', () => {
    expect(baseline.paceStdDev).toBeGreaterThan(0);
  });

  it('finds a median pause', () => {
    expect(baseline.medianPauseSec).toBeGreaterThan(0.35);
  });

  it('returns null f0 when prosody has no frames', () => {
    expect(baseline.medianF0).toBeNull();
  });

  it('excludes degraded segments from the pace average', () => {
    const withDegraded = [...alignments, {
      ...alignments[0]!, segmentId: 'seg-999', degraded: true, wpm: 9999,
    }];
    const after = computeBaseline(withDegraded, words, empty);
    expect(after.avgPaceWpm).toBeCloseTo(baseline.avgPaceWpm, 1);
  });

  it('survives a single-segment recording', () => {
    const one = computeBaseline([alignments[0]!], words, empty);
    expect(one.paceStdDev).toBe(0);
  });
});
