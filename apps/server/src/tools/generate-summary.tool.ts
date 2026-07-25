// apps/server/src/tools/generate-summary.tool.ts

import { z } from 'zod';
import {
  CorrelationResult,
  DeliveryReport,
  DeliverySignal,
  ScriptSegment,
} from '@nsh/contracts';
import { generateSummary } from '@nsh/core-logic';

export const GenerateSummaryInput = z.object({
  segments: z.array(ScriptSegment),
  correlation: CorrelationResult,
  signal: DeliverySignal,
  meta: z.object({
    reportId: z.string().min(1),
    audioUrl: z.string().nullable(),
  }),
});
export type GenerateSummaryInput = z.infer<typeof GenerateSummaryInput>;

export const GenerateSummaryOutput = DeliveryReport;

export function generateSummaryTool(input: GenerateSummaryInput): DeliveryReport {
  const { segments, correlation, signal, meta } = GenerateSummaryInput.parse(input);
  return generateSummary(segments, correlation, signal, meta);
}
