import type { Baseline, ProsodyTrack, SegmentAlignment, Word } from '@nsh/contracts';
import { THRESHOLDS } from './thresholds.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * The speaker's own norms, from THIS recording only — never a population
 * average. Every severity verdict is relative to this, which is what makes the
 * flags falsifiable rather than a vibe score (SPEC §2).
 */
export function computeBaseline(
  alignments: SegmentAlignment[],
  words: Word[],
  prosody: ProsodyTrack,
): Baseline {
  // Degraded segments would drag the baseline toward a pace the speaker never
  // produced, since their span came from a proportional guess.
  const usable = alignments.filter((a) => !a.degraded);

  const voicedSec = usable.reduce((sum, a) => sum + (a.endSec - a.startSec), 0);
  // Global non-filler word count, not a sum of per-segment slices: real ASR
  // alignment leaves small gaps between consecutive segment spans (a word the
  // aligner could not pin to either neighbour). Those words were still spoken
  // in voiced time, so excluding them would understate the speaker's pace.
  const contentWords = words.filter((w) => !w.isFiller).length;
  const avgPaceWpm = voicedSec > 0 ? (contentWords / voicedSec) * 60 : 0;

  const paces = usable.map((a) => a.wpm);
  const mean = paces.length > 0 ? paces.reduce((s, p) => s + p, 0) / paces.length : 0;
  const variance =
    paces.length > 0 ? paces.reduce((s, p) => s + (p - mean) ** 2, 0) / paces.length : 0;

  // Inter-WORD gaps, not inter-segment: six segments are too few for a stable
  // median, and the pause rule needs a trustworthy one.
  const gaps: number[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.start - words[i - 1]!.end;
    if (gap > THRESHOLDS.pauseMinSec) gaps.push(gap);
  }

  const voicedF0 = prosody.frames
    .map((f) => f.f0)
    .filter((f): f is number => f !== null && f > 0);

  const rmsValues = usable.map((a) => a.meanRms);
  const medianPause = median(gaps);

  return {
    avgPaceWpm: r1(avgPaceWpm),
    paceStdDev: r1(Math.sqrt(variance)),
    meanRms: r1(rmsValues.length > 0 ? rmsValues.reduce((s, v) => s + v, 0) / rmsValues.length : 0),
    medianF0: voicedF0.length > 0 ? r1(median(voicedF0) ?? 0) : null,
    medianPauseSec: medianPause === null ? null : r1(medianPause),
  };
}
