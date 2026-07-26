import {
  CONTRACT_VERSION,
  type CorrelationResult, type DeliveryReport, type DeliverySignal, type ScriptSegment,
} from '../contracts/index.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function generateSummary(
  segments: ScriptSegment[],
  correlation: CorrelationResult,
  signal: DeliverySignal,
  meta: { reportId: string; audioUrl: string | null },
): DeliveryReport {
  const alignmentById = new Map(correlation.alignments.map((a) => [a.segmentId, a]));
  const stampedSegments = segments.map((segment) => {
    const a = alignmentById.get(segment.id);
    if (!a || a.degraded) return { ...segment };
    return { ...segment, startSec: a.startSec, endSec: a.endSec };
  });

  return {
    reportId: meta.reportId,
    contractVersion: CONTRACT_VERSION,
    segments: stampedSegments,
    issues: correlation.issues,
    // Counted from issues rather than from raw filler words, so the number in
    // the summary card always matches the ticks the widget can actually show.
    fillerCount: correlation.issues.filter((i) => i.type === 'filler').length,
    avgPaceWpm: r1(correlation.baseline.avgPaceWpm),
    durationSec: r1(signal.transcript.durationSec),
    audioUrl: meta.audioUrl,
    status: 'ready',
    nextStep: null,
  };
}
