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
