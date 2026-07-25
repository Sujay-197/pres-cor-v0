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
 * Deterministic overlap resolution.
 * Inputs: issues sorted by timestamp ascending (iss-NNN order already does this).
 * Algorithm: sweep issues left→right. Each issue takes the first available "lane"
 * such that no issue in the lane is within OVERLAP_WINDOW_SEC. Lane index × -8 = topOffsetPx.
 * Same input → same output every run (no randomness).
 */
export function layoutTicks(issues: DeliveryIssue[]): TickLayout[] {
  const sorted = [...issues].sort((a, b) => a.timestamp - b.timestamp);
  const laneLast: number[] = [];  // last timestamp placed per lane
  const laneClusters: Array<Array<{ ts: number; id: string }>> = [];
  const out: TickLayout[] = [];

  for (const iss of sorted) {
    let lane = 0;
    while (true) {
      const last = laneLast[lane];
      if (last === undefined || iss.timestamp - last > OVERLAP_WINDOW_SEC) {
        laneLast[lane] = iss.timestamp;
        if (!laneClusters[lane]) laneClusters[lane] = [];
        // cluster membership: detect if previous in same lane was cluster-mate or not
        const prevInLane = laneClusters[lane][laneClusters[lane].length - 1];
        if (prevInLane && iss.timestamp - prevInLane.ts <= OVERLAP_WINDOW_SEC) {
          // extend cluster
          const clusterMembers = [...out[findIssueIndex(out, prevInLane.id)].clusterMembers, iss.id];
          // update prior tick clusterSize + members
          const priorIdx = findIssueIndex(out, prevInLane.id);
          out[priorIdx].clusterSize = clusterMembers.length;
          out[priorIdx].clusterMembers = clusterMembers;
          out.push({
            issue: iss,
            lane,
            clusterSize: clusterMembers.length,
            clusterMembers,
          });
        } else {
          out.push({
            issue: iss,
            lane,
            clusterSize: 1,
            clusterMembers: [iss.id],
          });
        }
        laneClusters[lane].push({ ts: iss.timestamp, id: iss.id });
        break;
      }
      lane++;
    }
  }
  return out;
}

function findIssueIndex(arr: TickLayout[], id: string): number {
  return arr.findIndex(t => t.issue.id === id);
}

export { SEVERITY_COLOR };
