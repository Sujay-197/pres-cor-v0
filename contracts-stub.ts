// apps/server/src/contracts-stub.ts
//
// TEMPORARY. Delete this file the moment packages/contracts/src/index.ts
// exists and import from '@nsh/contracts' everywhere below instead.
//
// This exists only so the five tool shells are individually compilable
// and reviewable *before* the hour-1 gate closes. Do not extend this file
// as if it were the real contract — the real one needs full-team sign-off
// per CONVENTIONS §2, this one doesn't and shouldn't.

import { z } from 'zod';

export type IssueType = 'filler' | 'pacing' | 'stress_mismatch' | 'pause';
export type Severity = 'low' | 'medium' | 'high';

export const ScriptSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  isKeyPoint: z.boolean(),
  markedPause: z.boolean(),
});
export type ScriptSegment = z.infer<typeof ScriptSegmentSchema>;

export const DeliveryIssueSchema = z.object({
  id: z.string(),
  type: z.enum(['filler', 'pacing', 'stress_mismatch', 'pause']),
  severity: z.enum(['low', 'medium', 'high']),
  timestamp: z.number(), // seconds, float — CONVENTIONS §3, never ms
  segmentId: z.string(),
  detail: z.string(),
});
export type DeliveryIssue = z.infer<typeof DeliveryIssueSchema>;

// Tier-1 amendments from TEAM_PLANS.md hour-1 gate item 1:
// durationSec, audioUrl, nextStep, reportId + contractVersion.
export const NextStepSchema = z.object({
  kind: z.enum(['calendar_reminder', 'draft_note']),
  executed: z.boolean(), // core-logic always emits false; P2 flips it true
  detail: z.string(),
});
export type NextStep = z.infer<typeof NextStepSchema>;

export const DeliveryReportSchema = z.object({
  reportId: z.string(),
  contractVersion: z.string(),
  segments: z.array(ScriptSegmentSchema),
  issues: z.array(DeliveryIssueSchema),
  fillerCount: z.number(),
  avgPaceWpm: z.number(),
  durationSec: z.number(),
  audioUrl: z.string(),
  nextStep: NextStepSchema.nullable(),
  status: z.enum(['analyzing', 'ready']),
});
export type DeliveryReport = z.infer<typeof DeliveryReportSchema>;

// Tier-2 shapes (P1<->P2 seam only, never leaves the server) — stubbed
// loosely since P2 doesn't own these, just needs something to type against.
export interface Word {
  text: string;
  startSec: number;
  endSec: number;
  isFiller: boolean;
}
export interface Transcript {
  words: Word[];
}
export interface ProsodyTrack {
  // RMS envelope + f0 by segment — real shape owned by P1, TODO confirm at
  // hour 1 alongside the CoreLogic signatures.
  samples: unknown;
}
export interface CorrelationResult {
  issues: DeliveryIssue[];
  trace: unknown;   // DecisionTrace — what Ops Canvas renders, CONVENTIONS §5
  baseline: unknown;
}
export interface NextStepContext {
  now: number; // seconds since epoch, passed in — never Date.now() inside core-logic
  upcomingEvents: unknown[];
}
