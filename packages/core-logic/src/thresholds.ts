import type { Severity } from '@nsh/contracts';
import { CoachError } from './errors.js';

/** Tuned against the locked demo recordings. Task 12 revisits these. */
export const THRESHOLDS = {
  /** A gap longer than this between words counts as a pause, in seconds. */
  pauseMinSec: 0.35,
  /**
   * A key-point segment whose WPM is at least this fraction above the speaker's
   * own baseline is rushed. Percent-above-baseline, not a sigma band.
   *
   * Task 7 used `avgPaceWpm + 0.4σ`, but paceStdDev was polluted: seg-006's
   * 313 WPM over a 2.3s span inflated it to ~71.8, so a sigma multiplier was
   * chosen to compensate for the outlier rather than to express a real spread —
   * statistically meaningless (Task 7 review, carried into Task 9). Two guards
   * fix the root cause: baseline.ts now drops sub-minPaceVerdictSec spans from
   * the stddev population, and this rule no longer touches stddev at all.
   *
   * Measured: rough baseline avg 143.9 WPM -> ceiling 172.7. seg-005's genuine
   * 180 WPM rush (the red tick) clears it; seg-003 at 150 WPM (honours its
   * marked pause) stays clean. Clean baseline avg 146.6 -> ceiling 175.9, above
   * both clean key points (135.5, 134.1), so the clean take fires no stress.
   */
  stressRushPct: 0.2,
  /**
   * An ordinary (non-key) segment whose WPM deviates from baseline by more than
   * this fraction, in EITHER direction, is a pacing drift. Two-sided: a slow,
   * rambling open is as coachable as a fast line. Percent, not sigma — the same
   * reasoning as stressRushPct; with the outlier removed the cleaned stddev is
   * legitimate but a bare multiplier is far less legible than a percent band.
   *
   * Measured at 0.10: rough (avg 143.9) flags seg-001 (-34.5%), seg-002
   * (-25.7%) and seg-004 (+29.7%); clean (avg 146.6) flags seg-001 (-23.7%)
   * and seg-002 (+11.6%). seg-004 clean (+5.9%) stays inside the band.
   * pacing.drift is always low-severity, so this never threatens the
   * "clean take all low" invariant regardless of how many it flags.
   */
  pacingDriftPct: 0.1,
  /**
   * A segment shorter than this (rounded span, seconds) cannot produce a
   * trustworthy pace verdict — WPM over a ~2-3s window is dominated by a single
   * breath. The pacing rule skips such segments, AND baseline.ts drops them
   * from the stddev population. seg-006's end-blurt (313 WPM over 2.3s rough /
   * 218 WPM over 3.3s clean) must not fire pacing in either take.
   */
  minPaceVerdictSec: 4,
  /** Fillers in one segment beyond this count escalate low -> medium. */
  fillerDensityPerSegment: 2,
  /** A marked pause honoured at less than this fraction of median is skipped. */
  markedPauseHonouredRatio: 0.5,
  /** Relative f0 rise across a key-point line that reads as uncertainty. */
  risingPitchRatio: 1.12,
  /** Below this overall alignment match rate, the audio is not this script. */
  minMatchRate: 0.4,
  /** Recordings shorter than this cannot be analysed. */
  minAudioSec: 5,
} as const;

/**
 * The severity table. Each rule names the TWO signals it cross-references —
 * a rule reading one signal is a lint check, not a correlation, and is `low`
 * by construction. `DecisionTrace.rule` carries these ids to Ops Canvas.
 */
export const SEVERITY_RULES: ReadonlyArray<{
  id: string;
  type: string;
  signals: [string, string];
  verdict: Severity;
  why: string;
}> = [
  {
    id: 'stress.key-point-rushed',
    type: 'stress_mismatch',
    signals: ['script.isKeyPoint', 'delivery.wpm vs baseline'],
    verdict: 'high',
    why: 'Rushing the line the script marks as the key claim undermines the claim itself.',
  },
  {
    id: 'stress.key-point-rising-pitch',
    type: 'stress_mismatch',
    signals: ['script.isKeyPoint', 'delivery.f0 slope'],
    verdict: 'high',
    why: 'Rising pitch on a stated fact delivers it as a question.',
  },
  {
    id: 'pause.marked-not-honoured',
    type: 'pause',
    signals: ['script.markedPause', 'delivery.precedingPauseSec'],
    verdict: 'medium',
    why: 'A planned beat that was skipped — the setup for the next line lands flat.',
  },
  {
    id: 'filler.in-key-point',
    type: 'filler',
    signals: ['script.isKeyPoint', 'delivery.fillerCount'],
    verdict: 'medium',
    why: 'A hedge immediately before a key claim reads as doubt about the claim.',
  },
  {
    id: 'filler.density',
    type: 'filler',
    signals: ['delivery.fillerCount', 'segment.wordCount'],
    verdict: 'medium',
    why: 'Density, not any single filler, is what an audience notices.',
  },
  {
    id: 'filler.isolated',
    type: 'filler',
    signals: ['delivery.fillerCount', 'script.isKeyPoint'],
    verdict: 'low',
    why: 'A filler on a low-stakes transition. Worth noting, not worth fixing.',
  },
  {
    id: 'pacing.drift',
    type: 'pacing',
    signals: ['delivery.wpm', 'baseline.avgPaceWpm'],
    verdict: 'low',
    why: 'Drift away from a key point. Informational.',
  },
];

export function ruleById(id: string) {
  const rule = SEVERITY_RULES.find((r) => r.id === id);
  // An unknown rule id is a programming error, not a user-facing one, but it
  // still must not surface as a raw Error across the tool boundary (Global
  // Constraint #5). Throw a typed CoachError with the INTERNAL code.
  if (!rule) throw new CoachError('INTERNAL', `unknown severity rule: ${id}`);
  return rule;
}
