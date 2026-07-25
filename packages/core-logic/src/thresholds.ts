import type { Severity } from '@nsh/contracts';

/** Tuned against the locked demo recordings. Task 12 revisits these. */
export const THRESHOLDS = {
  /** A gap longer than this between words counts as a pause, in seconds. */
  pauseMinSec: 0.35,
  /** Pace beyond baseline ± this many standard deviations is drift. */
  paceDriftSigma: 1.5,
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
  if (!rule) throw new Error(`unknown severity rule: ${id}`);
  return rule;
}
