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
