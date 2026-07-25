/**
 * @nsh/core-logic — P1's territory.
 *
 * Every export here is a pure function implementing one signature from the
 * `CoreLogic` interface in @nsh/contracts. No network, no fs, no Date.now(),
 * no Math.random(), and no NitroStack import — ever. See CONVENTIONS.md §1.
 *
 * The stubs below exist so P2 can scaffold @Tool shells against real symbols
 * from hour 1, and so the merge at h4-6 is a body swap rather than a rebuild.
 */

import type {
  Baseline,
  CorrelationResult,
  DeliveryReport,
  DeliverySignal,
  NextStep,
  NextStepContext,
  ProsodyTrack,
  ScriptSegment,
  SegmentAlignment,
  Severity,
  Transcript,
} from '@nsh/contracts';

export * from './errors.js';

/* ------------------------------------------------------------------------ *
 * Tunables. One table, edited during rehearsal — never inline magic numbers.
 * CONVENTIONS.md §4 and §5.
 * ------------------------------------------------------------------------ */

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
} as const;

/**
 * The severity table. Each rule names the TWO signals it cross-references —
 * a rule reading only one signal is a lint check, not a correlation, and is
 * `low` by construction. `DecisionTrace.rule` carries these ids to Ops Canvas.
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

/* ------------------------------------------------------------------------ *
 * The six frozen signatures. Bodies land h1-6 — see docs/TEAM_PLANS.md.
 * ------------------------------------------------------------------------ */

const PENDING = 'not implemented yet — see docs/TEAM_PLANS.md (P1)';

/** tool 1: parse_script */
export function parseScript(_raw: string): ScriptSegment[] {
  throw new Error(`parseScript: ${PENDING}`);
}

/** tool 2b: deterministic half of transcribe_delivery. Pure DSP. */
export function extractProsody(_pcm: Float32Array, _sampleRate: number): ProsodyTrack {
  throw new Error(`extractProsody: ${PENDING}`);
}

/** tool 3a: map each script segment onto its region of the recording. */
export function alignSegments(
  _transcript: Transcript,
  _segments: ScriptSegment[],
): SegmentAlignment[] {
  throw new Error(`alignSegments: ${PENDING}`);
}

/** tool 3b: THE BRANCH. Cross-references script intent against delivery signal. */
export function correlateSegments(
  _signal: DeliverySignal,
  _segments: ScriptSegment[],
  _alignments: SegmentAlignment[],
): CorrelationResult {
  throw new Error(`correlateSegments: ${PENDING}`);
}

/** tool 4: generate_summary */
export function generateSummary(
  _segments: ScriptSegment[],
  _correlation: CorrelationResult,
  _signal: DeliverySignal,
  _meta: { reportId: string; audioUrl: string | null },
): DeliveryReport {
  throw new Error(`generateSummary: ${PENDING}`);
}

/** tool 5: decides the closing action. Never executes it — that is P2's job. */
export function decideNextStep(_report: DeliveryReport, _ctx: NextStepContext): NextStep {
  throw new Error(`decideNextStep: ${PENDING}`);
}

/** Speaker's own norms from this recording. Never a population average. */
export function computeBaseline(_alignments: SegmentAlignment[]): Baseline {
  throw new Error(`computeBaseline: ${PENDING}`);
}
