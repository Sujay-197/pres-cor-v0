#!/usr/bin/env node
// scripts/build-report.mjs
//
// Regenerates the demo fixtures from real transcripts. Run after any threshold
// change:  npx tsx scripts/build-report.mjs
//
// The fixture is NEVER hand-edited to match whatever the code produced — that
// would delete the only signal telling us the rules are miscalibrated.
//
// The per-take NextStepContext used to be an inline constant here. It now lives
// in packages/contracts/fixtures/next-step-context.json so the server's fixture
// connectors read the same values and the two cannot drift (design §9).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  alignSegments, correlateSegments, decideNextStep, generateSummary, parseScript,
} from '../packages/core-logic/src/index.ts';

const dir = 'packages/contracts/fixtures';
const script = parseScript(readFileSync(join(dir, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

const CONTEXTS = JSON.parse(readFileSync(join(dir, 'next-step-context.json'), 'utf8'));

for (const label of ['clean', 'rough']) {
  const transcript = JSON.parse(readFileSync(join(dir, `transcript.${label}.json`), 'utf8'));
  const signal = { transcript, prosody };
  const alignment = alignSegments(transcript, script, prosody);
  const correlation = correlateSegments(signal, script, alignment);
  const report = generateSummary(script, correlation, signal, {
    reportId: `rpt-demo-${label}`,
    audioUrl: `/fixtures/take-${label}.wav`,
  });
  report.nextStep = decideNextStep(report, CONTEXTS[label]);

  writeFileSync(join(dir, `report.${label}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const high = report.issues.filter((i) => i.severity === 'high');
  console.log(`${label}: ${report.issues.length} issues, ${high.length} high, ` +
              `${report.fillerCount} fillers, ${report.avgPaceWpm} WPM`);
  for (const issue of high) console.log(`  HIGH ${issue.segmentId}: ${issue.detail}`);
}
