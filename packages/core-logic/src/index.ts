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
} from '@nsh/contracts';

export * from './align.js';
export * from './errors.js';
export * from './next-step.js';
export * from './parse-script.js';
export * from './thresholds.js';
export * from './tokenize.js';

/* ------------------------------------------------------------------------ *
 * The six frozen signatures. Bodies land h1-6 — see docs/TEAM_PLANS.md.
 * ------------------------------------------------------------------------ */

const PENDING = 'not implemented yet — see docs/TEAM_PLANS.md (P1)';

/** tool 2b: deterministic half of transcribe_delivery. Pure DSP. */
export function extractProsody(_pcm: Float32Array, _sampleRate: number): ProsodyTrack {
  throw new Error(`extractProsody: ${PENDING}`);
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

/** Speaker's own norms from this recording. Never a population average. */
export function computeBaseline(_alignments: SegmentAlignment[]): Baseline {
  throw new Error(`computeBaseline: ${PENDING}`);
}
