// apps/server/src/pipeline.ts
//
// The dependency record every I/O tool takes, and its default wiring. Keeping
// one record rather than a per-tool bag is what stops the tool signatures
// drifting apart as the pipeline grows.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SttClient } from '@nsh/contracts';
import type { AppConfig } from './config.js';
import { createLogger, type Logger } from './audit.js';
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
