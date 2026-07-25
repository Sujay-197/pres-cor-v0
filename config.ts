// apps/server/src/config.ts
//
// CONVENTIONS §9: every secret is read in exactly ONE place, validated with
// Zod at boot, and injected from there. No process.env reads anywhere else
// in apps/server — if you catch a teammate typing `process.env` inside a
// tool or adapter, point them here instead.

import { z } from 'zod';

const EnvSchema = z.object({
  STT_PROVIDER: z.enum(['deepgram', 'assemblyai', 'fixture']).default('fixture'),
  DEEPGRAM_API_KEY: z.string().optional(),
  ASSEMBLYAI_API_KEY: z.string().optional(),
  AUDIO_MAX_SECONDS: z.coerce.number().default(180),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// Cross-field check: if a real provider is selected, its key must exist.
// Doing this here means a missing key fails fast at boot, not mid-demo on
// the first transcribe_delivery call.
const RawConfig = EnvSchema.parse(process.env);

function assertProviderConfigured(cfg: z.infer<typeof EnvSchema>) {
  if (cfg.STT_PROVIDER === 'deepgram' && !cfg.DEEPGRAM_API_KEY) {
    throw new Error('STT_PROVIDER=deepgram requires DEEPGRAM_API_KEY');
  }
  if (cfg.STT_PROVIDER === 'assemblyai' && !cfg.ASSEMBLYAI_API_KEY) {
    throw new Error('STT_PROVIDER=assemblyai requires ASSEMBLYAI_API_KEY');
  }
}
assertProviderConfigured(RawConfig);

export const config = RawConfig;
export type AppConfig = typeof config;

// If NitroStudio's DI wants this as an injectable provider rather than a
// module-level singleton, wrap it, e.g.:
//
// @Injectable()
// export class ConfigService {
//   readonly value: AppConfig = config;
// }
//
// Swap this in once the CLI scaffolds the provider token convention —
// keeping both the plain export and the class shape ready avoids a rewrite
// either way this lands.
