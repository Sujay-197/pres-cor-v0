import type {
  CorrelationResult, DecisionTrace, DeliveryIssue, DeliverySignal,
  ScriptSegment, SegmentAlignment, Severity, Word,
} from '@nsh/contracts';
import type { AlignmentResult } from './align.js';
import { computeBaseline } from './baseline.js';
import { ruleById, THRESHOLDS } from './thresholds.js';

/** An issue before it has been sorted and given an id. */
export type RawIssue = Omit<DeliveryIssue, 'id'>;
/** A trace before its issue has an id. */
export type RawTrace = Omit<DecisionTrace, 'issueId'>;
/**
 * An issue and the trace that justifies it, carried together so the two can be
 * sorted and numbered as a unit. Positional pairing — never a string key — is
 * how the trace stays attached to its issue: two same-type issues in one segment
 * at the same rounded timestamp would collide on any `segmentId|type|timestamp`
 * key, silently attaching one issue's trace to the other (Finding 13).
 */
interface IssuePair { issue: RawIssue; trace: RawTrace }

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The one deterministic ordering, shared by `sortAndNumberIssues` and the paired
 * numbering below so the two can never drift. Ties break by severity then type;
 * if IDs shuffled between runs the rehearsed demo click-path would break on stage
 * (CONVENTIONS §3).
 */
function compareIssues(a: RawIssue, b: RawIssue): number {
  return (
    a.timestamp - b.timestamp ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.type.localeCompare(b.type)
  );
}

/**
 * IDs are assigned AFTER sorting so the same input always produces the same
 * report byte for byte. Standalone helper (exported for its own unit test);
 * `correlateSegments` uses `numberIssuePairs` so it can carry traces alongside.
 */
export function sortAndNumberIssues(raw: RawIssue[]): DeliveryIssue[] {
  return [...raw]
    .sort(compareIssues)
    .map((issue, idx) => ({ id: `iss-${String(idx + 1).padStart(3, '0')}`, ...issue }));
}

/**
 * Sort issue/trace PAIRS together by the same ordering, then assign `iss-NNN`
 * ids positionally and stamp each trace's `issueId`. Because the trace travels
 * with its issue through the sort, the id/issueId correspondence is exact with
 * no key lookup that could collide.
 */
function numberIssuePairs(pairs: IssuePair[]): { issues: DeliveryIssue[]; trace: DecisionTrace[] } {
  const sorted = [...pairs].sort((x, y) => compareIssues(x.issue, y.issue));
  const issues: DeliveryIssue[] = [];
  const trace: DecisionTrace[] = [];
  sorted.forEach((pair, idx) => {
    const id = `iss-${String(idx + 1).padStart(3, '0')}`;
    issues.push({ id, ...pair.issue });
    trace.push({ issueId: id, ...pair.trace });
  });
  return { issues, trace };
}

interface FillerRun { startSec: number; wordCount: number; text: string }

/**
 * Collapses consecutive filler words into one run. "you know" is two words but
 * one hedge; "um um" is one stumble, not two. Emitting per-word would both
 * inflate fillerCount and put unclickable overlapping ticks on the timeline.
 */
function fillerRuns(words: Word[], from: number, to: number): FillerRun[] {
  const runs: FillerRun[] = [];
  let current: FillerRun | null = null;

  for (let i = from; i < to; i++) {
    const word = words[i];
    if (!word) continue;
    if (!word.isFiller) { current = null; continue; }
    if (current === null) {
      current = { startSec: word.start, wordCount: 1, text: word.text };
      runs.push(current);
    } else {
      current.wordCount++;
      current.text += ` ${word.text}`;
    }
  }
  return runs;
}

/** Mean f0 over the first and last third of a segment, for the pitch-rise rule. */
function pitchSlope(signal: DeliverySignal, a: SegmentAlignment): number | null {
  const frames = signal.prosody.frames.filter(
    (f) => f.t >= a.startSec && f.t < a.endSec && f.f0 !== null && f.f0 > 0,
  );
  if (frames.length < 6) return null;
  const third = Math.floor(frames.length / 3);
  const meanOf = (xs: typeof frames) =>
    xs.reduce((s, f) => s + (f.f0 ?? 0), 0) / Math.max(xs.length, 1);
  const first = meanOf(frames.slice(0, third));
  const last = meanOf(frames.slice(-third));
  return first > 0 ? last / first : null;
}

/**
 * THE BRANCH POINT. For each segment, decides whether a deviation matters by
 * cross-referencing WHERE it happened against WHAT the script says should
 * happen there. Every verdict emits a DecisionTrace — that trace is what a
 * judge reads on Ops Canvas, so it is not optional polish.
 *
 * Task 7 emits only the stress rule; Task 9 makes this a superset with filler,
 * pause and pacing. The pair-collection + numberIssuePairs shape is already in
 * place so Task 9 only adds `pairs.push(...)` blocks.
 */
export function correlateSegments(
  signal: DeliverySignal,
  segments: ScriptSegment[],
  alignment: AlignmentResult,
): CorrelationResult {
  const baseline = computeBaseline(alignment.alignments, alignment.words, signal.prosody);
  const pairs: IssuePair[] = [];

  const byId = new Map(alignment.alignments.map((a) => [a.segmentId, a]));
  // Percent-above-baseline ceiling, NOT a sigma band (Task 7 review fix). The
  // old `avgPaceWpm + 0.4σ` formulation was meaningless because paceStdDev was
  // polluted by seg-006's short-span end-blurt; both that pollution (baseline.ts)
  // and the sigma dependency (here) are now gone. Measured: rough 143.9 -> 172.7,
  // clean 146.6 -> 175.9.
  const rushCeiling = r1(baseline.avgPaceWpm * (1 + THRESHOLDS.stressRushPct));

  for (const segment of segments) {
    const a = byId.get(segment.id);
    if (!a) continue;

    let hasStressIssue = false;

    // ---- stress_mismatch (key points only; suppressed when degraded) ----
    if (segment.isKeyPoint && !a.degraded) {
      const rushed = a.wpm >= rushCeiling;
      const slope = pitchSlope(signal, a);
      const rising = slope !== null && slope > THRESHOLDS.risingPitchRatio;
      if (rushed || rising) {
        // One stress issue per segment. Rushed wins — pace is the more legible
        // signal on stage — and pitch appears as corroboration in the detail.
        const ruleId = rushed ? 'stress.key-point-rushed' : 'stress.key-point-rising-pitch';
        const rule = ruleById(ruleId);

        const pct = Math.round(((a.wpm - baseline.avgPaceWpm) / baseline.avgPaceWpm) * 100);
        const detail = rushed
          ? `${a.wpm} WPM vs your ${baseline.avgPaceWpm} WPM average — ${pct}% faster` +
            (rising ? `, with pitch rising ${Math.round((slope - 1) * 100)}% across the line` : '') +
            '. This is a key point and you delivered it like a caveat.'
          : `Pitch rises ${Math.round(((slope ?? 1) - 1) * 100)}% across this line. ` +
            'It is a key point stated as fact, but delivered as a question.';

        pairs.push({
          issue: {
            type: 'stress_mismatch',
            severity: rule.verdict,
            timestamp: a.startSec,
            segmentId: segment.id,
            detail,
          },
          trace: {
            segmentId: segment.id,
            rule: ruleId,
            observed: {
              wpm: a.wpm,
              baselineWpm: baseline.avgPaceWpm,
              threshold: rushCeiling,
              ...(slope === null ? {} : { pitchRatio: r1(slope) }),
            },
            scriptExpectation: `Segment is marked as a key point; expected pace at or below ${rushCeiling} WPM.`,
            verdict: rule.verdict,
            reasoning: rule.why,
          },
        });
        hasStressIssue = true;
      }
    }

    // ---- filler (consecutive words collapse into one run; runs on every
    //      segment, degraded included — filler does not need an accurate span) ----
    const runs = fillerRuns(alignment.words, a.wordIdxStart, a.wordIdxEnd);
    runs.forEach((runItem, idx) => {
      const ruleId = segment.isKeyPoint
        ? 'filler.in-key-point'
        : idx >= THRESHOLDS.fillerDensityPerSegment
          ? 'filler.density'
          : 'filler.isolated';
      const rule = ruleById(ruleId);

      const detail = ruleId === 'filler.in-key-point'
        ? `"${runItem.text}" inside a key point. A hedge in front of your claim reads as doubt about the claim.`
        : ruleId === 'filler.density'
          ? `Filler number ${idx + 1} in this segment. Density, not any single word, is what an audience notices.`
          : `"${runItem.text}" on a low-stakes line. Worth noting, not worth fixing.`;

      pairs.push({
        issue: {
          type: 'filler',
          severity: rule.verdict,
          timestamp: r1(runItem.startSec),
          segmentId: segment.id,
          detail,
        },
        trace: {
          segmentId: segment.id,
          rule: ruleId,
          observed: {
            fillerIndexInSegment: idx + 1,
            runWordCount: runItem.wordCount,
            segmentFillerCount: runs.length,
          },
          scriptExpectation: segment.isKeyPoint
            ? 'Segment is marked as a key point; no hedging expected.'
            : 'Segment is an ordinary line; isolated fillers tolerated.',
          verdict: rule.verdict,
          reasoning: rule.why,
        },
      });
    });

    // ---- pause (marked pauses only; runs on every segment, degraded included) ----
    const medianPause = baseline.medianPauseSec;
    if (segment.markedPause && medianPause !== null &&
        a.precedingPauseSec < THRESHOLDS.markedPauseHonouredRatio * medianPause) {
      const rule = ruleById('pause.marked-not-honoured');
      const timestamp = r1(Math.max(a.startSec - 0.3, 0));
      pairs.push({
        issue: {
          type: 'pause',
          severity: rule.verdict,
          timestamp,
          segmentId: segment.id,
          detail: `Your script marks a pause before this line. You left ${a.precedingPauseSec}s — ` +
                  `you normally leave ${medianPause}s. The setup for this line lands flat.`,
        },
        trace: {
          segmentId: segment.id,
          rule: 'pause.marked-not-honoured',
          observed: { precedingPauseSec: a.precedingPauseSec, medianPauseSec: medianPause },
          scriptExpectation: 'Script marks [pause] before this segment.',
          verdict: rule.verdict,
          reasoning: rule.why,
        },
      });
    }

    // ---- pacing (ordinary lines only; suppressed by degraded OR a stress issue,
    //      and skipped for segments too short to judge) ----
    // Stress and pacing both read the same WPM observation; emitting both would
    // double-report one fact and dilute the red tick. A segment that already
    // produced a stress issue therefore never also produces a pacing issue.
    // The duration guard drops segments whose rounded span is under
    // minPaceVerdictSec: WPM over ~2-3s is one breath, not a pace (seg-006's
    // 313/218 WPM end-blurt must not fire in either take). Two-sided by design —
    // a slow open (seg-001, ~-34%) is as coachable as a fast line. Percent band
    // (pacingDriftPct), not sigma — same reformulation as the stress ceiling.
    const paceSpan = r1(a.endSec - a.startSec);
    if (!a.degraded && !hasStressIssue && !segment.isKeyPoint &&
        paceSpan >= THRESHOLDS.minPaceVerdictSec) {
      const driftPct = baseline.avgPaceWpm > 0
        ? Math.abs(a.wpm - baseline.avgPaceWpm) / baseline.avgPaceWpm
        : 0;
      if (driftPct > THRESHOLDS.pacingDriftPct) {
        const rule = ruleById('pacing.drift');
        const direction = a.wpm > baseline.avgPaceWpm ? 'faster' : 'slower';
        pairs.push({
          issue: {
            type: 'pacing',
            severity: rule.verdict,
            timestamp: a.startSec,
            segmentId: segment.id,
            detail: `${a.wpm} WPM vs your ${baseline.avgPaceWpm} WPM average — noticeably ${direction} than your usual pace.`,
          },
          trace: {
            segmentId: segment.id,
            rule: 'pacing.drift',
            observed: {
              wpm: a.wpm,
              baselineWpm: baseline.avgPaceWpm,
              driftPct: Math.round(driftPct * 100),
            },
            scriptExpectation: `Ordinary line; pace expected within ${Math.round(THRESHOLDS.pacingDriftPct * 100)}% of baseline.`,
            verdict: rule.verdict,
            reasoning: rule.why,
          },
        });
      }
    }
  }

  const { issues, trace } = numberIssuePairs(pairs);
  return { issues, trace, baseline, alignments: alignment.alignments };
}
