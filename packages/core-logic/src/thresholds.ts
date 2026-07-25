import type { Severity } from '@nsh/contracts';
import { CoachError } from './errors.js';

/** Tuned against the locked demo recordings. Task 12 revisits these. */
export const THRESHOLDS = {
  /** A gap longer than this between words counts as a pause, in seconds. */
  pauseMinSec: 0.35,
  /**
   * Pace beyond baseline ± this many standard deviations is drift.
   * Lowered from 1.5 to 0.4 (Task 7): seg-006's short-span 313 WPM end-blurt
   * inflates paceStdDev to ~71.8, pushing the rush ceiling at 1.5σ to ~252 WPM
   * — unreachable by seg-005's genuine 180 WPM rush on a ~143.9 WPM baseline.
   * At 0.4σ the ceiling is ~172.6 WPM: seg-005 (180 WPM) clears it, seg-003
   * (150 WPM, honours its marked pause) stays clean. Task 9's duration guard
   * keeps that same short-span outlier out of the pacing verdicts so this
   * tighter band doesn't have to compensate for it forever.
   */
  paceDriftSigma: 0.4,
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
