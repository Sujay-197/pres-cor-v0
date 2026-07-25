import type { DeliveryIssue } from '@nsh/contracts';
import { layoutTicks, sortTopIssues } from './utils';

function makeIssue(overrides: Partial<DeliveryIssue> & { id: string; timestamp: number }): DeliveryIssue {
  return {
    type: 'filler',
    severity: 'low',
    segmentId: 'seg-001',
    detail: 'test',
    ...overrides,
  };
}

/**
 * The whole reason overlap resolution exists: TEAM_PLANS §P3 says report.rough.json
 * deliberately places iss-003 at 13.9s and iss-004 at 14.2s — 0.3s apart, within
 * the 0.5s overlap window. Both must be independently clickable on stage.
 */
test('layoutTicks resolves 0.3s overlap with laddering + cluster membership', () => {
  const issues = [
    makeIssue({ id: 'iss-001', timestamp: 3.0 }),
    makeIssue({ id: 'iss-002', timestamp: 7.5 }),
    makeIssue({ id: 'iss-003', timestamp: 13.9, severity: 'medium', type: 'pause' }),
    makeIssue({ id: 'iss-004', timestamp: 14.2, severity: 'high', type: 'stress_mismatch' }),
    makeIssue({ id: 'iss-005', timestamp: 43.4 }),
  ];
  const layout = layoutTicks(issues);
  expect(layout.map(l => l.issue.id)).toEqual(['iss-001','iss-002','iss-003','iss-004','iss-005']);
  const iss003 = layout.find(l => l.issue.id === 'iss-003')!;
  const iss004 = layout.find(l => l.issue.id === 'iss-004')!;
  // Ladder: iss-003 on baseline lane (0), iss-004 laddered up to lane 1
  expect(iss004.lane).toBeGreaterThan(iss003.lane);
  expect(iss003.clusterSize).toBe(2);
  expect(iss004.clusterSize).toBe(2);
  expect(iss003.clusterMembers).toEqual(expect.arrayContaining(['iss-003','iss-004']));
  expect(iss004.clusterMembers).toEqual(iss003.clusterMembers);
  // Non-overlapping ticks are clean
  expect(layout.find(l => l.issue.id === 'iss-001')!.clusterSize).toBe(1);
  expect(layout.find(l => l.issue.id === 'iss-005')!.clusterSize).toBe(1);
});

test('layoutTicks is deterministic (same input = same output)', () => {
  const issues = [
    makeIssue({ id: 'a', timestamp: 1.0 }),
    makeIssue({ id: 'b', timestamp: 1.2 }),
    makeIssue({ id: 'c', timestamp: 1.4 }), // triple overlap!
    makeIssue({ id: 'd', timestamp: 10.0 }),
  ];
  const a = layoutTicks(issues);
  const b = layoutTicks([...issues].reverse()); // reverse to force internal sort
  expect(a.map(l => [l.issue.id, l.lane, l.clusterSize]))
    .toEqual(b.map(l => [l.issue.id, l.lane, l.clusterSize]));
  // a, b, c are each 0.2s apart — a chain of overlap even though they ladder into 3 lanes.
  const triple = a.filter(l => l.clusterSize === 3);
  expect(triple.length).toBe(3);
});

test('sortTopIssues orders severity(high→low) then timestamp', () => {
  const issues = [
    makeIssue({ id: 'a', timestamp: 10, severity: 'low' }),
    makeIssue({ id: 'b', timestamp: 2,  severity: 'medium' }),
    makeIssue({ id: 'c', timestamp: 5,  severity: 'high' }),
    makeIssue({ id: 'd', timestamp: 1,  severity: 'high' }),
    makeIssue({ id: 'e', timestamp: 8,  severity: 'medium' }),
  ];
  const ids = sortTopIssues(issues).map(i => i.id);
  // Highs by ts asc: d, c  →  Mediums by ts asc: b, e  →  Lows by ts asc: a
  expect(ids).toEqual(['d','c','b','e','a']);
});
