// apps/server/src/pipeline.ts
//
// The dependency record every I/O tool takes, its default wiring, and the
// composition of the five tools in order (design §8).
//
// analyze() PROPOSES a next step; it never executes one. See
// suggest-next-step.tool.ts for why.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DeliveryReport, SttClient } from '@nsh/contracts';
import type { AppConfig } from './config.js';
import { createLogger, withAudit, type Logger } from './audit.js';
import { AUDIO_DIR, FIXTURE_DIR, UPLOAD_DIR } from './takes.js';
import type { DecodeFn } from './adapters/audio-decode.js';
import { createSttClient } from './adapters/stt-client.js';
import {
  FixtureCalendarConnector,
  FixtureContextProvider,
  FixtureGmailConnector,
  type CalendarConnector,
  type ContextProvider,
  type GmailConnector,
} from './adapters/connectors.js';
import { parseToolInput } from './tools/parse-input.js';
import { parseScriptTool } from './tools/parse-script.tool.js';
import { transcribeDeliveryTool } from './tools/transcribe-delivery.tool.js';
import { correlateSegmentsTool } from './tools/correlate-segments.tool.js';
import { generateSummaryTool } from './tools/generate-summary.tool.js';
import { suggestNextStepTool } from './tools/suggest-next-step.tool.js';

export const DEFAULT_SCRIPT_FILE = 'script.demo.md';

export interface ServerDeps {
  config: AppConfig;
  log: Logger;
  audioDir: string;
  uploadDir: string;
  fixtureDir: string;
  /** Injected wall clock. Never called when the caller pins `now`. */
  clock: () => string;
  context: ContextProvider;
  calendar: CalendarConnector;
  gmail: GmailConnector;
  createStt: (cfg: AppConfig, takeId: string, fixtureDir: string) => SttClient;
  /** Overridden in tests; undefined means "use ffmpeg-static". */
  decode: DecodeFn | undefined;
}

export function defaultScript(fixtureDir: string): string {
  return readFileSync(join(fixtureDir, DEFAULT_SCRIPT_FILE), 'utf8');
}

export function createDeps(cfg: AppConfig, overrides: Partial<ServerDeps> = {}): ServerDeps {
  const log = overrides.log ?? createLogger(cfg.logLevel);
  const fixtureDir = overrides.fixtureDir ?? FIXTURE_DIR;
  return {
    config: cfg,
    log,
    audioDir: overrides.audioDir ?? AUDIO_DIR,
    uploadDir: overrides.uploadDir ?? UPLOAD_DIR,
    fixtureDir,
    clock: overrides.clock ?? (() => new Date().toISOString()),
    context: overrides.context ?? new FixtureContextProvider(fixtureDir),
    calendar: overrides.calendar ?? new FixtureCalendarConnector(log),
    gmail: overrides.gmail ?? new FixtureGmailConnector(log),
    createStt: overrides.createStt ?? createSttClient,
    decode: overrides.decode,
  };
}

// No `execute` field: /api/analyze only ever proposes. Exposing the flag here
// would let a caller (or a future route that forwards req.body wholesale)
// turn this propose-only pipeline into one that fires a real connector. The
// widget's confirm button reaches execution through
// POST /api/tools/suggest_next_step instead.
export const AnalyzeInput = z.object({
  takeId: z.string().min(1),
  script: z.string().optional(),
  now: z.string().optional(),
});
export type AnalyzeInput = z.infer<typeof AnalyzeInput>;

/**
 * One rule for both kinds of take. Staged takes get rpt-demo-rough, which is
 * what the committed goldens carry; an upload's take id is already a content
 * hash, so the report id stays deterministic and unique per file (design §17).
 */
export function reportIdFor(takeId: string): string {
  return `rpt-demo-${takeId}`;
}

/** Root-relative, so isAllowedAudioUrl permits it and the widget can load it. */
export function audioUrlFor(takeId: string): string {
  return `/api/audio/${takeId}`;
}

export async function analyze(
  input: z.input<typeof AnalyzeInput>,
  deps: ServerDeps,
): Promise<DeliveryReport> {
  const { takeId, script, now } = parseToolInput(AnalyzeInput, input, 'analyze');
  const audit = { takeId };

  const segments = await withAudit({ ...audit, tool: 'parse_script' }, deps.log, () =>
    parseScriptTool({ raw: script ?? defaultScript(deps.fixtureDir) }),
  );

  const signal = await withAudit({ ...audit, tool: 'transcribe_delivery' }, deps.log, () =>
    transcribeDeliveryTool({ takeId }, deps),
  );

  const correlation = await withAudit({ ...audit, tool: 'correlate_segments' }, deps.log, () =>
    correlateSegmentsTool({ signal, segments }),
  );

  const report = await withAudit({ ...audit, tool: 'generate_summary' }, deps.log, () =>
    generateSummaryTool({
      segments,
      correlation,
      signal,
      meta: { reportId: reportIdFor(takeId), audioUrl: audioUrlFor(takeId) },
    }),
  );

  // execute is always false here: /api/analyze proposes, it never acts. The
  // widget's confirm button is what later calls suggestNextStepTool with
  // execute: true via POST /api/tools/suggest_next_step.
  report.nextStep = await withAudit({ ...audit, tool: 'suggest_next_step' }, deps.log, () =>
    suggestNextStepTool({ report, takeId, now: now ?? deps.clock(), execute: false }, deps),
  );

  return report;
}
