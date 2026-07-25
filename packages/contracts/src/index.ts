/**
 * THE CONTRACT — single source of truth for all four workstreams.
 *
 * TIER 1 (frozen at hour 1): crosses the wire into the widget and the host.
 *   Changing anything in Tier 1 needs all four of us to sign off, and a
 *   CONTRACT_VERSION bump. See CONVENTIONS.md "Changing the contract".
 *
 * TIER 2 (internal seam): P1 <-> P2 only, never leaves the server.
 *   Change it with a heads-up in chat, no ceremony. It exists so P1 can build
 *   and test the logic with zero NitroStack dependency.
 *
 * This package has exactly one runtime dependency (zod) so it can be imported
 * from the server, the widget, and the logic library without dragging anything
 * along. Do not add imports here.
 */

import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0';

/* ------------------------------------------------------------------------ *
 * TIER 1 — FROZEN. Rendered by the widget, returned to the host.
 * ------------------------------------------------------------------------ */

export const IssueType = z.enum(['filler', 'pacing', 'stress_mismatch', 'pause']);
export type IssueType = z.infer<typeof IssueType>;

export const Severity = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof Severity>;

/** One chunk of the user's script. Produced by parseScript(). */
export const ScriptSegment = z.object({
  /** Deterministic: "seg-001", "seg-002". Stable across reruns of the same script. */
  id: z.string(),
  /** Segment text with markup tokens stripped. This is what the widget displays. */
  text: z.string(),
  /** Author marked this as the key claim/stat of the section (**bold** in source). */
  isKeyPoint: z.boolean(),
  /** Author explicitly planned a pause here ([pause] in source). */
  markedPause: z.boolean(),
});
export type ScriptSegment = z.infer<typeof ScriptSegment>;

/** One flagged deviation between what was planned and what was delivered. */
export const DeliveryIssue = z.object({
  /** Deterministic: "iss-001", assigned in ascending timestamp order. */
  id: z.string(),
  type: IssueType,
  severity: Severity,
  /** Seconds into the recording. Float. Never milliseconds — see CONVENTIONS.md. */
  timestamp: z.number(),
  /** Links back to ScriptSegment.id. */
  segmentId: z.string(),
  /** Human-readable, specific, falsifiable. e.g. "180 WPM vs your 130 WPM average". */
  detail: z.string(),
});
export type DeliveryIssue = z.infer<typeof DeliveryIssue>;

/**
 * The closing agentic action. Output of suggest_next_step.
 *
 * `executed` is the important field: false means we PROPOSED an action and are
 * waiting for the user to confirm; true means the connector actually fired.
 * The widget renders a button when false and a receipt when true. Never send a
 * real email or write a real calendar entry with executed pre-set to true.
 */
export const NextStep = z.object({
  kind: z.enum(['calendar_reminder', 'draft_note', 'none']),
  /** Why the agent chose this branch. Shown to the user, logged to the audit trail. */
  rationale: z.string(),
  executed: z.boolean(),
  /** calendar_reminder only. */
  eventTitle: z.string().nullable().default(null),
  /** calendar_reminder only. ISO 8601 string. */
  eventStartsAt: z.string().nullable().default(null),
  /** draft_note only. Who we suggest they ask to watch the next attempt. */
  recipientHint: z.string().nullable().default(null),
  /** draft_note only. */
  draftSubject: z.string().nullable().default(null),
  /** draft_note only. */
  draftBody: z.string().nullable().default(null),
});
export type NextStep = z.infer<typeof NextStep>;

/**
 * The full payload the widget renders. Output of generate_summary.
 *
 * NOTE — four fields here are additions to SPEC.md section 5, flagged for
 * sign-off at kickoff. Rationale for each:
 *   durationSec  — the timeline scrubber cannot lay out ticks without it.
 *   audioUrl     — the scrubber has nothing to play without it.
 *   nextStep     — SPEC section 6 puts the suggest_next_step action on the
 *                  summary card, so it has to reach the widget somehow.
 *   reportId /
 *   contractVersion — lets the audit interceptor correlate log lines to a run,
 *                  and makes a widget/server version skew loud instead of silent.
 * Everything else is exactly as frozen in SPEC.md.
 */
export const DeliveryReport = z.object({
  reportId: z.string(),
  contractVersion: z.string(),
  segments: z.array(ScriptSegment),
  issues: z.array(DeliveryIssue),
  fillerCount: z.number().int(),
  avgPaceWpm: z.number(),
  durationSec: z.number(),
  audioUrl: z.string().nullable(),
  status: z.enum(['analyzing', 'ready']),
  nextStep: NextStep.nullable(),
});
export type DeliveryReport = z.infer<typeof DeliveryReport>;

/* ------------------------------------------------------------------------ *
 * TIER 2 — INTERNAL SEAM. P1 writes these, P2 consumes them. Never shipped.
 * ------------------------------------------------------------------------ */

/** One word from the STT provider, normalised across vendors. */
export const Word = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
  /** Set by the STT adapter using FILLER_LEXICON, not by the vendor. */
  isFiller: z.boolean(),
});
export type Word = z.infer<typeof Word>;

/** Vendor-neutral transcript. Every SttClient must produce exactly this. */
export const Transcript = z.object({
  words: z.array(Word),
  durationSec: z.number(),
  /** "deepgram" | "assemblyai" | "fixture" — recorded in the audit log. */
  provider: z.string(),
});
export type Transcript = z.infer<typeof Transcript>;

/** One analysis frame of the audio signal. Hop is ProsodyTrack.frameHopSec. */
export const ProsodyFrame = z.object({
  /** Seconds into the recording at frame start. */
  t: z.number(),
  /** Root-mean-square energy, normalised 0..1 against the loudest frame. */
  rms: z.number(),
  /** Fundamental frequency in Hz, or null when the frame is unvoiced/silent. */
  f0: z.number().nullable(),
});
export type ProsodyFrame = z.infer<typeof ProsodyFrame>;

export const ProsodyTrack = z.object({
  frames: z.array(ProsodyFrame),
  frameHopSec: z.number(),
});
export type ProsodyTrack = z.infer<typeof ProsodyTrack>;

/** Everything transcribe_delivery knows about the recording. */
export const DeliverySignal = z.object({
  transcript: Transcript,
  prosody: ProsodyTrack,
});
export type DeliverySignal = z.infer<typeof DeliverySignal>;

/** One script segment mapped onto the region of audio that delivered it. */
export const SegmentAlignment = z.object({
  segmentId: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  /** Indices into Transcript.words, inclusive start / exclusive end. */
  wordIdxStart: z.number().int(),
  wordIdxEnd: z.number().int(),
  wpm: z.number(),
  fillerCount: z.number().int(),
  meanRms: z.number(),
  /** null when the segment had no voiced frames. */
  meanF0: z.number().nullable(),
  /** Silence between the previous segment's last word and this one's first. */
  precedingPauseSec: z.number(),
  /**
   * True when this segment matched no script tokens and fell back to a
   * proportional span. A degraded segment suppresses its own pacing and
   * stress verdicts — proportional splitting assumes uniform WPM in order
   * to measure WPM deviation, so feeding it the pacing rules would report a
   * clean delivery rather than a broken one.
   */
  degraded: z.boolean(),
});
export type SegmentAlignment = z.infer<typeof SegmentAlignment>;

/**
 * Return of alignSegments. `words` carries `isFiller` finalised after
 * soft-filler resolution, so the caller gets the updated words rather than a
 * bare SegmentAlignment[]. Tier-2 (P1<->P2 seam), never shipped to the widget.
 */
export const AlignmentResult = z.object({
  alignments: z.array(SegmentAlignment),
  words: z.array(Word),
  /** Matched script tokens / total script tokens. Below 0.4 alignSegments throws. */
  matchRate: z.number(),
});
export type AlignmentResult = z.infer<typeof AlignmentResult>;

/**
 * The speaker's own norms, computed from THIS recording — never a population
 * average. Every severity verdict is relative to the speaker's own baseline,
 * which is what makes the flags falsifiable rather than a vibe score.
 */
export const Baseline = z.object({
  avgPaceWpm: z.number(),
  /** Standard deviation of per-segment WPM. Drives the pacing thresholds. */
  paceStdDev: z.number(),
  meanRms: z.number(),
  medianF0: z.number().nullable(),
});
export type Baseline = z.infer<typeof Baseline>;

/**
 * One severity decision, emitted alongside every issue.
 *
 * This is the Ops Canvas payload — differentiation checklist item #1 is "visible
 * branch point", and this struct IS that visibility. A judge reads the trace and
 * can check the verdict against the script themselves.
 */
export const DecisionTrace = z.object({
  issueId: z.string(),
  segmentId: z.string(),
  /** Which rule in SEVERITY_RULES fired. */
  rule: z.string(),
  /** The two signals being cross-referenced, as measured. */
  observed: z.record(z.string(), z.number()),
  /** What the script said should happen here. */
  scriptExpectation: z.string(),
  verdict: Severity,
  /** One sentence: why these two signals together produce this severity. */
  reasoning: z.string(),
});
export type DecisionTrace = z.infer<typeof DecisionTrace>;

/** Return of correlateSegments — issues plus the trace that justifies them. */
export const CorrelationResult = z.object({
  issues: z.array(DeliveryIssue),
  trace: z.array(DecisionTrace),
  baseline: Baseline,
});
export type CorrelationResult = z.infer<typeof CorrelationResult>;

/** Ambient facts decideNextStep() branches on. P2 fills this from connectors. */
export const NextStepContext = z.object({
  /** Upcoming calendar events, soonest first. Empty when none/no connector. */
  upcomingEvents: z.array(
    z.object({
      title: z.string(),
      startsAt: z.string(),
    }),
  ),
  /** A name the user has previously rehearsed with, if we know one. */
  knownMentor: z.string().nullable(),
  /** ISO 8601. Injected, never Date.now(), so tests and demos are deterministic. */
  now: z.string(),
});
export type NextStepContext = z.infer<typeof NextStepContext>;

/* ------------------------------------------------------------------------ *
 * SHARED CONSTANTS — one definition, used by logic, server, and widget.
 * ------------------------------------------------------------------------ */

/**
 * Words counted as fillers. Deepgram returns "uh"/"um" natively with
 * filler_words=true; the rest we tag ourselves in the STT adapter so the
 * behaviour is identical no matter which provider is configured.
 */
export const FILLER_LEXICON: readonly string[] = [
  'uh', 'um', 'mm', 'mhmm', 'hmm', 'er', 'ah',
  'like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'actually', 'right',
];

/** Widget tick colours. Defined once here so P3 and the deck cannot drift. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

/** Script markup understood by parseScript(). See CONVENTIONS.md. */
export const SCRIPT_MARKUP = {
  /** Segments are separated by a blank line. */
  segmentDelimiter: /\n\s*\n/,
  /** **bold** anywhere in a segment marks it as the key point. */
  keyPoint: /\*\*(.+?)\*\*/g,
  /** [pause] anywhere in a segment marks a planned pause. Stripped from text. */
  pause: /\[pause\]/gi,
} as const;

/* ------------------------------------------------------------------------ *
 * FROZEN FUNCTION SIGNATURES — the P1 <-> P2 seam.
 *
 * P1 implements these in @nsh/core-logic as pure functions.
 * P2 scaffolds @Tool shells whose bodies are one call into them.
 * At the merge point (h4-6) these line up by construction, because both sides
 * were written against the types below rather than against each other.
 *
 * Pure means: no I/O, no Date.now(), no Math.random(), no network. Anything
 * ambient arrives as an argument. This is what makes the demo deterministic.
 * ------------------------------------------------------------------------ */

export interface CoreLogic {
  /** tool 1: parse_script */
  parseScript(raw: string): ScriptSegment[];

  /** tool 2b: the deterministic half of transcribe_delivery. Pure DSP. */
  extractProsody(pcm: Float32Array, sampleRate: number): ProsodyTrack;

  /** tool 3a: map each script segment onto its region of the recording. */
  alignSegments(transcript: Transcript, segments: ScriptSegment[]): AlignmentResult;

  /** tool 3b: THE BRANCH. Cross-reference script intent against delivery signal. */
  correlateSegments(
    signal: DeliverySignal,
    segments: ScriptSegment[],
    alignment: AlignmentResult,
  ): CorrelationResult;

  /** tool 4: generate_summary */
  generateSummary(
    segments: ScriptSegment[],
    correlation: CorrelationResult,
    signal: DeliverySignal,
    meta: { reportId: string; audioUrl: string | null },
  ): DeliveryReport;

  /** tool 5: the decision half of suggest_next_step. Chooses; does not execute. */
  decideNextStep(report: DeliveryReport, ctx: NextStepContext): NextStep;
}

/**
 * tool 2a: the ONLY impure thing in the system.
 *
 * P2 implements this against a vendor SDK; P1 implements a fixture-backed one
 * for tests. Selected by env var STT_PROVIDER so the vendor stays swappable per
 * ARCHITECTURE_BRIEF section 3.
 */
export interface SttClient {
  readonly provider: string;
  /**
   * Uint8Array rather than Node's Buffer on purpose: this package is imported
   * by the browser widget too, and must not pull in @types/node. A Node Buffer
   * is a Uint8Array, so P2 can pass one straight in.
   */
  transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript>;
}
