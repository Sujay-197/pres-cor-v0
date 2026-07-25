// apps/server/src/config.ts
//
// CONVENTIONS §9 / design §11: every secret is read in exactly ONE place,
// validated with Zod, and injected from there. `loadConfig` is a pure function
// of an env record so tests never mutate process.env; `getConfig` is the single
// place that touches process.env, and it does so once.

import { z } from 'zod';
import { CoachError } from '@nsh/core-logic';

/**
 * z.coerce.boolean() is wrong here: Boolean('false') is true. Parse the literal
 * strings instead, so a typo fails loudly rather than silently enabling.
 */
const BooleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .default('true')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  // 'assemblyai' is accepted by the schema so the factory in stt-client.ts has a
  // branch to throw from (design §16). Only 'fixture' and 'deepgram' work.
  STT_PROVIDER: z.enum(['fixture', 'deepgram', 'assemblyai']).default('fixture'),
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  ENABLE_PROSODY: BooleanFromEnv,
  AUDIO_MAX_SECONDS: z.coerce.number().positive().default(180),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  port: number;
  sttProvider: 'fixture' | 'deepgram' | 'assemblyai';
  /** Held in memory, never logged, never returned by any route. */
  deepgramApiKey: string | undefined;
  enableProsody: boolean;
  audioMaxSeconds: number;
  uploadMaxBytes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Only the offending KEYS go in the message. A Zod issue can echo the
    // received value, and one of these keys is an API key.
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new CoachError('INTERNAL', `Invalid environment configuration for: ${keys}`);
  }

  const cfg: AppConfig = {
    port: parsed.data.PORT,
    sttProvider: parsed.data.STT_PROVIDER,
    deepgramApiKey: parsed.data.DEEPGRAM_API_KEY,
    enableProsody: parsed.data.ENABLE_PROSODY,
    audioMaxSeconds: parsed.data.AUDIO_MAX_SECONDS,
    uploadMaxBytes: parsed.data.UPLOAD_MAX_BYTES,
    logLevel: parsed.data.LOG_LEVEL,
  };

  // Cross-field check at boot, so a misconfiguration surfaces at startup rather
  // than on the first transcribe call during a demo (design §11).
  if (cfg.sttProvider === 'deepgram' && cfg.deepgramApiKey === undefined) {
    throw new CoachError('INTERNAL', 'STT_PROVIDER=deepgram requires DEEPGRAM_API_KEY to be set.');
  }
  if (cfg.sttProvider === 'assemblyai') {
    throw new CoachError('INTERNAL', 'STT_PROVIDER=assemblyai is not implemented; use deepgram or fixture.');
  }

  return cfg;
}

let cached: AppConfig | null = null;

/** The one and only process.env read in apps/server. */
export function getConfig(): AppConfig {
  if (cached === null) cached = loadConfig();
  return cached;
}

/** Safe-to-log / safe-to-serve projection. Presence of the key, never its value. */
export function describeConfig(cfg: AppConfig): {
  sttProvider: string;
  prosodyEnabled: boolean;
  deepgramKeyPresent: boolean;
} {
  return {
    sttProvider: cfg.sttProvider,
    prosodyEnabled: cfg.enableProsody,
    deepgramKeyPresent: cfg.deepgramApiKey !== undefined,
  };
}
