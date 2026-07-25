/**
 * The fixtures are P3's entire hour-0 unblock, and P1's golden-test target.
 * If they drift from the schema, both find out here rather than at the merge.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CONTRACT_VERSION, DeliveryReport, SEVERITY_COLOR } from './index.js';

const dir = join(import.meta.dirname, '../fixtures');
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

const names = ['report.clean.json', 'report.rough.json'] as const;

describe.each(names)('%s', (name) => {
  const raw = load(name);

  it('satisfies the DeliveryReport schema', () => {
    expect(() => DeliveryReport.parse(raw)).not.toThrow();
  });

  it('declares the current contract version', () => {
    expect(raw.contractVersion).toBe(CONTRACT_VERSION);
  });

  it('has issues sorted by timestamp with sequential ids', () => {
    const report = DeliveryReport.parse(raw);
    const stamps = report.issues.map((i) => i.timestamp);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    report.issues.forEach((issue, idx) => {
      expect(issue.id).toBe(`iss-${String(idx + 1).padStart(3, '0')}`);
    });
  });

  it('references only segments that exist', () => {
    const report = DeliveryReport.parse(raw);
    const ids = new Set(report.segments.map((s) => s.id));
    for (const issue of report.issues) expect(ids.has(issue.segmentId)).toBe(true);
  });

  it('keeps every issue inside the recording', () => {
    const report = DeliveryReport.parse(raw);
    for (const issue of report.issues) {
      expect(issue.timestamp).toBeGreaterThanOrEqual(0);
      expect(issue.timestamp).toBeLessThanOrEqual(report.durationSec);
    }
  });

  it('reports a fillerCount matching its filler issues', () => {
    const report = DeliveryReport.parse(raw);
    const counted = report.issues.filter((i) => i.type === 'filler').length;
    expect(report.fillerCount).toBe(counted);
  });

  it('proposes rather than executes its next step', () => {
    const report = DeliveryReport.parse(raw);
    expect(report.nextStep?.executed).toBe(false);
  });
});

describe('the demo pair', () => {
  it('gives the rough take exactly one high-severity issue, on a key point', () => {
    // The red tick is the demo (SPEC §8 step 2). Exactly one, or the story blurs.
    const rough = DeliveryReport.parse(load('report.rough.json'));
    const high = rough.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);

    const segment = rough.segments.find((s) => s.id === high[0]!.segmentId);
    expect(segment?.isKeyPoint).toBe(true);
    expect(high[0]!.type).toBe('stress_mismatch');
  });

  it('keeps the clean take free of high-severity issues', () => {
    const clean = DeliveryReport.parse(load('report.clean.json'));
    expect(clean.issues.every((i) => i.severity === 'low')).toBe(true);
  });

  it('covers both nextStep branches across the pair, so P3 can build both', () => {
    const kinds = names.map((n) => DeliveryReport.parse(load(n)).nextStep?.kind);
    expect(new Set(kinds)).toEqual(new Set(['draft_note', 'calendar_reminder']));
  });

  it('has a colour defined for every severity the widget can receive', () => {
    expect(Object.keys(SEVERITY_COLOR).sort()).toEqual(['high', 'low', 'medium']);
  });
});
