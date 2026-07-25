import type { AlignmentResult, ProsodyTrack, ScriptSegment, SegmentAlignment, Transcript } from '@nsh/contracts';
import { CoachError } from './errors.js';
import { THRESHOLDS } from './thresholds.js';
import { isHardFiller, isSoftFiller, normaliseText } from './tokenize.js';

// AlignmentResult now lives in @nsh/contracts (Tier-2, added in Step 1). Re-export
// it here so consumers that import it from './align.js' (Task 7's correlate.ts)
// keep resolving against a single source of truth.
export type { AlignmentResult } from '@nsh/contracts';

export type AlignOp = 'match' | 'mismatch' | 'gapScript' | 'gapTranscript';

export interface AlignPair {
  /** Index into the script token array, or null when the script had no word here. */
  scriptIdx: number | null;
  /** Index into the transcript token array, or null when nothing was spoken here. */
  transcriptIdx: number | null;
  op: AlignOp;
}

const SCORING = { match: 2, mismatch: -1, gap: -1 } as const;

/**
 * Global sequence alignment (Needleman-Wunsch) between script tokens and
 * transcript tokens.
 *
 * Handles the three things ASR does to us as first-class cases: insertions
 * (fillers the script never had), deletions (words skipped on the day) and
 * substitutions (words misheard). The matrix is bounded by AUDIO_MAX_SECONDS
 * at roughly 450 x 500 cells, so no banding or heuristic pruning is needed.
 */
export function needlemanWunsch(script: string[], transcript: string[]): AlignPair[] {
  const n = script.length;
  const m = transcript.length;
  const width = m + 1;

  // Flat Float64Array rather than nested arrays: no per-row allocation, and it
  // sidesteps noUncheckedIndexedAccess noise on every cell read.
  const dp = new Float64Array((n + 1) * width);
  for (let i = 1; i <= n; i++) dp[i * width] = i * SCORING.gap;
  for (let j = 1; j <= m; j++) dp[j] = j * SCORING.gap;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = script[i - 1] === transcript[j - 1];
      const diag = dp[(i - 1) * width + (j - 1)]! + (same ? SCORING.match : SCORING.mismatch);
      const up = dp[(i - 1) * width + j]! + SCORING.gap;
      const left = dp[i * width + (j - 1)]! + SCORING.gap;
      dp[i * width + j] = Math.max(diag, up, left);
    }
  }

  const out: AlignPair[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = script[i - 1] === transcript[j - 1];
      const score = same ? SCORING.match : SCORING.mismatch;
      if (dp[i * width + j] === dp[(i - 1) * width + (j - 1)]! + score) {
        out.push({ scriptIdx: i - 1, transcriptIdx: j - 1, op: same ? 'match' : 'mismatch' });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i * width + j] === dp[(i - 1) * width + j]! + SCORING.gap) {
      out.push({ scriptIdx: i - 1, transcriptIdx: null, op: 'gapTranscript' });
      i--;
      continue;
    }
    out.push({ scriptIdx: null, transcriptIdx: j - 1, op: 'gapScript' });
    j--;
  }

  return out.reverse();
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function alignSegments(
  transcript: Transcript,
  segments: ScriptSegment[],
  prosody: ProsodyTrack = { frames: [], frameHopSec: 0.01 },
): AlignmentResult {
  // --- script side: flatten to tokens, remembering which segment owns each ---
  const scriptTokens: string[] = [];
  const tokenSegment: number[] = [];
  segments.forEach((seg, segIdx) => {
    for (const tok of normaliseText(seg.text)) {
      scriptTokens.push(tok);
      tokenSegment.push(segIdx);
    }
  });

  // --- transcript side: normalise, drop hard fillers from the aligner input ---
  // A hard filler never appears in a script, so feeding it to the aligner only
  // adds gap-path noise. Soft fillers DO enter alignment — that is how we learn
  // whether "like" was a script word or a tic.
  const words = transcript.words.map((w) => ({ ...w }));
  const normalised = words.map((w) => normaliseText(w.text)[0] ?? '');

  const alignTokens: string[] = [];
  const alignToWordIdx: number[] = [];
  normalised.forEach((tok, wordIdx) => {
    if (tok.length === 0) return;
    if (isHardFiller(tok)) {
      words[wordIdx]!.isFiller = true;
      return;
    }
    alignTokens.push(tok);
    alignToWordIdx.push(wordIdx);
  });

  const pairs = needlemanWunsch(scriptTokens, alignTokens);

  const matches = pairs.filter((p) => p.op === 'match');
  const matchRate = scriptTokens.length === 0 ? 0 : matches.length / scriptTokens.length;
  if (matchRate < THRESHOLDS.minMatchRate) {
    throw new CoachError('ALIGNMENT_FAILED', 'Recording does not match this script.', {
      matchRate: r1(matchRate * 100),
    });
  }

  // --- resolve soft fillers: in the lexicon AND unmatched by any script token ---
  // A soft-filler bigram ("you know") is ONE hedge spanning TWO words. Tag every
  // constituent word, not just the matched index — otherwise "know" stays a
  // content word, inflating that segment's WPM and contradicting the "two words,
  // one hedge" rationale the filler rules depend on (Task 9).
  for (const pair of pairs) {
    if (pair.op !== 'gapScript' || pair.transcriptIdx === null) continue;
    const wordIdx = alignToWordIdx[pair.transcriptIdx];
    if (wordIdx === undefined) continue;
    const matchLen = isSoftFiller(normalised, wordIdx);
    for (let k = 0; k < matchLen; k++) {
      const w = words[wordIdx + k];
      if (w) w.isFiller = true;
    }
  }

  // --- per-segment spans from first and last matched token ---
  const spans = segments.map(() => ({ first: Number.POSITIVE_INFINITY, last: -1 }));
  for (const pair of matches) {
    if (pair.scriptIdx === null || pair.transcriptIdx === null) continue;
    const segIdx = tokenSegment[pair.scriptIdx];
    if (segIdx === undefined) continue;
    const wordIdx = alignToWordIdx[pair.transcriptIdx];
    if (wordIdx === undefined) continue;
    const span = spans[segIdx]!;
    span.first = Math.min(span.first, wordIdx);
    span.last = Math.max(span.last, wordIdx);
  }

  const alignments: SegmentAlignment[] = [];
  let prevEnd = 0; // the PREVIOUS segment's rounded endSec

  segments.forEach((seg, segIdx) => {
    const span = spans[segIdx]!;
    const degraded = span.last < 0;

    let wordIdxStart: number;
    let wordIdxEnd: number;
    if (degraded) {
      // Proportional fallback for THIS segment only. It reports a span so the
      // timeline stays continuous, and sets degraded so correlate suppresses
      // its pacing and stress verdicts rather than emitting flat ones.
      const share = segments.length === 0 ? 0 : words.length / segments.length;
      wordIdxStart = Math.min(Math.floor(share * segIdx), Math.max(words.length - 1, 0));
      wordIdxEnd = Math.min(Math.ceil(share * (segIdx + 1)), words.length);
    } else {
      wordIdxStart = span.first;
      wordIdxEnd = span.last + 1;
    }

    const startWord = words[wordIdxStart];
    const endWord = words[Math.max(wordIdxEnd - 1, wordIdxStart)];
    const rawStart = startWord?.start ?? prevEnd;
    const rawEnd = Math.max(endWord?.end ?? rawStart + 0.1, rawStart + 0.1);

    // Round FIRST, then derive every downstream number from the stored rounded
    // fields. r1(a) - r1(b) is not r1(a - b), so computing precedingPauseSec and
    // wpm from the unrounded values would break invariants asserted on the public
    // startSec/endSec fields. Deriving from the rounded fields makes both
    // "precedingPauseSec == startSec - previous endSec" and the wpm formula hold
    // exactly against those fields (Findings 2 & 4).
    const startSec = r1(rawStart);
    const endSec = r1(rawEnd);
    const duration = endSec - startSec;

    const inRange = words.slice(wordIdxStart, wordIdxEnd);
    const contentWords = inRange.filter((w) => !w.isFiller).length;
    const fillerCount = inRange.filter((w) => w.isFiller).length;

    const inWindow = prosody.frames.filter((f) => f.t >= startSec && f.t < endSec);
    const voiced = inWindow.map((f) => f.f0).filter((f): f is number => f !== null);
    const meanRms = inWindow.length > 0
      ? inWindow.reduce((s, f) => s + f.rms, 0) / inWindow.length : 0;
    const meanF0 = voiced.length > 0
      ? voiced.reduce((s, f) => s + f, 0) / voiced.length : null;

    alignments.push({
      segmentId: seg.id,
      startSec,
      endSec,
      wordIdxStart,
      wordIdxEnd,
      wpm: r1(duration > 0 ? (contentWords / duration) * 60 : 0),
      fillerCount,
      meanRms: r1(meanRms),
      meanF0: meanF0 === null ? null : r1(meanF0),
      precedingPauseSec: r1(Math.max(startSec - prevEnd, 0)),
      degraded,
    });

    prevEnd = endSec; // rounded, so the next segment's precedingPauseSec is exact
  });

  return { alignments, words, matchRate };
}
