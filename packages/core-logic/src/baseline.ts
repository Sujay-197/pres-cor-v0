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
  // produced, since their span came from a proportional guess. Their claimed
  // word range is excluded from BOTH the numerator and the denominator below
  // — counting the words without their time (or vice versa) would inflate or
  // deflate WPM by construction, not by anything the speaker actually did.
  const usable = alignments.filter((a) => !a.degraded);

  // Numerator and denominator must walk the same word population. Two pools
  // feed both: (1) words claimed by a usable segment's [wordIdxStart,
  // wordIdxEnd) span, using that segment's own duration; (2) "seam" words —
  // spoken but claimed by NO segment at all, usable or degraded — a real ASR
  // alignment gap the Needleman-Wunsch pass couldn't pin to either neighbour.
  // Seam words still happened in voiced time, so they're counted with their
  // own [start, end) duration. Words claimed only by a DEGRADED segment fall
  // into neither pool and are dropped entirely, per the comment above.
  const claimed = new Set<number>();
  for (const a of alignments) {
    for (let i = a.wordIdxStart; i < a.wordIdxEnd; i++) claimed.add(i);
  }

  let seamVoicedSec = 0;
  let seamContentWords = 0;
  words.forEach((w, i) => {
    if (claimed.has(i)) return; // covered by some segment — usable or degraded
    seamVoicedSec += Math.max(w.end - w.start, 0);
    if (!w.isFiller) seamContentWords++;
  });

  const usableVoicedSec = usable.reduce((sum, a) => sum + (a.endSec - a.startSec), 0);
  const usableContentWords = usable.reduce(
    (sum, a) => sum + words.slice(a.wordIdxStart, a.wordIdxEnd).filter((w) => !w.isFiller).length,
    0,
  );

  const voicedSec = usableVoicedSec + seamVoicedSec;
  const contentWords = usableContentWords + seamContentWords;
  const avgPaceWpm = voicedSec > 0 ? (contentWords / voicedSec) * 60 : 0;

  // The stddev population excludes segments too short to give a trustworthy pace
  // — the same guard the pacing rule applies. seg-006's 313 WPM over a 2.3s span
  // (rough) is one breath, not a pace; leaving it in inflated paceStdDev to ~71.8
  // and made any sigma-based band statistically meaningless (Task 7 review). The
  // voiced-time / contentWords totals above KEEP these segments (they are
  // population-aligned per Task 6), so avgPaceWpm is unaffected — only the spread
  // is cleaned. Rough drops to ~37.4, clean to ~18.1.
  const paces = usable
    .filter((a) => r1(a.endSec - a.startSec) >= THRESHOLDS.minPaceVerdictSec)
    .map((a) => a.wpm);
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
  const medianF0 = median(voicedF0);

  return {
    avgPaceWpm: r1(avgPaceWpm),
    paceStdDev: r1(Math.sqrt(variance)),
    meanRms: r1(rmsValues.length > 0 ? rmsValues.reduce((s, v) => s + v, 0) / rmsValues.length : 0),
    medianF0: medianF0 === null ? null : r1(medianF0),
    medianPauseSec: medianPause === null ? null : r1(medianPause),
  };
}
