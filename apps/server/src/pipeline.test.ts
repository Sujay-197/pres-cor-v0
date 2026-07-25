import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DeliveryReport, isAllowedAudioUrl } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import type { Logger } from './audit.js';
import { FIXTURE_DIR } from './takes.js';
import { analyze, audioUrlFor, createDeps, reportIdFor, type ServerDeps } from './pipeline.js';

const NOW = '2026-07-25T09:00:00Z';
const FIXTURE_ENV = { STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' };

const golden = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

function withoutAudioUrl(report: DeliveryReport): Omit<DeliveryReport, 'audioUrl'> {
  const { audioUrl: _url, ...rest } = report;
  return rest;
}

function depsWithLog(): { deps: ServerDeps; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const log: Logger = (level, message, meta) => lines.push({ level, message, ...(meta ?? {}) });
  const deps = createDeps(loadConfig(FIXTURE_ENV), {
    log,
    clock: () => {
      throw new Error('the clock must not be read when `now` is pinned');
    },
  });
  return { deps, lines };
}

describe('reportIdFor / audioUrlFor', () => {
  it('derive both identifiers from the one take id', () => {
    expect(reportIdFor('rough')).toBe('rpt-demo-rough');
    expect(reportIdFor('up-0123456789ab')).toBe('rpt-demo-up-0123456789ab');
    expect(audioUrlFor('rough')).toBe('/api/audio/rough');
    expect(isAllowedAudioUrl(audioUrlFor('rough'))).toBe(true);
  });
});

describe('analyze', () => {
  it.each(['rough', 'clean'])('reproduces report.%s.json apart from audioUrl', async (label) => {
    const { deps } = depsWithLog();
    const report = await analyze({ takeId: label, now: NOW }, deps);

    expect(DeliveryReport.safeParse(report).success).toBe(true);
    expect(withoutAudioUrl(report)).toEqual(withoutAudioUrl(golden(label)));
    expect(report.audioUrl).toBe(`/api/audio/${label}`);
    // The fixture's audioUrl is environment-dependent by construction, which is
    // the entire reason it is excluded above.
    expect(golden(label).audioUrl).toBe(`/fixtures/take-${label}.wav`);
  });

  it('proposes rather than executes, so the golden nextStep still matches', async () => {
    const { deps } = depsWithLog();
    const report = await analyze({ takeId: 'rough', now: NOW }, deps);
    expect(report.nextStep).toEqual(golden('rough').nextStep);
    expect(report.nextStep!.executed).toBe(false);
  });

  it('emits one audit line per tool, in pipeline order', async () => {
    const { deps, lines } = depsWithLog();
    await analyze({ takeId: 'rough', now: NOW }, deps);
    const toolLines = lines.filter((l) => l['message'] === 'tool.call');
    expect(toolLines.map((l) => l['tool'])).toEqual([
      'parse_script',
      'transcribe_delivery',
      'correlate_segments',
      'generate_summary',
      'suggest_next_step',
    ]);
    expect(toolLines.every((l) => l['outcome'] === 'ok')).toBe(true);
    expect(toolLines.every((l) => l['takeId'] === 'rough')).toBe(true);
  });

  it('accepts a caller-supplied script', async () => {
    const { deps } = depsWithLog();
    const report = await analyze(
      { takeId: 'rough', now: NOW, script: 'Good morning.\n\nMost retail teams still reconcile inventory by hand.' },
      deps,
    );
    expect(report.segments).toHaveLength(2);
    expect(report.segments.map((s) => s.id)).toEqual(['seg-001', 'seg-002']);
  });

  it('propagates a CoachError with its code and records the failing tool', async () => {
    const { deps, lines } = depsWithLog();
    let thrown: unknown;
    try {
      await analyze({ takeId: 'rough', now: NOW, script: '   ' }, deps);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('SCRIPT_EMPTY');
    const failed = lines.filter((l) => l['outcome'] === 'error');
    expect(failed).toHaveLength(1);
    expect(failed[0]!['tool']).toBe('parse_script');
    expect(failed[0]!['errorCode']).toBe('SCRIPT_EMPTY');
  });

  it('reads the injected clock when `now` is not pinned', async () => {
    let reads = 0;
    const deps = createDeps(loadConfig(FIXTURE_ENV), {
      clock: () => {
        reads += 1;
        return NOW;
      },
    });
    const report = await analyze({ takeId: 'rough' }, deps);
    expect(reads).toBe(1);
    expect(report.nextStep).toEqual(golden('rough').nextStep);
  });
});
