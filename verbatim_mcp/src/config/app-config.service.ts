import { join } from 'node:path';
import { Injectable } from '@nitrostack/core';
import { z } from 'zod';
import { CoachError } from '../domain/core-logic/index.js';

const BooleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .default('true')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  STT_PROVIDER: z.enum(['fixture', 'deepgram', 'assemblyai']).default('fixture'),
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  ENABLE_PROSODY: BooleanFromEnv,
  AUDIO_MAX_SECONDS: z.coerce.number().positive().default(180),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  sttProvider: 'fixture' | 'deepgram' | 'assemblyai';
  deepgramApiKey: string | undefined;
  enableProsody: boolean;
  audioMaxSeconds: number;
  uploadMaxBytes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/** Pure of process.env so tests never mutate global state. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new CoachError('INTERNAL', `Invalid environment configuration for: ${keys}`);
  }
  const cfg: AppConfig = {
    sttProvider: parsed.data.STT_PROVIDER,
    deepgramApiKey: parsed.data.DEEPGRAM_API_KEY,
    enableProsody: parsed.data.ENABLE_PROSODY,
    audioMaxSeconds: parsed.data.AUDIO_MAX_SECONDS,
    uploadMaxBytes: parsed.data.UPLOAD_MAX_BYTES,
    logLevel: parsed.data.LOG_LEVEL,
  };
  if (cfg.sttProvider === 'deepgram' && cfg.deepgramApiKey === undefined) {
    throw new CoachError('INTERNAL', 'STT_PROVIDER=deepgram requires DEEPGRAM_API_KEY to be set.');
  }
  if (cfg.sttProvider === 'assemblyai') {
    throw new CoachError('INTERNAL', 'STT_PROVIDER=assemblyai is not implemented; use deepgram or fixture.');
  }
  return cfg;
}

@Injectable()
export class AppConfigService {
  readonly cfg: AppConfig;
  readonly fixtureDir: string;
  readonly audioDir: string;
  readonly uploadDir: string;

  // The ONE process.env read in the whole server. NitroCloud runs from the
  // project root, so process.cwd()/fixtures resolves to the copied goldens.
  constructor(cfg: AppConfig = loadConfig()) {
    this.cfg = cfg;
    this.fixtureDir = join(process.cwd(), 'fixtures');
    this.audioDir = join(this.fixtureDir, 'audio');
    this.uploadDir = join(this.audioDir, 'uploads');
  }

  describe(): { sttProvider: string; prosodyEnabled: boolean; deepgramKeyPresent: boolean } {
    return {
      sttProvider: this.cfg.sttProvider,
      prosodyEnabled: this.cfg.enableProsody,
      deepgramKeyPresent: this.cfg.deepgramApiKey !== undefined,
    };
  }
}
