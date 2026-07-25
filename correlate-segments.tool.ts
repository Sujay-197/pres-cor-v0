// apps/server/src/tools/correlate-segments.tool.ts
//
// THE BRANCH TOOL. SPEC §3/§7: this is the visible severity decision the
// judge watches on Ops Canvas. Your job here is almost entirely
// pass-through — the actual severity logic (SEVERITY_RULES table) is
// core-logic, per CONVENTIONS §5, precisely so it's auditable outside a
// @Tool body. Resist the urge to add any branching in this file.

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DeliveryIssueSchema, ScriptSegmentSchema } from '../contracts-stub';
// import { alignSegments, correlateSegments } from '@nsh/core-logic'; // merge

const InputSchema = z.object({
  transcript: z.unknown(),  // Tier-2 shape from transcribe_delivery output
  segments: z.array(ScriptSegmentSchema),
});

const OutputSchema = z.object({
  issues: z.array(DeliveryIssueSchema),
  trace: z.unknown(),   // DecisionTrace — this is what Ops Canvas renders,
                          // don't strip it out even though it's not user-facing
  baseline: z.unknown(),
});

@Injectable()
export class CorrelateSegmentsTool {
  // @Tool({
  //   name: 'correlate_segments',
  //   description:
  //     'Align delivery timestamps to script segments, flag filler ' +
  //     'density, pacing drift, and stress-point mismatches. Decides ' +
  //     'severity per issue by cross-referencing script vs delivery.',
  //   inputSchema: InputSchema,
  //   outputSchema: OutputSchema,
  // })
  async execute(input: z.infer<typeof InputSchema>): Promise<z.infer<typeof OutputSchema>> {
    void input;
    // MERGE POINT:
    //   const alignment = alignSegments(input.transcript, input.segments);
    //   return correlateSegments(alignment, input.segments);
    //
    // ALIGNMENT_FAILED is the CoachError code to map here if alignSegments
    // can't reconcile transcript to script at all (CONVENTIONS §6).
    //
    // Confirm at h6 (not h20, per TEAM_PLANS "five things that would sink
    // this build" #5) that `trace` actually renders in Ops Canvas once
    // real output flows through — this is the single most-scored visible
    // moment in the whole demo.
    throw new Error('pending merge');
  }
}
