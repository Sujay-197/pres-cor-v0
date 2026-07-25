import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeliveryReport, isAllowedAudioUrl, type ScriptSegment } from '@nsh/contracts';
import { loadConfig } from '../config.js';
import { createDeps } from '../pipeline.js';
import { FIXTURE_DIR } from '../takes.js';
import { parseScriptTool } from './parse-script.tool.js';
import { transcribeDeliveryTool } from './transcribe-delivery.tool.js';
import { correlateSegmentsTool } from './correlate-segments.tool.js';
import { generateSummaryTool } from './generate-summary.tool.js';

const FIXTURE_ENV = { STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' };
const deps = createDeps(loadConfig(FIXTURE_ENV));
const segments: ScriptSegment[] = parseScriptTool({
  raw: readFileSync(join(FIXTURE_DIR, 'script.demo.md'), 'utf8'),
});

const golden = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

async function buildReport(takeId: string): Promise<DeliveryReport> {
  const signal = await transcribeDeliveryTool({ takeId }, deps);
  const correlation = correlateSegmentsTool({ signal, segments });
  return generateSummaryTool({
    segments,
    correlation,
    signal,
    meta: { reportId: `rpt-demo-${takeId}`, audioUrl: `/api/audio/${takeId}` },
  });
}

/** The golden carries a nextStep; generate_summary always emits null there. */
function comparable(report: DeliveryReport): Omit<DeliveryReport, 'audioUrl' | 'nextStep'> {
  const { audioUrl: _url, nextStep: _next, ...rest } = report;
  return rest;
}

describe('generateSummaryTool', () => {
  it.each(['rough', 'clean'])('reproduces report.%s.json apart from audioUrl and nextStep', async (label) => {
    const report = await buildReport(label);
    expect(DeliveryReport.safeParse(report).success).toBe(true);
    expect(comparable(report)).toEqual(comparable(golden(label)));
    // nextStep is suggest_next_step's job — this tool always leaves it null.
    expect(report.nextStep).toBeNull();
  });

  it('stamps the caller-supplied, servable audioUrl', async () => {
    const report = await buildReport('rough');
    expect(report.audioUrl).toBe('/api/audio/rough');
    expect(isAllowedAudioUrl(report.audioUrl!)).toBe(true);
    // The fixture's own audioUrl is different by construction — that is exactly
    // why the comparison above excludes it.
    expect(golden('rough').audioUrl).toBe('/fixtures/take-rough.wav');
  });

  it('carries the measured headline numbers for the rough take', async () => {
    const report = await buildReport('rough');
    expect(report.reportId).toBe('rpt-demo-rough');
    expect(report.contractVersion).toBe(golden('rough').contractVersion);
    expect(report.issues).toHaveLength(6);
    expect(report.fillerCount).toBe(2);
    expect(report.status).toBe('ready');
  });

  it('carries the measured headline numbers for the clean take', async () => {
    const report = await buildReport('clean');
    expect(report.issues).toHaveLength(2);
    expect(report.fillerCount).toBe(0);
  });

  it('accepts a null audioUrl', async () => {
    const signal = await transcribeDeliveryTool({ takeId: 'clean' }, deps);
    const correlation = correlateSegmentsTool({ signal, segments });
    const report = generateSummaryTool({
      segments,
      correlation,
      signal,
      meta: { reportId: 'rpt-demo-clean', audioUrl: null },
    });
    expect(report.audioUrl).toBeNull();
  });
});
