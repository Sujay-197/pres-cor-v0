// apps/server/src/tools/correlate-segments.tool.ts
//
// alignSegments, then correlateSegments. It does NOT call computeBaseline:
// correlateSegments computes the baseline internally and returns it on
// CorrelationResult.baseline (design §6).

import { z } from 'zod';
import {
  CorrelationResult,
  DeliverySignal,
  ScriptSegment,
} from '@nsh/contracts';
import { alignSegments, correlateSegments } from '@nsh/core-logic';

export const CorrelateSegmentsInput = z.object({
  signal: DeliverySignal,
  segments: z.array(ScriptSegment),
});
export type CorrelateSegmentsInput = z.infer<typeof CorrelateSegmentsInput>;

export const CorrelateSegmentsOutput = CorrelationResult;

export function correlateSegmentsTool(input: CorrelateSegmentsInput): CorrelationResult {
  const { signal, segments } = CorrelateSegmentsInput.parse(input);
  const alignment = alignSegments(signal.transcript, segments, signal.prosody);
  return correlateSegments(signal, segments, alignment);
}
