import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SegmentAlignment, Word } from '@nsh/contracts';
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
    // Reconstruct the word population computeBaseline should be using: a word
    // inside some alignment's [wordIdxStart, wordIdxEnd) span is charged to
    // that alignment's own duration; a word left uncovered by every alignment
    // (a real ASR seam the aligner couldn't pin to a segment) still happened
    // in voiced time, so it's charged its own [start, end) span instead.
    const covered = new Array<boolean>(words.length).fill(false);
    for (const a of alignments) {
      for (let i = a.wordIdxStart; i < a.wordIdxEnd; i++) covered[i] = true;
    }
    let voiced = alignments.reduce((s, a) => s + (a.endSec - a.startSec), 0);
    let content = alignments.reduce(
      (s, a) => s + words.slice(a.wordIdxStart, a.wordIdxEnd).filter((w) => !w.isFiller).length,
      0,
    );
    words.forEach((w, i) => {
      if (covered[i]) return;
      voiced += w.end - w.start;
      if (!w.isFiller) content++;
    });
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
    // Synthetic scenario, decoupled from the fixture: the degraded segment
    // claims a DISTINCT word range (indices 2-3) with a large duration and
    // real content — reusing an already-counted range (as the previous
    // version of this test did) can't distinguish "excluded" from "ignored
    // because nothing changed". If those words leaked into the numerator
    // without their duration, pace would jump from 200 to ~400 wpm.
    const synthWords: Word[] = [
      { text: 'hello', start: 0, end: 0.3, confidence: 1, isFiller: false },
      { text: 'world', start: 0.3, end: 0.6, confidence: 1, isFiller: false },
      { text: 'slow', start: 100, end: 100.5, confidence: 1, isFiller: false },
      { text: 'stretch', start: 100.5, end: 105.5, confidence: 1, isFiller: false },
    ];
    const usableSeg: SegmentAlignment = {
      segmentId: 'seg-a', startSec: 0, endSec: 0.6, wordIdxStart: 0, wordIdxEnd: 2,
      wpm: 200, fillerCount: 0, meanRms: 0, meanF0: null, precedingPauseSec: 0, degraded: false,
    };
    const degradedSeg: SegmentAlignment = {
      segmentId: 'seg-b', startSec: 100, endSec: 105.5, wordIdxStart: 2, wordIdxEnd: 4,
      wpm: 9999, fillerCount: 0, meanRms: 0, meanF0: null, precedingPauseSec: 99.4, degraded: true,
    };

    const withoutDegraded = computeBaseline([usableSeg], synthWords.slice(0, 2), empty);
    const withDegraded = computeBaseline([usableSeg, degradedSeg], synthWords, empty);

    expect(withDegraded.avgPaceWpm).toBeCloseTo(withoutDegraded.avgPaceWpm, 1);
    expect(withDegraded.avgPaceWpm).toBe(200);
  });

  it('survives a single-segment recording', () => {
    const one = computeBaseline([alignments[0]!], words, empty);
    expect(one.paceStdDev).toBe(0);
  });
});
