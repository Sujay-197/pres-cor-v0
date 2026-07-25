// packages/core-logic/src/golden.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NextStepContext } from '@nsh/contracts';
import { alignSegments, correlateSegments, decideNextStep, generateSummary, parseScript } from './index.js';

const dir = join(import.meta.dirname, '../../contracts/fixtures');
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const script = parseScript(readFileSync(join(dir, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

const cases: Array<[string, NextStepContext]> = [
  ['clean', { upcomingEvents: [], knownMentor: 'Priya', now: '2026-07-25T09:00:00Z' }],
  ['rough', {
    upcomingEvents: [{ title: 'Northwind investor call', startsAt: '2026-07-27T14:00:00Z' }],
    knownMentor: null, now: '2026-07-25T09:00:00Z',
  }],
];

describe.each(cases)('golden: %s take', (label, ctx) => {
  it('reproduces the committed fixture exactly', () => {
    const transcript = load(`transcript.${label}.json`);
    const signal = { transcript, prosody };
    const alignment = alignSegments(transcript, script, prosody);
    const correlation = correlateSegments(signal, script, alignment);
    const report = generateSummary(script, correlation, signal, {
      reportId: `rpt-demo-${label}`,
      audioUrl: `/fixtures/take-${label}.wav`,
    });
    report.nextStep = decideNextStep(report, ctx);

    expect(report).toEqual(load(`report.${label}.json`));
  });
});
