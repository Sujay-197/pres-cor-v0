import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, DeliveryReport } from '@nsh/contracts';
import { alignSegments } from './align.js';
import { correlateSegments } from './correlate.js';
import { generateSummary } from './summary.js';
import { parseScript } from './parse-script.js';

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));
const segments = parseScript(readFileSync(join(fixtures, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

const build = () => {
  const signal = { transcript: rough, prosody };
  const alignment = alignSegments(rough, segments);
  const correlation = correlateSegments(signal, segments, alignment);
  return generateSummary(segments, correlation, signal, {
    reportId: 'rpt-demo-rough',
    audioUrl: '/fixtures/take-rough.wav',
  });
};

describe('generateSummary', () => {
  const report = build();

  it('satisfies the DeliveryReport schema', () => {
    expect(() => DeliveryReport.parse(report)).not.toThrow();
  });

  it('stamps the current contract version', () => {
    expect(report.contractVersion).toBe(CONTRACT_VERSION);
  });

  it('reports fillerCount as the number of filler issues', () => {
    expect(report.fillerCount).toBe(report.issues.filter((i) => i.type === 'filler').length);
  });

  it('takes duration from the transcript, rounded to one decimal', () => {
    // generateSummary rounds durationSec to 1dp (all emitted floats are r1);
    // the transcript fixture stores 3dp, so assert the rounded value, not raw.
    expect(report.durationSec).toBe(Math.round(rough.durationSec * 10) / 10);
  });

  it('leaves nextStep null for the caller to fill', () => {
    expect(report.nextStep).toBeNull();
  });

  it('marks the report ready', () => {
    expect(report.status).toBe('ready');
  });

  it('rounds every emitted float to one decimal', () => {
    const oneDp = (n: number) => Math.round(n * 10) / 10 === n;
    expect(oneDp(report.avgPaceWpm)).toBe(true);
    for (const issue of report.issues) expect(oneDp(issue.timestamp)).toBe(true);
  });

  it('is byte-for-byte deterministic across runs', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
