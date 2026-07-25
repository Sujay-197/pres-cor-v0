import { z } from 'zod';

// ── Tier-1: frozen at hour 1. Crosses widget + host boundary. ──────────────

export const CONTRACT_VERSION = '1.0.0';

export type IssueType = 'filler' | 'pacing' | 'stress_mismatch' | 'pause';
export const IssueTypeSchema = z.enum(['filler', 'pacing', 'stress_mismatch', 'pause']);

export type Severity = 'low' | 'medium' | 'high';
export const SeveritySchema = z.enum(['low', 'medium', 'high']);

// SEVERITY_COLOR — shared by widget + deck. Widget imports these; no hand-picked hexes in widget code.
export const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#22C55E',    // green-500
  medium: '#F59E0B', // amber-500
  high: '#EF4444',   // red-500
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  filler: 'Filler word',
  pacing: 'Pacing drift',
  stress_mismatch: 'Stress / emphasis mismatch',
  pause: 'Pause',
};

export const AUDIO_URL_SCHEMES = ['http:', 'https:', 'blob:', 'data:'] as const;
export function isAllowedAudioUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url);
    if (!AUDIO_URL_SCHEMES.includes(u.protocol as typeof AUDIO_URL_SCHEMES[number])) return false;
    if (u.protocol === 'data:') {
      const rest = u.pathname.slice(0, 32).toLowerCase();
      return rest.startsWith('audio/') || rest.startsWith('video/') || rest.startsWith('application/octet-stream');
    }
    return true;
  } catch {
    return false;
  }
}
export const AudioUrlSchema = z.string().refine(isAllowedAudioUrl, {
  message: 'audioUrl must be an absolute path (/...) or use http(s): / blob: / data:audio|video|octet-stream scheme',
});

export const IsoDateSchema = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s),
  { message: 'eventIsoDate must be an ISO-8601 date-time string (YYYY-MM-DDThh:mm:ss...)' },
);

export type ScriptSegment = {
  id: string;           // seg-NNN, source order
  text: string;         // markup stripped (no ** or [pause])
  isKeyPoint: boolean;  // from **bold** in source
  markedPause: boolean; // from [pause] marker
  startSec?: number;    // approximate alignment start (seconds, optional)
  endSec?: number;      // approximate alignment end (seconds, optional)
};
export const ScriptSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  isKeyPoint: z.boolean(),
  markedPause: z.boolean(),
  startSec: z.number().optional(),
  endSec: z.number().optional(),
});

export type DeliveryIssue = {
  id: string;           // iss-NNN, ascending timestamp order (assigned AFTER sort)
  type: IssueType;
  severity: Severity;
  timestamp: number;    // seconds into recording, float
  segmentId: string;    // links to ScriptSegment.id
  detail: string;       // e.g. "180 WPM vs your 130 WPM average"
  rule?: string;        // severity rule name (for Ops Canvas trace, optional)
};
export const DeliveryIssueSchema = z.object({
  id: z.string(),
  type: IssueTypeSchema,
  severity: SeveritySchema,
  timestamp: z.number(),
  segmentId: z.string(),
  detail: z.string(),
  rule: z.string().optional(),
});

// NextStep — suggest_next_step output (two branches)
export const NextStepCalendarSchema = z.object({
  type: z.literal('calendar_reminder'),
  eventTitle: z.string(),
  eventIsoDate: IsoDateSchema,
  leadMinutes: z.number(),          // e.g. 30 = surface report 30 min before
  message: z.string(),              // display text
  executed: z.boolean(),            // always false from decideNextStep, P2 flips on execute
  eventId: z.string().optional(),
});
export type NextStepCalendar = z.infer<typeof NextStepCalendarSchema>;

export const NextStepDraftNoteSchema = z.object({
  type: z.literal('draft_note'),
  recipient: z.string().email(),            // email
  subject: z.string(),
  bodyPreview: z.string(),          // first ~80 chars for widget preview
  fullBody: z.string(),             // full draft text
  executed: z.boolean(),            // always false from decideNextStep
  message: z.string(),              // display text
});
export type NextStepDraftNote = z.infer<typeof NextStepDraftNoteSchema>;

export type NextStep = NextStepCalendar | NextStepDraftNote;
export const NextStepSchema = z.discriminatedUnion('type', [
  NextStepCalendarSchema,
  NextStepDraftNoteSchema,
]);

export type DeliveryReportStatus = 'analyzing' | 'ready';
export const DeliveryReportStatusSchema = z.enum(['analyzing', 'ready']);

// Tier-1 DeliveryReport — the widget contract.
// Tier-1 amendments (all accepted at hour-1 gate with rationale):
//   durationSec    — widget needs total duration to position ticks as % (not optional)
//   audioUrl       — widget's <audio> element needs a src (not optional)
//   nextStep       — closing action is part of the hero card, not a side channel
//   reportId       — demo determinism: same reportId = same IDs for rehearsed clicks
//   contractVersion — fail-fast on mismatch
export const DeliveryReportSchema = z.object({
  reportId: z.string(),
  contractVersion: z.literal(CONTRACT_VERSION),
  durationSec: z.number(),
  audioUrl: AudioUrlSchema,
  segments: z.array(ScriptSegmentSchema),
  issues: z.array(DeliveryIssueSchema),
  fillerCount: z.number(),
  avgPaceWpm: z.number(),
  status: DeliveryReportStatusSchema,
  nextStep: NextStepSchema.optional(),
});
export type DeliveryReport = z.infer<typeof DeliveryReportSchema>;

// ── Tier-2: P1 ↔ P2 seam only. Never leaves server. No ceremony on change. ──

export type Word = {
  text: string;
  startSec: number;
  endSec: number;
  isFiller: boolean;
  confidence?: number;
};
export const WordSchema = z.object({
  text: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  isFiller: z.boolean(),
  confidence: z.number().optional(),
});

export type Transcript = {
  words: Word[];
  durationSec: number;
};

export type ProsodyTrack = {
  rmsDbBySec: number[];   // RMS amplitude per 0.1s bucket (volume proxy)
  f0HzBySec: number[];    // Fundamental frequency per 0.1s bucket (pitch). NaN = unvoiced.
  bucketSec: number;      // e.g. 0.1
};

export type SegmentAlignment = {
  segmentId: string;
  wordStartIdx: number;
  wordEndIdx: number;     // exclusive
  confidence: number;
};

export type Baseline = {
  avgWpm: number;         // content-words only, voiced-time denominator
  wpmStddev: number;
  medianGapSec: number;   // median inter-word gap (for pause checks)
  avgF0Hz: number;        // mean f0 over voiced segments
  f0StddevHz: number;
};

export type DecisionTrace = {
  issueId: string;
  rule: string;           // which SEVERITY_RULES entry fired
  signals: Record<string, unknown>;  // the two (or more) cross-referenced values
  severity: Severity;
};

export type CorrelationResult = {
  issues: DeliveryIssue[];
  trace: DecisionTrace[]; // the Ops Canvas-readable story
  baseline: Baseline;
};

export type NextStepContext = {
  now: string;            // ISO string. Core logic never reads Date.now().
  upcomingEvents: Array<{ id: string; title: string; isoDate: string }>;
  mentorContact?: { name: string; email: string };
};

// ── CoreLogic interface — the P1/P2 seam. Frozen at hour-1 gate. ───────────
// Signatures match what P1 exports (plain TS) and what P2 calls from @Tool bodies.

export interface CoreLogic {
  parseScript(raw: string): ScriptSegment[];
  alignSegments(transcript: Transcript, segments: ScriptSegment[]): SegmentAlignment[];
  correlateSegments(
    transcript: Transcript,
    segments: ScriptSegment[],
    alignments: SegmentAlignment[],
    prosody: ProsodyTrack | null,
  ): CorrelationResult;
  extractProsody(pcm: Float32Array, sampleRate: number): ProsodyTrack;
  generateSummary(
    segments: ScriptSegment[],
    correlation: CorrelationResult,
    durationSec: number,
    audioUrl: string,
    reportId: string,
  ): DeliveryReport;
  decideNextStep(report: DeliveryReport, ctx: NextStepContext): NextStep;
}

// ── Shared constants ───────────────────────────────────────────────────────

// FILLER_LEXICON — used identically by STT adapter + core logic filler counting.
// (Vendors flag some fillers; we catch the rest.)
export const FILLER_LEXICON: ReadonlySet<string> = new Set([
  'uh', 'um', 'ah', 'er', 'hm', 'hmm',
  'like', 'you know', 'sort of', 'kind of', 'i mean',
  'so', 'actually', 'basically', 'literally',
  'right', 'okay', 'alright',
  'eh', 'mm', 'emm', 'ahh', 'uhh', 'umm',
]);

// Thresholds (CONVENTIONS §4) — settled once, identical everywhere.
export const THRESHOLDS = {
  PAUSE_GAP_SEC: 0.35,           // > 0.35s between words = a pause
  WPM_STRESS_SIGMA: 1.5,         // key-point WPM > baseline + 1.5σ = stress mismatch
  FILLER_DENSITY_MEDIUM: 2,      // ≥2 fillers per segment = medium
} as const;
