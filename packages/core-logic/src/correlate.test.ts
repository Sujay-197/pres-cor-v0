import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignSegments } from './align.js';
import { correlateSegments, sortAndNumberIssues } from './correlate.js';
import { parseScript } from './parse-script.js';

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));
const clean = JSON.parse(readFileSync(join(fixtures, 'transcript.clean.json'), 'utf8'));
const segments = parseScript(readFileSync(join(fixtures, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

const run = (transcript: typeof rough) =>
  correlateSegments({ transcript, prosody }, segments, alignSegments(transcript, segments));

describe('correlateSegments — stress', () => {
  const result = run(rough);
  const high = result.issues.filter((i) => i.severity === 'high');

  it('flags exactly one high-severity issue on the rough take', () => {
    expect(high).toHaveLength(1);
  });

  it('puts it on seg-005, the rushed key point', () => {
    // v3 reality: seg-005 (the ARR stat) is the genuine rush at ~+25% over
    // baseline; seg-003 honours its marked pause and is delivered at pace.
    expect(high[0]!.segmentId).toBe('seg-005');
    expect(high[0]!.type).toBe('stress_mismatch');
  });

  it('writes a falsifiable detail naming both numbers', () => {
    expect(high[0]!.detail).toMatch(/\d+(\.\d)? WPM/);
    expect(high[0]!.detail).toContain('average');
  });

  it('emits a trace entry for every issue', () => {
    expect(result.trace).toHaveLength(result.issues.length);
    expect(result.trace.map((t) => t.issueId).sort()).toEqual(result.issues.map((i) => i.id).sort());
  });

  it('names the rule and both cross-referenced signals in the trace', () => {
    const trace = result.trace.find((t) => t.issueId === high[0]!.id)!;
    expect(trace.rule).toBe('stress.key-point-rushed');
    expect(trace.observed).toHaveProperty('wpm');
    expect(trace.observed).toHaveProperty('baselineWpm');
    expect(trace.scriptExpectation).toContain('key point');
  });

  it('returns the baseline it judged against', () => {
    expect(result.baseline.avgPaceWpm).toBeGreaterThan(0);
  });

  it('flags no high-severity issue on the clean take', () => {
    expect(run(clean).issues.filter((i) => i.severity === 'high')).toHaveLength(0);
  });

  it('never flags a non-key-point segment as stress_mismatch', () => {
    const keyIds = new Set(segments.filter((s) => s.isKeyPoint).map((s) => s.id));
    for (const issue of result.issues.filter((i) => i.type === 'stress_mismatch')) {
      expect(keyIds.has(issue.segmentId)).toBe(true);
    }
  });
});

describe('sortAndNumberIssues', () => {
  it('sorts by timestamp then assigns sequential ids', () => {
    const out = sortAndNumberIssues([
      { type: 'filler', severity: 'low', timestamp: 9, segmentId: 'seg-002', detail: 'b' },
      { type: 'filler', severity: 'low', timestamp: 3, segmentId: 'seg-001', detail: 'a' },
    ]);
    expect(out.map((i) => [i.id, i.timestamp])).toEqual([['iss-001', 3], ['iss-002', 9]]);
  });

  it('breaks timestamp ties by severity, high first', () => {
    const out = sortAndNumberIssues([
      { type: 'filler', severity: 'low', timestamp: 5, segmentId: 'seg-001', detail: 'a' },
      { type: 'stress_mismatch', severity: 'high', timestamp: 5, segmentId: 'seg-001', detail: 'b' },
    ]);
    expect(out[0]!.severity).toBe('high');
  });

  it('breaks remaining ties by type alphabetically, so reruns are identical', () => {
    const out = sortAndNumberIssues([
      { type: 'pause', severity: 'low', timestamp: 5, segmentId: 'seg-001', detail: 'a' },
      { type: 'filler', severity: 'low', timestamp: 5, segmentId: 'seg-001', detail: 'b' },
    ]);
    expect(out.map((i) => i.type)).toEqual(['filler', 'pause']);
  });
});

describe('correlateSegments — filler, pause, pacing', () => {
  const result = run(rough);
  const typesOf = (t: string) => result.issues.filter((i) => i.type === t);

  it('emits filler issues for the deliberate fillers', () => {
    // v3 rough: the tagged filler words are "like" (seg-001) and the contiguous
    // "like i mean" run (seg-002) — the other spoken "like"s matched the script
    // (seg-006's legitimate uses) or fell in an inter-segment gap. Two runs land
    // inside segment spans, so two filler ISSUES are emitted.
    expect(typesOf('filler').length).toBeGreaterThanOrEqual(2);
  });

  it('collapses a consecutive filler run into one issue', () => {
    // "like i mean" is three contiguous filler words but one emitted run — the
    // same collapse "you know" relies on. No two filler ticks share a timestamp.
    const stamps = typesOf('filler').map((i) => i.timestamp);
    expect(new Set(stamps).size).toBe(stamps.length);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThan(0.3);
    }
  });

  it('escalates a dense filler run to medium (synthetic — v3 rough is not dense)', () => {
    // No real v3 segment carries >= 3 filler runs, so the density escalation is
    // covered with a synthetic segment rather than a fixture assertion. Three
    // isolated fillers in one non-key segment: the third crosses
    // fillerDensityPerSegment and escalates low -> medium.
    const synthWords = [
      { text: 'um', start: 0.0, end: 0.2, confidence: 0.9, isFiller: true },
      { text: 'word', start: 1.0, end: 1.2, confidence: 0.9, isFiller: false },
      { text: 'um', start: 2.0, end: 2.2, confidence: 0.9, isFiller: true },
      { text: 'word', start: 3.0, end: 3.2, confidence: 0.9, isFiller: false },
      { text: 'um', start: 4.0, end: 4.2, confidence: 0.9, isFiller: true },
    ];
    const synthSeg = { id: 'seg-001', text: 'word word', isKeyPoint: false, markedPause: false };
    const synthAlign = {
      alignments: [{
        segmentId: 'seg-001', startSec: 0, endSec: 5, wordIdxStart: 0, wordIdxEnd: 5,
        wpm: 24, fillerCount: 3, meanRms: 0, meanF0: null, precedingPauseSec: 0, degraded: false,
      }],
      words: synthWords,
      matchRate: 1,
    };
    const out = correlateSegments({ transcript: { provider: 'deepgram', durationSec: 5, words: synthWords }, prosody },
      [synthSeg], synthAlign);
    const fillers = out.issues.filter((i) => i.type === 'filler');
    expect(fillers).toHaveLength(3);
    expect(fillers[2]!.severity).toBe('medium');
  });

  it('escalates a filler inside a key-point segment to medium', () => {
    for (const issue of typesOf('filler')) {
      const seg = segments.find((s) => s.id === issue.segmentId)!;
      if (seg.isKeyPoint) expect(issue.severity).toBe('medium');
    }
  });

  it('does NOT flag seg-003 — the rough take honours its marked pause', () => {
    // v3 reality: seg-003's precedingPause is ~0.8s, well above 0.5x the ~0.5s
    // median, so pause.marked-not-honoured must NOT fire. The clean take honours
    // it too (~0.9s). Neither real take produces a pause issue.
    expect(typesOf('pause')).toHaveLength(0);
  });

  it('never flags a pause on a segment the script did not mark', () => {
    for (const issue of typesOf('pause')) {
      expect(segments.find((s) => s.id === issue.segmentId)!.markedPause).toBe(true);
    }
  });

  it('fires pause.marked-not-honoured on a synthetic skipped pause', () => {
    // Both real takes honour the pause, so the rule's positive path is covered
    // synthetically: a marked-pause segment entered with almost no preceding
    // beat (0.05s) against a healthy 0.8s median (threshold 0.5x = 0.4s) must
    // escalate to a medium pause issue.
    const synthWords = [
      { text: 'setup', start: 0.0, end: 0.4, confidence: 0.9, isFiller: false },
      { text: 'gap', start: 1.2, end: 1.6, confidence: 0.9, isFiller: false }, // 0.8s gap -> median
      { text: 'payoff', start: 1.65, end: 2.05, confidence: 0.9, isFiller: false }, // 0.05s -> skipped
    ];
    const segs = [
      { id: 'seg-001', text: 'setup gap', isKeyPoint: false, markedPause: false },
      { id: 'seg-002', text: 'payoff', isKeyPoint: false, markedPause: true },
    ];
    const synthAlign = {
      alignments: [
        { segmentId: 'seg-001', startSec: 0, endSec: 1.6, wordIdxStart: 0, wordIdxEnd: 2,
          wpm: 60, fillerCount: 0, meanRms: 0, meanF0: null, precedingPauseSec: 0, degraded: false },
        { segmentId: 'seg-002', startSec: 1.65, endSec: 2.05, wordIdxStart: 2, wordIdxEnd: 3,
          wpm: 60, fillerCount: 0, meanRms: 0, meanF0: null, precedingPauseSec: 0.05, degraded: false },
      ],
      words: synthWords,
      matchRate: 1,
    };
    const out = correlateSegments(
      { transcript: { provider: 'deepgram', durationSec: 2.05, words: synthWords }, prosody },
      segs, synthAlign);
    const pause = out.issues.find((i) => i.type === 'pause' && i.segmentId === 'seg-002');
    expect(pause).toBeDefined();
    expect(pause!.severity).toBe('medium');
  });

  it('suppresses pacing on a segment that already has a stress issue', () => {
    const stressed = new Set(typesOf('stress_mismatch').map((i) => i.segmentId));
    for (const issue of typesOf('pacing')) expect(stressed.has(issue.segmentId)).toBe(false);
  });

  it('keeps pacing at low severity', () => {
    for (const issue of typesOf('pacing')) expect(issue.severity).toBe('low');
  });

  it('does NOT flag pacing on seg-006 despite its 313 WPM end-blurt (duration guard)', () => {
    // seg-006 is the fastest segment in raw WPM (313 rough / 218 clean) but its
    // span is only ~2.3s / ~3.3s — below minPaceVerdictSec (4). WPM over a ~2-3s
    // window is dominated by a single breath, so the guard suppresses the verdict.
    const seg6 = alignSegments(rough, segments).alignments.find((a) => a.segmentId === 'seg-006')!;
    expect(seg6.wpm).toBeGreaterThan(250);            // it really is the fastest
    expect(seg6.endSec - seg6.startSec).toBeLessThan(4); // ...but too short to judge
    expect(typesOf('pacing').some((i) => i.segmentId === 'seg-006')).toBe(false);
  });

  it('pacing is two-sided but only on ordinary, long-enough, non-stress segments', () => {
    // DECISION (v3): pacing.drift is two-sided — a slow, rambling open (seg-001 at
    // ~-34% over 7.0s) is as coachable as a fast one, and the measured numbers
    // support flagging it. Every pacing issue must therefore sit on a non-key,
    // non-degraded segment whose span clears the 4s guard and that carries no
    // stress issue. With pacingDriftPct at 0.10 (percent band, not sigma — the
    // Task 7-review reformulation) the rough take flags seg-001 and seg-002
    // (slow) and seg-004 (fast); the clean take flags seg-001 and seg-002.
    // (CorrelationResult carries no alignments, so re-derive spans.)
    const spans = new Map(
      alignSegments(rough, segments).alignments.map((a) => [a.segmentId, a.endSec - a.startSec]),
    );
    const stressed = new Set(typesOf('stress_mismatch').map((i) => i.segmentId));
    for (const issue of typesOf('pacing')) {
      const seg = segments.find((s) => s.id === issue.segmentId)!;
      expect(seg.isKeyPoint).toBe(false);
      expect(stressed.has(issue.segmentId)).toBe(false);
      expect(spans.get(issue.segmentId)!).toBeGreaterThanOrEqual(4); // minPaceVerdictSec
    }
  });

  it('still emits exactly one high-severity issue overall', () => {
    expect(result.issues.filter((i) => i.severity === 'high')).toHaveLength(1);
  });

  it('emits a trace for every issue, including the new types', () => {
    expect(result.trace).toHaveLength(result.issues.length);
  });
});
