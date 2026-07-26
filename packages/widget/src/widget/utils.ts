import type { DeliveryIssue, ScriptSegment, Severity } from '@nsh/contracts';
import { SEVERITY_COLOR } from '@nsh/contracts';

export const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function getSegmentById(segments: ScriptSegment[], id: string): ScriptSegment | undefined {
  return segments.find(s => s.id === id);
}

export function sortTopIssues(issues: DeliveryIssue[]): DeliveryIssue[] {
  return [...issues].sort((a, b) => {
    const bySev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySev !== 0) return bySev;
    return a.timestamp - b.timestamp;
  });
}

export function computePaceVariancePm(issues: DeliveryIssue[], avgWpm: number): number {
  if (!issues.length) return 0;
  const deltas: number[] = [];
  for (const iss of issues) {
    if (iss.type !== 'pacing') continue;
    const match = /(\d+)\s*WPM/.exec(iss.detail);
    if (match) deltas.push(Math.abs(Number(match[1]) - avgWpm));
  }
  if (!deltas.length) {
    const fillersDeviate = issues.length >= 3 ? 6 : 2;
    return fillersDeviate;
  }
  return Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
}

export type TickLayout = {
  issue: DeliveryIssue;
  lane: number;            // 0 = baseline (above playhead), 1 = +22px up, 2 = +44px up, …
  clusterSize: number;     // how many ticks share this cluster slot (1 = solo)
  clusterMembers: string[];// ids in cluster, sorted
};

const OVERLAP_WINDOW_SEC = 0.5;

/**
 * Deterministic overlap resolution, in two independent passes over the
 * timestamp-sorted issues:
 *
 * 1. Cluster: chain issues whose timestamps are within OVERLAP_WINDOW_SEC of
 *    their neighbour (transitive — a run of 3+ overlapping ticks is one
 *    cluster even though no two of them may land in the same lane). Drives
 *    the "N" badge.
 * 2. Ladder: each issue takes the first lane whose last-placed timestamp is
 *    more than OVERLAP_WINDOW_SEC away, so overlapping ticks stay
 *    independently clickable. `lane` maps straight to a `lane-N` CSS class
 *    (see index.css) for vertical stacking — consumed directly by Timeline.tsx.
 *
 * Same input → same output every run (no randomness).
 */
export function layoutTicks(issues: DeliveryIssue[]): TickLayout[] {
  const sorted = [...issues].sort((a, b) => a.timestamp - b.timestamp);

  const clusters: DeliveryIssue[][] = [];
  for (const iss of sorted) {
    const current = clusters[clusters.length - 1];
    const prev = current?.[current.length - 1];
    if (prev && iss.timestamp - prev.timestamp <= OVERLAP_WINDOW_SEC) {
      current.push(iss);
    } else {
      clusters.push([iss]);
    }
  }
  const clusterMembersById = new Map<string, string[]>();
  for (const cluster of clusters) {
    const ids = cluster.map(i => i.id);
    for (const iss of cluster) clusterMembersById.set(iss.id, ids);
  }

  const laneLast: number[] = [];  // last timestamp placed per lane
  const out: TickLayout[] = [];
  for (const iss of sorted) {
    let lane = 0;
    while (laneLast[lane] !== undefined && iss.timestamp - laneLast[lane] <= OVERLAP_WINDOW_SEC) {
      lane++;
    }
    laneLast[lane] = iss.timestamp;
    const clusterMembers = clusterMembersById.get(iss.id)!;
    out.push({ issue: iss, lane, clusterSize: clusterMembers.length, clusterMembers });
  }
  return out;
}

export { SEVERITY_COLOR };
