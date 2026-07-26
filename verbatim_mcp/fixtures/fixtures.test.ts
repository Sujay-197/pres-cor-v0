import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeliveryReport, Transcript } from '../src/domain/contracts/index.js';

const dir = join(process.cwd(), 'fixtures');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('golden fixtures', () => {
  it.each(['clean', 'rough'])('report.%s.json matches the contract', (label) => {
    expect(DeliveryReport.safeParse(read(`report.${label}.json`)).success).toBe(true);
  });

  it.each(['clean', 'rough'])('transcript.%s.json matches the contract', (label) => {
    expect(Transcript.safeParse(read(`transcript.${label}.json`)).success).toBe(true);
  });

  it('the rough report carries exactly one high-severity issue on seg-005', () => {
    const rough = read('report.rough.json') as ReturnType<typeof DeliveryReport.parse>;
    const high = rough.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
  });
});
