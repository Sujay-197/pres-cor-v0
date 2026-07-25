// apps/server/src/tools/generate-summary.tool.ts

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DeliveryReportSchema, DeliveryIssueSchema, ScriptSegmentSchema } from '../contracts-stub';
// import { generateSummary } from '@nsh/core-logic'; // merge

const InputSchema = z.object({
  segments: z.array(ScriptSegmentSchema),
  issues: z.array(DeliveryIssueSchema),
  baseline: z.unknown(),
  audioUrl: z.string(),
  durationSec: z.number(),
});

const OutputSchema = DeliveryReportSchema;

@Injectable()
export class GenerateSummaryTool {
  // @Tool({
  //   name: 'generate_summary',
  //   description:
  //     'Assemble the structured DeliveryReport: issues grouped by type, ' +
  //     'each tied to its script line, plus filler count and avg pace.',
  //   inputSchema: InputSchema,
  //   outputSchema: OutputSchema,
  // })
  async execute(input: z.infer<typeof InputSchema>): Promise<z.infer<typeof OutputSchema>> {
    void input;
    // MERGE POINT: return generateSummary(input.segments, input.issues, ...);
    //
    // Reminder for review at merge, not something to fix here:
    // CONVENTIONS §3 — issue IDs (iss-NNN) must be assigned AFTER sorting
    // by timestamp, inside generateSummary. If you ever see iss-NNN not
    // matching timestamp order in a fixture, that's a core-logic bug, not
    // a tool-shell bug — don't patch it here.
    throw new Error('pending merge');
  }
}
