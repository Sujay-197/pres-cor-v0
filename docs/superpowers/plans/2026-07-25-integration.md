# Integration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/server` — adapters, five tools, HTTP — so that selecting a take in the widget produces a live `DeliveryReport` from the real pipeline that is byte-identical to the committed golden fixture.

**Architecture:** One new workspace, `apps/server`, owns every clock read, file read and network call; `@nsh/contracts` and `@nsh/core-logic` stay pure and unchanged. Five plain functions wrap the seven core-logic functions, composed by `pipeline.ts` and exposed over Express as `/api/analyze` plus a NitroStack-shaped `/api/tools/:name`. The widget's `App.tsx` swaps its fixture tabs for a server-driven take picker, keeping the two fixtures as an offline fallback.

**Tech Stack:** TypeScript 5.6 (strict + `noUncheckedIndexedAccess`), Node >=20 ESM, Express 4, multer, ffmpeg-static, Zod 3, Vitest 2.1, `tsx` as the runner, React 18 + Vite 5 for the widget.

## Global Constraints

- Layering: `apps/server` imports `@nsh/contracts` and `@nsh/core-logic`; neither ever imports `apps/server`.
- Never redeclare a contract type. Every type comes from `@nsh/contracts`.
- Never throw a raw `Error` across a tool boundary — always `CoachError` with a code.
- `CoachError.code` -> HTTP: `SCRIPT_EMPTY` 400, `SCRIPT_NO_SEGMENTS` 400, `AUDIO_UNREADABLE` 415, `AUDIO_TOO_SHORT` 422, `STT_FAILED` 502, `ALIGNMENT_FAILED` 422, `INTERNAL` 500.
- Response body on error is exactly `{ error: { code, message } }`. `CoachError.context` is logged, never returned.
- `process.env` is read in exactly one place: `apps/server/src/config.ts`.
- Env defaults: `PORT=8787`, `STT_PROVIDER=fixture`, `ENABLE_PROSODY=true`, `AUDIO_MAX_SECONDS=180`, `UPLOAD_MAX_BYTES=26214400`, `LOG_LEVEL=info`. `DEEPGRAM_API_KEY` has no default and is required when `STT_PROVIDER=deepgram` (checked at boot).
- `DEEPGRAM_API_KEY` is never logged, never echoed, never asserted on by value.
- Deepgram query params, verbatim: `model=nova-3&filler_words=true&punctuate=true&smart_format=false&numerals=false`.
- Time is seconds as a float, everywhere. Deepgram values are rounded to 3dp at the adapter boundary and never converted again.
- IDs are deterministic. No `Math.random()`, no `Date.now()` in anything that reaches a report.
- Staged take id = filename minus `take-` prefix minus extension. `fixtures/audio/take-rough.m4a` -> `rough`.
- Report id = `rpt-demo-${takeId}`.
- Server-produced `audioUrl` = `/api/audio/${takeId}` (root-relative, allowed by `isAllowedAudioUrl`).
- The STT adapter sets `isFiller: false` on every word. Classification belongs to `alignSegments`. No second `FILLER_LEXICON` anywhere.
- Audio decode failure is never fatal: log, substitute `{ frames: [], frameHopSec: 0.01 }`, continue.
- Every test runs with `STT_PROVIDER=fixture`. No test makes a network call. The Deepgram adapter is tested against a response body embedded in the test.
- Every task must leave the existing 125 tests green: 18 contracts, 104 core-logic, 3 widget.
- Run scripts that import `@nsh/*` with `npx tsx`, never `node --experimental-strip-types` (it fails across the `node_modules` workspace symlink).

---

## Two reconciliations the spec leaves implicit

Both are load-bearing for Task 12 and are resolved once, here, so no task invents its own answer.

**1. `NextStep.executed` must stay `false` on `/api/analyze`.** Spec §6 says `suggest_next_step` "performs the action through a connector and flips the flag". The committed goldens both carry `executed: false`, and the contract says "Never send a real email or write a real calendar entry with executed pre-set to true." Resolution: the tool takes an `execute: boolean` input defaulting to `false`. `decideNextStep` proposes; the connector fires and the flag flips **only** when the caller passes `execute: true`. `pipeline.analyze()` never passes it, so `/api/analyze` proposes and the golden comparison holds. The widget's confirm button calls `POST /api/tools/suggest_next_step` with `execute: true`. `suggest_next_step` remains the only tool that mutates the outside world and the only place `executed` becomes `true`.

**2. The integration test runs with `ENABLE_PROSODY=false`.** `scripts/build-report.mjs` generates both goldens with `const prosody = { frames: [], frameHopSec: 0.01 }`. A real ffmpeg decode of `take-rough.m4a` would populate `meanF0`/`meanRms` on every alignment and can arm the `stress.key-point-rising-pitch` branch, producing a different issue set. Byte-equality against the golden therefore requires the same empty track the golden was built from. This is exactly what `ENABLE_PROSODY=false` is for (spec §11), and it also keeps the test independent of the 80 MB `ffmpeg-static` binary.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/server/package.json` | Workspace manifest, deps, `dev`/`test`/`typecheck` scripts | 1 |
| `apps/server/tsconfig.json` | Extends `tsconfig.base.json`, `types: ["node"]` | 1 |
| `apps/server/vitest.config.ts` | Node env, explicit `@nsh/*` aliases to source | 1 |
| `apps/server/src/config.ts` | The one `process.env` read; Zod schema; boot-time cross-field check | 1 |
| `apps/server/src/errors.ts` | `CoachErrorCode` -> HTTP status table, `mapError` | 2 |
| `apps/server/src/audit.ts` | `Logger`, `createLogger`, `withAudit` (metadata-only audit lines) | 2 |
| `apps/server/src/takes.ts` | Take discovery, id derivation, upload paths, repo-root constants | 3 |
| `apps/server/src/adapters/stt-client.ts` | `FixtureSttClient`, `DeepgramSttClient`, `createSttClient` | 4 |
| `apps/server/src/adapters/audio-decode.ts` | ffmpeg-static decode -> `Float32Array`; graceful degradation | 5 |
| `packages/contracts/fixtures/next-step-context.json` | Shared per-take `NextStepContext` | 6 |
| `scripts/build-report.mjs` | Reads the shared context fixture instead of an inline constant | 6 |
| `apps/server/src/adapters/connectors.ts` | `ContextProvider`, `CalendarConnector`, `GmailConnector` + fixtures | 6 |
| `apps/server/src/tools/parse-script.tool.ts` | Wraps `parseScript` | 7 |
| `apps/server/src/tools/transcribe-delivery.tool.ts` | Wraps `SttClient.transcribe` + prosody -> `DeliverySignal` | 7 |
| `apps/server/src/pipeline.ts` | `ServerDeps` + `createDeps` (Task 7); `analyze()` added (Task 10) | 7, 10 |
| `apps/server/src/tools/correlate-segments.tool.ts` | Wraps `alignSegments` then `correlateSegments` | 8 |
| `apps/server/src/tools/generate-summary.tool.ts` | Wraps `generateSummary` | 8 |
| `apps/server/src/tools/suggest-next-step.tool.ts` | Context read, `decideNextStep`, optional connector write | 9 |
| `apps/server/src/http.ts` | Express app: routes, range requests, upload, error mapping | 11 |
| `apps/server/src/main.ts` | `bootstrap()` + entry guard | 11 |
| `apps/server/src/integration.test.ts` | In-process boot, `POST /api/analyze`, golden deep-equal | 12 |
| `packages/widget/src/App.tsx` | Take picker, upload, live analyze, offline fixture fallback | 13 |
| `packages/widget/vite.config.ts` | `/api` proxy to the server port | 13 |
| `package.json` (root) | `dev` script bringing up server + widget | 14 |
| `README.md` | "Running the demo" section | 14 |

---

### Task 1: Scaffold `apps/server` and `config.ts`

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/src/config.ts`
- Test: `apps/server/src/config.test.ts`
- Modify: `package-lock.json` (via `npm install`)

**Interfaces:**
- Consumes: `CoachError` from `@nsh/core-logic`.
- Produces:
  - `interface AppConfig { port: number; sttProvider: 'fixture' | 'deepgram' | 'assemblyai'; deepgramApiKey: string | undefined; enableProsody: boolean; audioMaxSeconds: number; uploadMaxBytes: number; logLevel: 'debug' | 'info' | 'warn' | 'error' }`
  - `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
  - `getConfig(): AppConfig`
  - `describeConfig(cfg: AppConfig): { sttProvider: string; prosodyEnabled: boolean; deepgramKeyPresent: boolean }`

**Dependencies:** none.

- [ ] **Step 1: Write the failing test**

Create `apps/server/package.json`, `apps/server/tsconfig.json` and `apps/server/vitest.config.ts` first — the test cannot run without a workspace to run in. Their contents are in Step 3 (they are scaffolding, not the unit under test).

`apps/server/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CoachError } from '@nsh/core-logic';
import { describeConfig, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies the documented defaults when the environment is empty', () => {
    const cfg = loadConfig({});
    expect(cfg).toEqual({
      port: 8787,
      sttProvider: 'fixture',
      deepgramApiKey: undefined,
      enableProsody: true,
      audioMaxSeconds: 180,
      uploadMaxBytes: 26_214_400,
      logLevel: 'info',
    });
  });

  it('coerces numeric and boolean environment strings', () => {
    const cfg = loadConfig({
      PORT: '9001',
      ENABLE_PROSODY: 'false',
      AUDIO_MAX_SECONDS: '30',
      UPLOAD_MAX_BYTES: '1024',
      LOG_LEVEL: 'debug',
    });
    expect(cfg.port).toBe(9001);
    expect(cfg.enableProsody).toBe(false);
    expect(cfg.audioMaxSeconds).toBe(30);
    expect(cfg.uploadMaxBytes).toBe(1024);
    expect(cfg.logLevel).toBe('debug');
  });

  it('treats ENABLE_PROSODY=true as enabled', () => {
    expect(loadConfig({ ENABLE_PROSODY: 'true' }).enableProsody).toBe(true);
  });

  it('fails at boot when STT_PROVIDER=deepgram and no key is present', () => {
    let thrown: unknown;
    try {
      loadConfig({ STT_PROVIDER: 'deepgram' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('INTERNAL');
    expect((thrown as CoachError).message).toContain('DEEPGRAM_API_KEY');
  });

  it('accepts STT_PROVIDER=deepgram when a key is present, without exposing it', () => {
    const cfg = loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'dummy-not-a-real-key' });
    expect(cfg.sttProvider).toBe('deepgram');
    expect(typeof cfg.deepgramApiKey).toBe('string');
    // describeConfig is what /api/health and the boot log use — it must report
    // presence only, never the value.
    const described = describeConfig(cfg);
    expect(described).toEqual({ sttProvider: 'deepgram', prosodyEnabled: true, deepgramKeyPresent: true });
    expect(JSON.stringify(described)).not.toContain('dummy-not-a-real-key');
  });

  it('rejects an invalid enum value as a CoachError naming only the key', () => {
    let thrown: unknown;
    try {
      loadConfig({ LOG_LEVEL: 'loud', DEEPGRAM_API_KEY: 'dummy-not-a-real-key' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).message).toContain('LOG_LEVEL');
    expect((thrown as CoachError).message).not.toContain('dummy-not-a-real-key');
  });

  it('ignores unrelated environment variables', () => {
    expect(loadConfig({ PATH: '/usr/bin', HOME: '/root' }).sttProvider).toBe('fixture');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm install && npm test --workspace @nsh/server -- src/config.test.ts`
Expected: FAIL with `Failed to resolve import "./config.js"` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

`apps/server/package.json`:

```json
{
  "name": "@nsh/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/main.ts",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nsh/contracts": "*",
    "@nsh/core-logic": "*",
    "express": "^4.21.2",
    "ffmpeg-static": "^5.2.0",
    "multer": "^1.4.5-lts.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/multer": "^1.4.12"
  }
}
```

`apps/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

`apps/server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Explicit aliases rather than relying on the node_modules workspace symlink,
 * so resolution is identical whether vitest runs from the repo root or from
 * this workspace.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@nsh/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@nsh/core-logic': path.resolve(__dirname, '../../packages/core-logic/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

`apps/server/src/config.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/config.test.ts` then `npm test`
Expected: PASS — 7 new tests in `@nsh/server`; contracts 18, core-logic 104, widget 3 all still green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/tsconfig.json apps/server/vitest.config.ts apps/server/src/config.ts apps/server/src/config.test.ts package-lock.json
git commit -m "feat(server): scaffold apps/server with Zod-validated config"
```

---

### Task 2: `errors.ts` and `audit.ts`

**Files:**
- Create: `apps/server/src/errors.ts`
- Create: `apps/server/src/audit.ts`
- Test: `apps/server/src/errors.test.ts`
- Test: `apps/server/src/audit.test.ts`

**Interfaces:**
- Consumes: `CoachError`, `CoachErrorCode` from `@nsh/core-logic`.
- Produces:
  - `ERROR_STATUS: Record<CoachErrorCode, number>`
  - `GENERIC_MESSAGE: string`
  - `interface ErrorBody { error: { code: string; message: string } }`
  - `interface MappedError { status: number; body: ErrorBody; logMessage: string; logContext: Record<string, unknown> }`
  - `mapError(err: unknown): MappedError`
  - `type LogLevel = 'debug' | 'info' | 'warn' | 'error'`
  - `type Logger = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void`
  - `createLogger(minLevel: LogLevel, sink?: (line: string) => void): Logger`
  - `interface AuditMeta { tool: string; takeId: string | null }`
  - `withAudit<T>(meta: AuditMeta, log: Logger, fn: () => Promise<T> | T): Promise<T>`

**Dependencies:** Task 1 (`AppConfig.logLevel` type shape is mirrored by `LogLevel`; no import needed).

**Deviation from the recommended decomposition, with reason:** `audit.ts` is built here rather than in Task 11 because `Logger` is a parameter type of the adapters and tools in Tasks 5, 7, 9 and 10. Defining it later would mean those tasks declaring a structural duplicate, which is exactly the cross-task type drift the plan must avoid.

- [ ] **Step 1: Write the failing test**

`apps/server/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CoachError, type CoachErrorCode } from '@nsh/core-logic';
import { ERROR_STATUS, GENERIC_MESSAGE, mapError } from './errors.js';

const CASES: Array<[CoachErrorCode, number]> = [
  ['SCRIPT_EMPTY', 400],
  ['SCRIPT_NO_SEGMENTS', 400],
  ['AUDIO_UNREADABLE', 415],
  ['AUDIO_TOO_SHORT', 422],
  ['STT_FAILED', 502],
  ['ALIGNMENT_FAILED', 422],
  ['INTERNAL', 500],
];

describe('mapError', () => {
  it.each(CASES)('maps %s to HTTP %i and echoes the CoachError message', (code, status) => {
    const mapped = mapError(new CoachError(code, `message for ${code}`, { secretish: 'input-fragment' }));
    expect(mapped.status).toBe(status);
    expect(mapped.body).toEqual({ error: { code, message: `message for ${code}` } });
  });

  it('covers every CoachErrorCode in the table with no extras', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual(CASES.map(([code]) => code).sort());
  });

  it('never returns CoachError.context to the client, but does surface it for logging', () => {
    const mapped = mapError(new CoachError('ALIGNMENT_FAILED', 'Recording does not match this script.', { matchRate: 12.5 }));
    expect(JSON.stringify(mapped.body)).not.toContain('matchRate');
    expect(mapped.logContext).toEqual({ matchRate: 12.5 });
  });

  it('turns a raw Error into a 500 with a generic message and never forwards vendor text', () => {
    const mapped = mapError(new Error('deepgram said: quota exceeded for account ACME-1234'));
    expect(mapped.status).toBe(500);
    expect(mapped.body).toEqual({ error: { code: 'INTERNAL', message: GENERIC_MESSAGE } });
    expect(JSON.stringify(mapped.body)).not.toContain('ACME-1234');
    expect(mapped.logMessage).toContain('ACME-1234');
  });

  it('turns a thrown non-Error into a 500 with a generic message', () => {
    const mapped = mapError('kaboom');
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.message).toBe(GENERIC_MESSAGE);
    expect(mapped.logMessage).toBe('kaboom');
  });
});
```

`apps/server/src/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CoachError } from '@nsh/core-logic';
import { createLogger, withAudit, type Logger } from './audit.js';

function recorder(): { log: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const log: Logger = (level, message, meta) => {
    lines.push({ level, message, ...(meta ?? {}) });
  };
  return { log, lines };
}

describe('createLogger', () => {
  it('drops lines below the configured level and emits JSON above it', () => {
    const sunk: string[] = [];
    const log = createLogger('warn', (line) => sunk.push(line));
    log('info', 'ignored.me');
    log('error', 'kept.me', { tool: 'parse_script' });
    expect(sunk).toHaveLength(1);
    const parsed = JSON.parse(sunk[0]!) as Record<string, unknown>;
    expect(parsed['message']).toBe('kept.me');
    expect(parsed['level']).toBe('error');
    expect(parsed['tool']).toBe('parse_script');
    expect(typeof parsed['ts']).toBe('string');
  });
});

describe('withAudit', () => {
  it('emits one ok line carrying tool, takeId and a numeric duration, and returns the value', async () => {
    const { log, lines } = recorder();
    const out = await withAudit({ tool: 'parse_script', takeId: 'rough' }, log, () => 42);
    expect(out).toBe(42);
    expect(lines).toHaveLength(1);
    expect(lines[0]!['tool']).toBe('parse_script');
    expect(lines[0]!['takeId']).toBe('rough');
    expect(lines[0]!['outcome']).toBe('ok');
    expect(typeof lines[0]!['durationMs']).toBe('number');
    expect(lines[0]!['durationMs'] as number).toBeGreaterThanOrEqual(0);
  });

  it('emits an error line with the CoachError code, rethrows, and logs metadata only', async () => {
    const { log, lines } = recorder();
    const boom = new CoachError('STT_FAILED', 'transcript text: good morning I am Sujay', {
      script: 'Most retail teams still reconcile inventory by hand.',
    });

    await expect(withAudit({ tool: 'transcribe_delivery', takeId: 'rough' }, log, async () => {
      throw boom;
    })).rejects.toBe(boom);

    expect(lines).toHaveLength(1);
    expect(lines[0]!['outcome']).toBe('error');
    expect(lines[0]!['errorCode']).toBe('STT_FAILED');
    // Design §12: metadata only — never transcript text, never script content.
    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('good morning');
    expect(serialised).not.toContain('reconcile inventory');
  });

  it('reports UNKNOWN-shaped errors as INTERNAL without leaking the raw message', async () => {
    const { log, lines } = recorder();
    await expect(withAudit({ tool: 'generate_summary', takeId: null }, log, () => {
      throw new Error('vendor said ACME-1234');
    })).rejects.toThrow('vendor said ACME-1234');
    expect(lines[0]!['errorCode']).toBe('INTERNAL');
    expect(JSON.stringify(lines[0])).not.toContain('ACME-1234');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/errors.test.ts src/audit.test.ts`
Expected: FAIL with `Failed to resolve import "./errors.js"` and `Failed to resolve import "./audit.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/errors.ts`:

```ts
// apps/server/src/errors.ts
//
// Design §10. CoachError.code maps to an HTTP status at the tool boundary; a
// raw Error never crosses it. The `context` field is logged, never returned —
// it can carry input fragments.

import { CoachError, type CoachErrorCode } from '@nsh/core-logic';

export const ERROR_STATUS: Record<CoachErrorCode, number> = {
  SCRIPT_EMPTY: 400,
  SCRIPT_NO_SEGMENTS: 400,
  AUDIO_UNREADABLE: 415,
  AUDIO_TOO_SHORT: 422,
  STT_FAILED: 502,
  ALIGNMENT_FAILED: 422,
  INTERNAL: 500,
};

export const GENERIC_MESSAGE = 'Internal server error.';

export interface ErrorBody {
  error: { code: string; message: string };
}

export interface MappedError {
  status: number;
  body: ErrorBody;
  /** Full detail for the server-side log. Never sent to the client. */
  logMessage: string;
  logContext: Record<string, unknown>;
}

export function isCoachError(err: unknown): err is CoachError {
  return err instanceof CoachError;
}

export function mapError(err: unknown): MappedError {
  if (isCoachError(err)) {
    return {
      status: ERROR_STATUS[err.code],
      body: { error: { code: err.code, message: err.message } },
      logMessage: err.message,
      logContext: err.context,
    };
  }

  const detail = err instanceof Error ? err.message : String(err);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: GENERIC_MESSAGE } },
    logMessage: detail,
    logContext: {},
  };
}
```

`apps/server/src/audit.ts`:

```ts
// apps/server/src/audit.ts
//
// Design §12: one audit line per tool call — { tool, takeId, durationMs,
// outcome, errorCode? } — at info level. METADATA ONLY. Never transcript text,
// never script content, never the API key.

import { mapError } from './errors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(
  minLevel: LogLevel,
  sink: (line: string) => void = (line) => console.log(line),
): Logger {
  return (level, message, meta) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, message, ...(meta ?? {}) }));
  };
}

export interface AuditMeta {
  tool: string;
  takeId: string | null;
}

export async function withAudit<T>(
  meta: AuditMeta,
  log: Logger,
  fn: () => Promise<T> | T,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const out = await fn();
    log('info', 'tool.call', {
      tool: meta.tool,
      takeId: meta.takeId,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });
    return out;
  } catch (err) {
    // mapError gives us the stable code without touching the message, so the
    // audit line stays free of user content.
    log('error', 'tool.call', {
      tool: meta.tool,
      takeId: meta.takeId,
      durationMs: Date.now() - startedAt,
      outcome: 'error',
      errorCode: mapError(err).body.error.code,
    });
    throw err;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/errors.test.ts src/audit.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/errors.ts apps/server/src/errors.test.ts apps/server/src/audit.ts apps/server/src/audit.test.ts
git commit -m "feat(server): CoachError HTTP mapping and metadata-only audit logging"
```

---

### Task 3: `takes.ts` — discovery, id derivation, upload paths

**Files:**
- Create: `apps/server/src/takes.ts`
- Test: `apps/server/src/takes.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `REPO_ROOT: string`, `AUDIO_DIR: string`, `UPLOAD_DIR: string`, `FIXTURE_DIR: string`
  - `AUDIO_MIME_BY_EXT: Record<string, string>`
  - `UPLOAD_ID_PREFIX: 'up-'`
  - `interface TakeInfo { id: string; label: string; mimeType: string; hasFrozenTranscript: boolean }`
  - `mimeTypeForFile(filename: string): string | null`
  - `takeIdFromFilename(filename: string): string | null`
  - `labelForTake(takeId: string): string`
  - `frozenTranscriptPath(fixtureDir: string, takeId: string): string | null`
  - `listTakes(audioDir: string, uploadDir: string, fixtureDir: string): TakeInfo[]`
  - `resolveTakeAudio(audioDir: string, uploadDir: string, takeId: string): { path: string; mimeType: string } | null`
  - `uploadTakeId(bytes: Uint8Array): string`
  - `uploadFilenameFor(takeId: string, originalName: string): string | null`

**Dependencies:** none.

**Design notes that later tasks rely on:**
- Uploads are stored as `take-<uploadId><ext>` inside `fixtures/audio/uploads/`, so one filename rule (`take-` prefix) covers staged and uploaded takes and `takeIdFromFilename` needs no special case.
- `uploadTakeId` is `up-` + the first 12 hex chars of the SHA-256 of the bytes. Deterministic, no `Math.random()`, and the prefix makes collision with `rough` or `clean` structurally impossible.
- `listTakes` also surfaces takes that have a frozen transcript but no audio file on disk. `fixtures/audio/*.m4a` is gitignored, so on a fresh clone the audio is absent while `transcript.rough.json` is committed — and with `STT_PROVIDER=fixture` that take is still fully analysable. Without this the integration test and a clean checkout would both see an empty take list.

- [ ] **Step 1: Write the failing test**

`apps/server/src/takes.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_DIR,
  FIXTURE_DIR,
  UPLOAD_ID_PREFIX,
  frozenTranscriptPath,
  labelForTake,
  listTakes,
  mimeTypeForFile,
  resolveTakeAudio,
  takeIdFromFilename,
  uploadFilenameFor,
  uploadTakeId,
} from './takes.js';

function scratch(): { audioDir: string; uploadDir: string; fixtureDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'nsh-takes-'));
  const audioDir = join(root, 'audio');
  const uploadDir = join(audioDir, 'uploads');
  const fixtureDir = join(root, 'fixtures');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });
  return { audioDir, uploadDir, fixtureDir };
}

describe('takeIdFromFilename', () => {
  it('strips the take- prefix and the extension', () => {
    expect(takeIdFromFilename('take-rough.m4a')).toBe('rough');
    expect(takeIdFromFilename('take-clean.wav')).toBe('clean');
    expect(takeIdFromFilename('take-up-0123456789ab.mp3')).toBe('up-0123456789ab');
  });

  it('rejects anything that is not a prefixed audio file', () => {
    expect(takeIdFromFilename('notes.txt')).toBeNull();
    expect(takeIdFromFilename('rough.m4a')).toBeNull();
    expect(takeIdFromFilename('take-rough.txt')).toBeNull();
    expect(takeIdFromFilename('take-.m4a')).toBeNull();
    expect(takeIdFromFilename('uploads')).toBeNull();
  });
});

describe('mimeTypeForFile', () => {
  it('maps the supported containers and rejects the rest', () => {
    expect(mimeTypeForFile('x.m4a')).toBe('audio/mp4');
    expect(mimeTypeForFile('x.WAV')).toBe('audio/wav');
    expect(mimeTypeForFile('x.webm')).toBe('audio/webm');
    expect(mimeTypeForFile('x.aiff')).toBeNull();
  });
});

describe('labelForTake', () => {
  it('title-cases a staged id and marks an upload as one', () => {
    expect(labelForTake('rough')).toBe('Rough take');
    expect(labelForTake('clean')).toBe('Clean take');
    expect(labelForTake('up-0123456789ab')).toBe('Upload 0123456789ab');
  });
});

describe('uploadTakeId', () => {
  it('is deterministic, content-addressed, and cannot collide with a staged id', () => {
    const a = uploadTakeId(new Uint8Array([1, 2, 3]));
    const b = uploadTakeId(new Uint8Array([1, 2, 3]));
    const c = uploadTakeId(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith(UPLOAD_ID_PREFIX)).toBe(true);
    expect(a).toHaveLength(UPLOAD_ID_PREFIX.length + 12);
    expect(a).not.toBe('rough');
    expect(a).not.toBe('clean');
  });
});

describe('uploadFilenameFor', () => {
  it('keeps the original container extension and re-applies the take- prefix', () => {
    expect(uploadFilenameFor('up-abc123abc123', 'my recording.M4A')).toBe('take-up-abc123abc123.m4a');
    expect(uploadFilenameFor('up-abc123abc123', 'clip.webm')).toBe('take-up-abc123abc123.webm');
  });

  it('rejects an unsupported container', () => {
    expect(uploadFilenameFor('up-abc123abc123', 'clip.aiff')).toBeNull();
  });

  it('round-trips through takeIdFromFilename', () => {
    const id = uploadTakeId(new Uint8Array([9, 9, 9]));
    const filename = uploadFilenameFor(id, 'clip.mp3');
    expect(filename).not.toBeNull();
    expect(takeIdFromFilename(filename!)).toBe(id);
  });
});

describe('listTakes', () => {
  it('discovers staged audio, uploads, and transcript-only takes, sorted by id', () => {
    const { audioDir, uploadDir, fixtureDir } = scratch();
    writeFileSync(join(audioDir, 'take-rough.m4a'), 'x');
    writeFileSync(join(audioDir, 'README.md'), 'ignored');
    writeFileSync(join(uploadDir, 'take-up-0123456789ab.mp3'), 'x');
    writeFileSync(join(fixtureDir, 'transcript.rough.json'), '{}');
    writeFileSync(join(fixtureDir, 'transcript.clean.json'), '{}');

    const takes = listTakes(audioDir, uploadDir, fixtureDir);
    expect(takes.map((t) => t.id)).toEqual(['clean', 'rough', 'up-0123456789ab']);
    expect(takes.find((t) => t.id === 'rough')).toEqual({
      id: 'rough',
      label: 'Rough take',
      mimeType: 'audio/mp4',
      hasFrozenTranscript: true,
    });
    // clean has a frozen transcript but no audio file — still analysable.
    expect(takes.find((t) => t.id === 'clean')!.hasFrozenTranscript).toBe(true);
    expect(takes.find((t) => t.id === 'up-0123456789ab')!.hasFrozenTranscript).toBe(false);
  });

  it('returns an empty list rather than throwing when the directories are absent', () => {
    expect(listTakes('/nope/audio', '/nope/audio/uploads', '/nope/fixtures')).toEqual([]);
  });
});

describe('resolveTakeAudio', () => {
  it('finds staged and uploaded files and returns their mime type', () => {
    const { audioDir, uploadDir } = scratch();
    writeFileSync(join(audioDir, 'take-rough.m4a'), 'x');
    writeFileSync(join(uploadDir, 'take-up-0123456789ab.mp3'), 'x');

    expect(resolveTakeAudio(audioDir, uploadDir, 'rough')).toEqual({
      path: join(audioDir, 'take-rough.m4a'),
      mimeType: 'audio/mp4',
    });
    expect(resolveTakeAudio(audioDir, uploadDir, 'up-0123456789ab')).toEqual({
      path: join(uploadDir, 'take-up-0123456789ab.mp3'),
      mimeType: 'audio/mpeg',
    });
    expect(resolveTakeAudio(audioDir, uploadDir, 'missing')).toBeNull();
  });
});

describe('repo-relative constants', () => {
  it('point at the real directories the server serves from', () => {
    expect(AUDIO_DIR.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio$/);
    expect(FIXTURE_DIR.replace(/\\/g, '/')).toMatch(/\/packages\/contracts\/fixtures$/);
    // The committed transcripts must be reachable from FIXTURE_DIR — everything
    // downstream (fixture STT, golden comparison) depends on this resolving.
    expect(frozenTranscriptPath(FIXTURE_DIR, 'rough')).not.toBeNull();
    expect(frozenTranscriptPath(FIXTURE_DIR, 'clean')).not.toBeNull();
    expect(frozenTranscriptPath(FIXTURE_DIR, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/takes.test.ts`
Expected: FAIL with `Failed to resolve import "./takes.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/takes.ts`:

```ts
// apps/server/src/takes.ts
//
// Design §7. A staged take's id is its filename with the `take-` prefix and the
// extension removed: fixtures/audio/take-rough.m4a -> "rough". That single
// identifier is what makes rpt-demo-rough and transcript.rough.json line up.
//
// Uploads are written as take-<uploadId><ext> under fixtures/audio/uploads/, so
// the same filename rule covers both and the `up-` prefix on the id makes a
// collision with "rough" or "clean" structurally impossible.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/server/src -> apps/server -> apps -> repo root. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const AUDIO_DIR = join(REPO_ROOT, 'fixtures', 'audio');
export const UPLOAD_DIR = join(AUDIO_DIR, 'uploads');
export const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'contracts', 'fixtures');

/** Lifted verbatim from scripts/transcribe.mjs so both agree on what we accept. */
export const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
};

export const UPLOAD_ID_PREFIX = 'up-';

const TAKE_PREFIX = 'take-';

export interface TakeInfo {
  id: string;
  label: string;
  mimeType: string;
  hasFrozenTranscript: boolean;
}

export function mimeTypeForFile(filename: string): string | null {
  return AUDIO_MIME_BY_EXT[extname(filename).toLowerCase()] ?? null;
}

export function takeIdFromFilename(filename: string): string | null {
  if (!filename.startsWith(TAKE_PREFIX)) return null;
  if (mimeTypeForFile(filename) === null) return null;
  const id = filename.slice(TAKE_PREFIX.length, filename.length - extname(filename).length);
  return id.length === 0 ? null : id;
}

export function labelForTake(takeId: string): string {
  if (takeId.startsWith(UPLOAD_ID_PREFIX)) {
    return `Upload ${takeId.slice(UPLOAD_ID_PREFIX.length)}`;
  }
  const head = takeId.slice(0, 1).toUpperCase();
  return `${head}${takeId.slice(1)} take`;
}

export function frozenTranscriptPath(fixtureDir: string, takeId: string): string | null {
  const path = join(fixtureDir, `transcript.${takeId}.json`);
  return existsSync(path) ? path : null;
}

function entriesOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

export function listTakes(audioDir: string, uploadDir: string, fixtureDir: string): TakeInfo[] {
  const out: TakeInfo[] = [];
  const seen = new Set<string>();

  for (const dir of [audioDir, uploadDir]) {
    for (const entry of entriesOf(dir)) {
      const id = takeIdFromFilename(entry);
      const mimeType = mimeTypeForFile(entry);
      if (id === null || mimeType === null || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: labelForTake(id),
        mimeType,
        hasFrozenTranscript: frozenTranscriptPath(fixtureDir, id) !== null,
      });
    }
  }

  // fixtures/audio/*.m4a is gitignored, so on a fresh clone the recordings are
  // absent while the frozen transcripts are committed. With STT_PROVIDER=fixture
  // those takes analyse perfectly well, so they must appear in the picker.
  for (const entry of entriesOf(fixtureDir)) {
    const match = /^transcript\.(.+)\.json$/.exec(entry);
    const id = match?.[1];
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: labelForTake(id), mimeType: 'audio/mp4', hasFrozenTranscript: true });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveTakeAudio(
  audioDir: string,
  uploadDir: string,
  takeId: string,
): { path: string; mimeType: string } | null {
  for (const dir of [audioDir, uploadDir]) {
    for (const entry of entriesOf(dir)) {
      if (takeIdFromFilename(entry) !== takeId) continue;
      const mimeType = mimeTypeForFile(entry);
      if (mimeType === null) continue;
      return { path: join(dir, entry), mimeType };
    }
  }
  return null;
}

/** Content-addressed and deterministic — design §17 keeps Math.random() out. */
export function uploadTakeId(bytes: Uint8Array): string {
  return UPLOAD_ID_PREFIX + createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

export function uploadFilenameFor(takeId: string, originalName: string): string | null {
  const ext = extname(originalName).toLowerCase();
  if (!(ext in AUDIO_MIME_BY_EXT)) return null;
  return `${TAKE_PREFIX}${takeId}${ext}`;
}
```

Append to `.gitignore`, immediately after the existing `!fixtures/audio/.gitkeep` line:

```gitignore
# Uploaded takes are content-addressed and regenerated on demand. The extension
# globs above do not cross a directory separator, so this needs its own line.
fixtures/audio/uploads/
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/takes.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/takes.ts apps/server/src/takes.test.ts .gitignore
git commit -m "feat(server): take discovery, id derivation and upload storage paths"
```

---

### Task 4: `adapters/stt-client.ts`

**Files:**
- Create: `apps/server/src/adapters/stt-client.ts`
- Test: `apps/server/src/adapters/stt-client.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from `./config.js` (Task 1); `FIXTURE_DIR`, `frozenTranscriptPath` from `./takes.js` (Task 3).
- Produces:
  - `DEEPGRAM_URL: string`, `DEEPGRAM_QUERY: Record<string, string>`
  - `class FixtureSttClient implements SttClient { readonly provider: 'fixture'; constructor(fixtureDir: string, takeId: string); transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript> }`
  - `class DeepgramSttClient implements SttClient { readonly provider: 'deepgram'; constructor(apiKey: string, fetchImpl?: typeof fetch); transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript> }`
  - `createSttClient(cfg: AppConfig, takeId: string, fixtureDir: string): SttClient`

**Dependencies:** Task 1 (`AppConfig`), Task 3 (`frozenTranscriptPath`).

**Design notes:**
- The frozen `SttClient` interface has no `takeId` parameter, so the fixture client takes it in its constructor and `createSttClient` is called per request with the take id. The interface is not touched.
- Every word gets `isFiller: false`. `alignSegments` is the only component that can tell a hedge from a legitimate use, so the adapter never classifies (design §5.1). P2's second lexicon is deleted, not ported.
- Vendor error text is never forwarded to the client (design §10), so the `CoachError` message names the status only.

- [ ] **Step 1: Write the failing test**

`apps/server/src/adapters/stt-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CoachError } from '@nsh/core-logic';
import { FILLER_LEXICON, Transcript } from '@nsh/contracts';
import { loadConfig } from '../config.js';
import { FIXTURE_DIR } from '../takes.js';
import { DeepgramSttClient, FixtureSttClient, createSttClient } from './stt-client.js';

const TEST_KEY = 'dummy-not-a-real-key';

/**
 * A recorded Deepgram response body. Never a live call — design §14. The values
 * are chosen to exercise the 3dp rounding at this boundary.
 */
const RECORDED_BODY = {
  metadata: { duration: 12.3456 },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'good morning um',
            words: [
              { word: 'good', start: 0.0799999, end: 0.5200001, confidence: 0.9994999 },
              { word: 'morning', start: 0.5200001, end: 1.0004999, confidence: 0.87654 },
              { word: 'um', start: 1.2345678, end: 1.4999999, confidence: 0.5 },
            ],
          },
        ],
      },
    ],
  },
};

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(response: Response, captured: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
}

describe('FixtureSttClient', () => {
  it('replays the frozen rough transcript exactly', async () => {
    const client = new FixtureSttClient(FIXTURE_DIR, 'rough');
    const transcript = await client.transcribe(new Uint8Array(0), 'audio/mp4');
    expect(client.provider).toBe('fixture');
    expect(transcript.words).toHaveLength(91);
    expect(transcript.durationSec).toBe(38.72);
    // The file records who actually produced it; the CLIENT is the fixture.
    expect(transcript.provider).toBe('deepgram');
    expect(Transcript.safeParse(transcript).success).toBe(true);
  });

  it('replays the frozen clean transcript exactly', async () => {
    const transcript = await new FixtureSttClient(FIXTURE_DIR, 'clean').transcribe(new Uint8Array(0), 'audio/mp4');
    expect(transcript.words).toHaveLength(86);
    expect(transcript.durationSec).toBe(40.853);
  });

  it('raises STT_FAILED when no frozen transcript exists for the take', async () => {
    const client = new FixtureSttClient(FIXTURE_DIR, 'no-such-take');
    await expect(client.transcribe(new Uint8Array(0), 'audio/mp4')).rejects.toMatchObject({
      name: 'CoachError',
      code: 'STT_FAILED',
    });
  });
});

describe('DeepgramSttClient', () => {
  it('posts raw container bytes with the file mime type and the frozen query params', async () => {
    const captured: Captured[] = [];
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(RECORDED_BODY), { status: 200 }), captured),
    );
    const bytes = new Uint8Array([0, 1, 2, 3]);
    await client.transcribe(bytes, 'audio/mp4');

    expect(captured).toHaveLength(1);
    const url = new URL(captured[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/listen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: 'nova-3',
      filler_words: 'true',
      punctuate: 'true',
      smart_format: 'false',
      numerals: 'false',
    });

    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(captured[0]!.init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('audio/mp4');
    expect(headers['Authorization']!.startsWith('Token ')).toBe(true);
    // The key belongs in the header and nowhere else.
    expect(captured[0]!.url).not.toContain(TEST_KEY);
    expect(captured[0]!.init.body).toBe(bytes);
  });

  it('rounds every vendor number to 3dp at this boundary and never converts again', async () => {
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(RECORDED_BODY), { status: 200 }), []),
    );
    const transcript = await client.transcribe(new Uint8Array([0]), 'audio/mp4');

    expect(transcript.provider).toBe('deepgram');
    expect(transcript.durationSec).toBe(12.346);
    expect(transcript.words).toEqual([
      { text: 'good', start: 0.08, end: 0.52, confidence: 0.999, isFiller: false },
      { text: 'morning', start: 0.52, end: 1, confidence: 0.877, isFiller: false },
      { text: 'um', start: 1.235, end: 1.5, confidence: 0.5, isFiller: false },
    ]);
    expect(Transcript.safeParse(transcript).success).toBe(true);
  });

  it('leaves filler classification to alignSegments', async () => {
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(RECORDED_BODY), { status: 200 }), []),
    );
    const transcript = await client.transcribe(new Uint8Array([0]), 'audio/mp4');
    const um = transcript.words.find((w) => w.text === 'um');
    // "um" IS in the contract's lexicon; the adapter must still not tag it.
    expect(FILLER_LEXICON).toContain('um');
    expect(um!.isFiller).toBe(false);
    expect(transcript.words.every((w) => w.isFiller === false)).toBe(true);
  });

  it('maps a non-ok response to STT_FAILED without forwarding vendor text', async () => {
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response('quota exceeded for account ACME-1234', { status: 503 }), []),
    );
    let thrown: unknown;
    try {
      await client.transcribe(new Uint8Array([0]), 'audio/mp4');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('STT_FAILED');
    expect((thrown as CoachError).message).toContain('503');
    expect((thrown as CoachError).message).not.toContain('ACME-1234');
  });

  it('maps a transport failure to STT_FAILED', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new DeepgramSttClient(TEST_KEY, failing).transcribe(new Uint8Array([0]), 'audio/mp4'),
    ).rejects.toMatchObject({ name: 'CoachError', code: 'STT_FAILED' });
  });

  it('maps an empty word list to STT_FAILED', async () => {
    const empty = { metadata: { duration: 3 }, results: { channels: [{ alternatives: [{ words: [] }] }] } };
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(empty), { status: 200 }), []),
    );
    await expect(client.transcribe(new Uint8Array([0]), 'audio/mp4')).rejects.toMatchObject({
      name: 'CoachError',
      code: 'STT_FAILED',
    });
  });

  it('falls back to the last word end when metadata.duration is absent', async () => {
    const noDuration = {
      results: { channels: [{ alternatives: [{ words: [{ word: 'hi', start: 0, end: 7.7777 }] }] }] },
    };
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(noDuration), { status: 200 }), []),
    );
    const transcript = await client.transcribe(new Uint8Array([0]), 'audio/mp4');
    expect(transcript.durationSec).toBe(7.778);
    expect(transcript.words[0]!.confidence).toBe(0);
  });
});

describe('createSttClient', () => {
  it('returns the fixture client under the default configuration', () => {
    const client = createSttClient(loadConfig({}), 'rough', FIXTURE_DIR);
    expect(client).toBeInstanceOf(FixtureSttClient);
    expect(client.provider).toBe('fixture');
  });

  it('returns the deepgram client when configured with a key', () => {
    const cfg = loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: TEST_KEY });
    const client = createSttClient(cfg, 'rough', FIXTURE_DIR);
    expect(client).toBeInstanceOf(DeepgramSttClient);
    expect(client.provider).toBe('deepgram');
  });

  it('raises INTERNAL rather than constructing a keyless deepgram client', () => {
    // loadConfig blocks this, so reach past it to prove the factory guards too.
    const cfg = { ...loadConfig({}), sttProvider: 'deepgram' as const, deepgramApiKey: undefined };
    expect(() => createSttClient(cfg, 'rough', FIXTURE_DIR)).toThrow(CoachError);
  });

  it('raises INTERNAL for the unimplemented assemblyai branch', () => {
    const cfg = { ...loadConfig({}), sttProvider: 'assemblyai' as const };
    let thrown: unknown;
    try {
      createSttClient(cfg, 'rough', FIXTURE_DIR);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('INTERNAL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/adapters/stt-client.test.ts`
Expected: FAIL with `Failed to resolve import "./stt-client.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/adapters/stt-client.ts`:

```ts
// apps/server/src/adapters/stt-client.ts
//
// Implements the frozen SttClient interface from @nsh/contracts exactly.
//
// DeepgramSttClient posts the RAW CONTAINER BYTES with the file's mime type —
// no decoding. That is the path already proven against real audio by
// scripts/transcribe.mjs, and the query params below are lifted from it
// unchanged. smart_format and numerals must stay off: both rewrite spoken
// numbers into digits, which destroys text matching against the script.
//
// This adapter does NOT classify fillers. It sets isFiller:false on every word
// and leaves classification to alignSegments, the only component that can tell
// a hedge from the same word used legitimately (design §5.1). There is exactly
// one FILLER_LEXICON in this repo and it lives in @nsh/contracts.

import { readFile } from 'node:fs/promises';
import { Transcript, type SttClient, type Word } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import type { AppConfig } from '../config.js';
import { frozenTranscriptPath } from '../takes.js';

export const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

/** Verbatim from scripts/transcribe.mjs. Do not "modernise" these. */
export const DEEPGRAM_QUERY: Record<string, string> = {
  model: 'nova-3',
  filler_words: 'true',
  punctuate: 'true',
  smart_format: 'false',
  numerals: 'false',
};

/** Deepgram returns seconds already. Round once, here, and never convert again. */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

interface DeepgramBody {
  metadata?: { duration?: number };
  results?: { channels?: Array<{ alternatives?: Array<{ words?: DeepgramWord[] }> }> };
}

export class FixtureSttClient implements SttClient {
  readonly provider = 'fixture';

  constructor(
    private readonly fixtureDir: string,
    private readonly takeId: string,
  ) {}

  async transcribe(_audio: Uint8Array, _mimeType: string): Promise<Transcript> {
    const path = frozenTranscriptPath(this.fixtureDir, this.takeId);
    if (path === null) {
      throw new CoachError('STT_FAILED', `No frozen transcript for take "${this.takeId}".`, {
        takeId: this.takeId,
      });
    }
    const raw = await readFile(path, 'utf8');
    const parsed = Transcript.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new CoachError('STT_FAILED', `Frozen transcript for take "${this.takeId}" does not match the contract.`, {
        takeId: this.takeId,
        issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

export class DeepgramSttClient implements SttClient {
  readonly provider = 'deepgram';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript> {
    const url = `${DEEPGRAM_URL}?${new URLSearchParams(DEEPGRAM_QUERY).toString()}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': mimeType,
        },
        body: audio,
      });
    } catch (cause) {
      throw new CoachError('STT_FAILED', 'Speech provider request failed.', {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    if (!res.ok) {
      // Vendor error text is never forwarded to the client (design §10).
      throw new CoachError('STT_FAILED', `Speech provider returned HTTP ${res.status}.`, {
        status: res.status,
      });
    }

    const body = (await res.json()) as DeepgramBody;
    const words = body.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
    if (words.length === 0) {
      throw new CoachError('STT_FAILED', 'Speech provider returned no words.');
    }

    const mapped: Word[] = words.map((w) => ({
      text: w.word,
      start: r3(w.start),
      end: r3(w.end),
      confidence: Math.round((w.confidence ?? 0) * 1000) / 1000,
      isFiller: false,
    }));

    const lastEnd = mapped[mapped.length - 1]!.end;
    const transcript: Transcript = {
      provider: this.provider,
      durationSec: r3(body.metadata?.duration ?? lastEnd),
      words: mapped,
    };

    const parsed = Transcript.safeParse(transcript);
    if (!parsed.success) {
      throw new CoachError('STT_FAILED', 'Speech provider response did not map to a valid transcript.', {
        issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

/**
 * The only place STT_PROVIDER is branched on. `takeId` exists for the fixture
 * client, which selects transcript.<takeId>.json; the real client ignores it.
 */
export function createSttClient(cfg: AppConfig, takeId: string, fixtureDir: string): SttClient {
  switch (cfg.sttProvider) {
    case 'fixture':
      return new FixtureSttClient(fixtureDir, takeId);
    case 'deepgram':
      if (cfg.deepgramApiKey === undefined) {
        throw new CoachError('INTERNAL', 'STT_PROVIDER=deepgram requires DEEPGRAM_API_KEY to be set.');
      }
      return new DeepgramSttClient(cfg.deepgramApiKey);
    case 'assemblyai':
      throw new CoachError('INTERNAL', 'AssemblyAI adapter is not implemented; use deepgram or fixture.');
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/adapters/stt-client.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged. No network access occurs.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/adapters/stt-client.ts apps/server/src/adapters/stt-client.test.ts
git commit -m "feat(server): fixture and Deepgram STT adapters behind the frozen interface"
```

---

### Task 5: `adapters/audio-decode.ts`

**Files:**
- Create: `apps/server/src/adapters/audio-decode.ts`
- Test: `apps/server/src/adapters/audio-decode.test.ts`

**Interfaces:**
- Consumes: `Logger` from `../audit.js` (Task 2); `extractProsody` from `@nsh/core-logic`.
- Produces:
  - `PROSODY_SAMPLE_RATE: 16000`
  - `PROSODY_HOP_SEC: 0.01`
  - `emptyProsody(): ProsodyTrack`
  - `type DecodeFn = (filePath: string) => Promise<Float32Array>`
  - `decodeWithFfmpeg(filePath: string, ffmpegBinary?: string | null): Promise<Float32Array>`
  - `interface ProsodyRequest { filePath: string | null; enabled: boolean; decode?: DecodeFn; log?: Logger }`
  - `prosodyForFile(req: ProsodyRequest): Promise<ProsodyTrack>`

**Dependencies:** Task 2 (`Logger`).

**Design notes:**
- `prosodyForFile` takes an injectable `decode`, so every degradation path is tested without ffmpeg installed and no test shells out.
- Decode failure is never fatal (design §5.2): log and substitute an empty track. Every rule that currently fires derives from word timings alone; prosody feeds only the untested `stress.key-point-rising-pitch` branch.
- `emptyProsody()` is a factory, not a shared frozen constant, so two concurrent requests can never alias the same object.
- ffmpeg is asked for `f32le` directly, so no int16 conversion step exists to get wrong. The bytes are copied into a fresh `ArrayBuffer` because `Buffer.concat` gives no 4-byte alignment guarantee.

- [ ] **Step 1: Write the failing test**

`apps/server/src/adapters/audio-decode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractProsody } from '@nsh/core-logic';
import type { Logger } from '../audit.js';
import {
  PROSODY_HOP_SEC,
  PROSODY_SAMPLE_RATE,
  emptyProsody,
  prosodyForFile,
  type DecodeFn,
} from './audio-decode.js';

/** 6s of a 200 Hz tone at 16 kHz — comfortably over THRESHOLDS.minAudioSec (5). */
function tone(seconds: number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * PROSODY_SAMPLE_RATE));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / PROSODY_SAMPLE_RATE);
  }
  return pcm;
}

function recorder(): { log: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const log: Logger = (level, message, meta) => lines.push({ level, message, ...(meta ?? {}) });
  return { log, lines };
}

describe('emptyProsody', () => {
  it('is the exact track the golden fixtures were generated from', () => {
    expect(emptyProsody()).toEqual({ frames: [], frameHopSec: PROSODY_HOP_SEC });
    expect(PROSODY_HOP_SEC).toBe(0.01);
  });

  it('returns a fresh object each call so concurrent requests cannot alias', () => {
    expect(emptyProsody()).not.toBe(emptyProsody());
  });
});

describe('prosodyForFile', () => {
  it('produces a real track from decoded PCM, identical to calling extractProsody directly', async () => {
    const pcm = tone(6);
    const decode: DecodeFn = async () => pcm;
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode });

    expect(track.frames.length).toBeGreaterThan(0);
    expect(track.frameHopSec).toBe(PROSODY_HOP_SEC);
    expect(track.frames.some((f) => f.f0 !== null)).toBe(true);
    // The adapter adds nothing of its own — it is extractProsody plus I/O.
    expect(track).toEqual(extractProsody(pcm, PROSODY_SAMPLE_RATE));
  });

  it('skips decoding entirely when prosody is disabled', async () => {
    let calls = 0;
    const decode: DecodeFn = async () => {
      calls += 1;
      return tone(6);
    };
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: false, decode });
    expect(calls).toBe(0);
    expect(track).toEqual(emptyProsody());
  });

  it('returns an empty track when there is no audio file to decode', async () => {
    let calls = 0;
    const decode: DecodeFn = async () => {
      calls += 1;
      return tone(6);
    };
    const track = await prosodyForFile({ filePath: null, enabled: true, decode });
    expect(calls).toBe(0);
    expect(track).toEqual(emptyProsody());
  });

  it('degrades to an empty track and logs when the decoder fails', async () => {
    const { log, lines } = recorder();
    const decode: DecodeFn = async () => {
      throw new Error('ffmpeg-static binary missing for this platform');
    };
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode, log });

    expect(track).toEqual(emptyProsody());
    expect(lines).toHaveLength(1);
    expect(lines[0]!['level']).toBe('warn');
    expect(lines[0]!['message']).toBe('prosody.degraded');
    expect(String(lines[0]!['reason'])).toContain('ffmpeg-static');
  });

  it('degrades to an empty track when the recording is too short for extractProsody', async () => {
    const { log, lines } = recorder();
    // 1s < THRESHOLDS.minAudioSec, so extractProsody throws AUDIO_TOO_SHORT.
    const decode: DecodeFn = async () => tone(1);
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode, log });
    expect(track).toEqual(emptyProsody());
    expect(lines[0]!['errorCode']).toBe('AUDIO_TOO_SHORT');
  });

  it('never throws, whatever the decoder does', async () => {
    const decode: DecodeFn = async () => {
      throw 'not even an Error';
    };
    await expect(prosodyForFile({ filePath: '/x.m4a', enabled: true, decode })).resolves.toEqual(emptyProsody());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/adapters/audio-decode.test.ts`
Expected: FAIL with `Failed to resolve import "./audio-decode.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/adapters/audio-decode.ts`:

```ts
// apps/server/src/adapters/audio-decode.ts
//
// ffmpeg-static decodes any input container to 16 kHz mono Float32Array. This
// exists solely to feed extractProsody, whose signature is
// (pcm: Float32Array, sampleRate: number).
//
// DECODE FAILURE IS NOT FATAL (design §5.2). If ffmpeg is missing or the
// container is unreadable we log it, substitute an empty ProsodyTrack, and the
// pipeline continues. Every rule that currently fires — stress, filler, pause,
// pacing — derives from word timings alone; prosody feeds only the untested
// stress.key-point-rising-pitch branch. A missing binary must never take down
// the demo.

import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { ProsodyTrack } from '@nsh/contracts';
import { CoachError, extractProsody } from '@nsh/core-logic';
import type { Logger } from '../audit.js';

export const PROSODY_SAMPLE_RATE = 16_000;

/** Matches core-logic's HOP_SEC and the track the golden fixtures were built from. */
export const PROSODY_HOP_SEC = 0.01;

export function emptyProsody(): ProsodyTrack {
  return { frames: [], frameHopSec: PROSODY_HOP_SEC };
}

export type DecodeFn = (filePath: string) => Promise<Float32Array>;

export function decodeWithFfmpeg(
  filePath: string,
  ffmpegBinary: string | null = ffmpegStatic,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    if (ffmpegBinary === null) {
      reject(new CoachError('AUDIO_UNREADABLE', 'ffmpeg-static provided no binary for this platform.'));
      return;
    }

    // f32le straight out of ffmpeg: no int16 conversion step to get wrong.
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', filePath,
      '-ac', '1',
      '-ar', String(PROSODY_SAMPLE_RATE),
      '-f', 'f32le',
      'pipe:1',
    ];

    const child = spawn(ffmpegBinary, args);
    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (cause) => {
      reject(new CoachError('AUDIO_UNREADABLE', 'ffmpeg failed to start.', { cause: cause.message }));
    });

    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new CoachError('AUDIO_UNREADABLE', `ffmpeg exited with code ${exitCode}.`, { stderr }));
        return;
      }
      const buf = Buffer.concat(chunks);
      // Buffer.concat gives no 4-byte alignment guarantee, so copy into a fresh
      // ArrayBuffer rather than viewing the pooled one.
      const usable = buf.byteLength - (buf.byteLength % 4);
      const ab = new ArrayBuffer(usable);
      new Uint8Array(ab).set(buf.subarray(0, usable));
      resolve(new Float32Array(ab));
    });
  });
}

export interface ProsodyRequest {
  filePath: string | null;
  enabled: boolean;
  decode?: DecodeFn;
  log?: Logger;
}

export async function prosodyForFile(req: ProsodyRequest): Promise<ProsodyTrack> {
  if (!req.enabled || req.filePath === null) return emptyProsody();

  const decode = req.decode ?? ((path: string) => decodeWithFfmpeg(path));
  try {
    const pcm = await decode(req.filePath);
    return extractProsody(pcm, PROSODY_SAMPLE_RATE);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const errorCode = err instanceof CoachError ? err.code : 'DECODE_FAILED';
    req.log?.('warn', 'prosody.degraded', { errorCode, reason });
    return emptyProsody();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/adapters/audio-decode.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/adapters/audio-decode.ts apps/server/src/adapters/audio-decode.test.ts
git commit -m "feat(server): ffmpeg prosody decode with graceful degradation"
```

---

### Task 6: Shared next-step context fixture, then `adapters/connectors.ts`

**Files:**
- Create: `packages/contracts/fixtures/next-step-context.json`
- Modify: `scripts/build-report.mjs`
- Create: `apps/server/src/adapters/connectors.ts`
- Test: `apps/server/src/adapters/connectors.test.ts`

**Interfaces:**
- Consumes: `FIXTURE_DIR` from `../takes.js` (Task 3); `NextStepContext` from `@nsh/contracts`.
- Produces:
  - `interface ContextProvider { nextStepContext(takeId: string, now: string): Promise<NextStepContext> }`
  - `interface CalendarConnector { createReminder(title: string, startsAt: string): Promise<{ id: string }> }`
  - `interface GmailConnector { draft(subject: string, body: string, to: string | null): Promise<{ id: string }> }`
  - `class FixtureContextProvider implements ContextProvider { constructor(fixtureDir: string) }`
  - `class FixtureCalendarConnector implements CalendarConnector { constructor(log?: Logger) }`
  - `class FixtureGmailConnector implements GmailConnector { constructor(log?: Logger) }`
  - `NEUTRAL_CONTEXT: Omit<NextStepContext, 'now'>`

**Dependencies:** Task 2 (`Logger`), Task 3 (`FIXTURE_DIR`).

**Design notes:**
- `knownMentor` is not a calendar fact, so it does not sit on `CalendarConnector`. `ContextProvider` owns assembling the whole `NextStepContext`; under real MCP composition it fans out, as a fixture it reads the JSON keyed by take id.
- The request's `now` always wins over the fixture's `now`. The fixture's field is the recorded default that `build-report.mjs` uses; the provider overlays whatever the caller pinned so `/api/analyze?now=` stays authoritative.
- An unknown take id (any upload) gets `NEUTRAL_CONTEXT` — no events, no mentor — which `decideNextStep` turns into a `draft_note`. Uploads therefore still get a closing action.
- Fixture writers return a deterministic synthetic id derived from the payload hash, not `Date.now()`, so nothing in this file can make a report non-reproducible.

- [ ] **Step 1: Write the failing test**

`apps/server/src/adapters/connectors.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextStepContext, type DeliveryReport } from '@nsh/contracts';
import { decideNextStep } from '@nsh/core-logic';
import type { Logger } from '../audit.js';
import { FIXTURE_DIR } from '../takes.js';
import {
  FixtureCalendarConnector,
  FixtureContextProvider,
  FixtureGmailConnector,
  NEUTRAL_CONTEXT,
} from './connectors.js';

const loadReport = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

describe('FixtureContextProvider', () => {
  it('returns a contract-valid context for each staged take', async () => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    for (const takeId of ['rough', 'clean']) {
      const ctx = await provider.nextStepContext(takeId, '2026-07-25T09:00:00Z');
      expect(NextStepContext.safeParse(ctx).success).toBe(true);
    }
  });

  /**
   * The extraction is only correct if the values still drive the committed
   * reports. Feeding the fixture context back through decideNextStep must
   * reproduce each golden report's nextStep exactly — that is a stronger check
   * than eyeballing the JSON, and it cannot pass on a hand-guessed constant.
   */
  it.each(['rough', 'clean'])('reproduces report.%s.json nextStep exactly', async (label) => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    const golden = loadReport(label);
    const ctx = await provider.nextStepContext(label, '2026-07-25T09:00:00Z');
    expect(decideNextStep(golden, ctx)).toEqual(golden.nextStep);
  });

  it('lets the caller pin `now`, overriding the value recorded in the fixture', async () => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    const ctx = await provider.nextStepContext('rough', '2030-01-01T00:00:00Z');
    expect(ctx.now).toBe('2030-01-01T00:00:00Z');
    // The rough take's event is in 2026, so pinning `now` past it changes the
    // branch — proof the override is real and not cosmetic.
    expect(decideNextStep(loadReport('rough'), ctx).kind).toBe('draft_note');
  });

  it('gives an unknown take a neutral context so uploads still get a next step', async () => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    const ctx = await provider.nextStepContext('up-0123456789ab', '2026-07-25T09:00:00Z');
    expect(ctx).toEqual({ ...NEUTRAL_CONTEXT, now: '2026-07-25T09:00:00Z' });
    expect(decideNextStep(loadReport('rough'), ctx).kind).toBe('draft_note');
  });
});

describe('fixture writers', () => {
  it('returns a deterministic calendar id and logs metadata only', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const log: Logger = (level, message, meta) => lines.push({ level, message, ...(meta ?? {}) });
    const calendar = new FixtureCalendarConnector(log);

    const first = await calendar.createReminder('Northwind investor call', '2026-07-27T14:00:00Z');
    const again = await calendar.createReminder('Northwind investor call', '2026-07-27T14:00:00Z');
    const other = await calendar.createReminder('Other call', '2026-07-27T14:00:00Z');

    expect(first.id).toBe(again.id);
    expect(first.id).not.toBe(other.id);
    expect(first.id.startsWith('fixture-event-')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[0]!['message']).toBe('connector.calendar.createReminder');
  });

  it('returns a deterministic draft id without echoing the body', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const log: Logger = (level, message, meta) => lines.push({ level, message, ...(meta ?? {}) });
    const gmail = new FixtureGmailConnector(log);

    const draft = await gmail.draft('Could you watch this once?', 'Hi Priya — I have rehearsed this...', 'Priya');
    expect(draft.id.startsWith('fixture-draft-')).toBe(true);
    expect(await gmail.draft('Could you watch this once?', 'Hi Priya — I have rehearsed this...', 'Priya')).toEqual(draft);
    expect(JSON.stringify(lines)).not.toContain('rehearsed this');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/adapters/connectors.test.ts`
Expected: FAIL with `Failed to resolve import "./connectors.js"`.

- [ ] **Step 3: Write the implementation**

`packages/contracts/fixtures/next-step-context.json` — the values lifted verbatim from the `CONTEXTS` constant in `scripts/build-report.mjs`:

```json
{
  "rough": {
    "upcomingEvents": [
      { "title": "Northwind investor call", "startsAt": "2026-07-27T14:00:00Z" }
    ],
    "knownMentor": null,
    "now": "2026-07-25T09:00:00Z"
  },
  "clean": {
    "upcomingEvents": [],
    "knownMentor": "Priya",
    "now": "2026-07-25T09:00:00Z"
  }
}
```

`scripts/build-report.mjs` — complete resulting file:

```js
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
```

`apps/server/src/adapters/connectors.ts`:

```ts
// apps/server/src/adapters/connectors.ts
//
// Three seams, split by what they actually do (design §5.3).
//
// ContextProvider READS ambient facts. knownMentor is not a calendar fact, so
// it does not belong on CalendarConnector — ContextProvider owns assembling the
// whole NextStepContext. Under real MCP composition it fans out to a calendar
// server and a user profile; as a fixture it reads the shared JSON keyed by
// take id.
//
// CalendarConnector and GmailConnector WRITE. Only suggest_next_step calls
// them, and only after decideNextStep has already chosen.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextStepContext } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import type { Logger } from '../audit.js';

export interface ContextProvider {
  nextStepContext(takeId: string, now: string): Promise<NextStepContext>;
}

export interface CalendarConnector {
  createReminder(title: string, startsAt: string): Promise<{ id: string }>;
}

export interface GmailConnector {
  draft(subject: string, body: string, to: string | null): Promise<{ id: string }>;
}

/** What an unknown take (i.e. any upload) gets: no events, no mentor. */
export const NEUTRAL_CONTEXT: Omit<NextStepContext, 'now'> = {
  upcomingEvents: [],
  knownMentor: null,
};

const CONTEXT_FIXTURE = 'next-step-context.json';

export class FixtureContextProvider implements ContextProvider {
  constructor(private readonly fixtureDir: string) {}

  async nextStepContext(takeId: string, now: string): Promise<NextStepContext> {
    const raw = await readFile(join(this.fixtureDir, CONTEXT_FIXTURE), 'utf8');
    const all = JSON.parse(raw) as Record<string, unknown>;
    const entry = all[takeId];

    // The caller's `now` always wins. The value stored in the fixture is the
    // default build-report.mjs regenerates with; /api/analyze pins its own.
    if (entry === undefined) return { ...NEUTRAL_CONTEXT, now };

    const parsed = NextStepContext.safeParse({ ...(entry as object), now });
    if (!parsed.success) {
      throw new CoachError('INTERNAL', `next-step-context.json entry "${takeId}" does not match the contract.`, {
        takeId,
        issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

/** Deterministic synthetic id — no Date.now(), so a report stays reproducible. */
const syntheticId = (prefix: string, parts: Array<string | null>): string =>
  `${prefix}${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12)}`;

export class FixtureCalendarConnector implements CalendarConnector {
  constructor(private readonly log?: Logger) {}

  async createReminder(title: string, startsAt: string): Promise<{ id: string }> {
    const id = syntheticId('fixture-event-', [title, startsAt]);
    this.log?.('info', 'connector.calendar.createReminder', { id, startsAt });
    return { id };
  }
}

export class FixtureGmailConnector implements GmailConnector {
  constructor(private readonly log?: Logger) {}

  async draft(subject: string, body: string, to: string | null): Promise<{ id: string }> {
    const id = syntheticId('fixture-draft-', [subject, body, to]);
    // Metadata only: the draft body is user content and never reaches the log.
    this.log?.('info', 'connector.gmail.draft', { id, hasRecipientHint: to !== null });
    return { id };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/adapters/connectors.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 4b: Prove the extraction did not change the goldens**

Run: `npx tsx scripts/build-report.mjs && git diff --exit-code -- packages/contracts/fixtures/report.clean.json packages/contracts/fixtures/report.rough.json`
Expected: the script prints `clean: 2 issues, 0 high, 0 fillers, 146.6 WPM` and `rough: 6 issues, 1 high, 2 fillers, 143.9 WPM`, then `git diff --exit-code` exits 0 with no output. A non-zero exit means the extraction was wrong — fix `next-step-context.json` until the regenerated reports are byte-identical. Do not proceed to Step 5 until this exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/fixtures/next-step-context.json scripts/build-report.mjs apps/server/src/adapters/connectors.ts apps/server/src/adapters/connectors.test.ts
git commit -m "feat(server): extract shared next-step context fixture and add fixture connectors"
```

---

### Task 7: Tools `parse_script` and `transcribe_delivery` (+ `ServerDeps`)

**Files:**
- Create: `apps/server/src/pipeline.ts`
- Create: `apps/server/src/tools/parse-script.tool.ts`
- Create: `apps/server/src/tools/transcribe-delivery.tool.ts`
- Test: `apps/server/src/tools/parse-script.tool.test.ts`
- Test: `apps/server/src/tools/transcribe-delivery.tool.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `loadConfig` (Task 1); `Logger`, `createLogger` (Task 2); `AUDIO_DIR`, `UPLOAD_DIR`, `FIXTURE_DIR`, `resolveTakeAudio` (Task 3); `createSttClient` (Task 4); `prosodyForFile`, `DecodeFn` (Task 5); `ContextProvider`, `CalendarConnector`, `GmailConnector`, fixture impls (Task 6).
- Produces:
  - From `pipeline.ts`: `interface ServerDeps { config: AppConfig; log: Logger; audioDir: string; uploadDir: string; fixtureDir: string; clock: () => string; context: ContextProvider; calendar: CalendarConnector; gmail: GmailConnector; createStt: (cfg: AppConfig, takeId: string, fixtureDir: string) => SttClient; decode: DecodeFn | undefined }`; `createDeps(cfg: AppConfig, overrides?: Partial<ServerDeps>): ServerDeps`; `defaultScript(fixtureDir: string): string`; `DEFAULT_SCRIPT_FILE: 'script.demo.md'`
  - From `parse-script.tool.ts`: `ParseScriptInput` (Zod + type `{ raw: string }`); `ParseScriptOutput` (Zod `ScriptSegment[]`); `parseScriptTool(input: ParseScriptInput): ScriptSegment[]`
  - From `transcribe-delivery.tool.ts`: `TranscribeDeliveryInput` (Zod + type `{ takeId: string }`); `TranscribeDeliveryOutput` (Zod `DeliverySignal`); `transcribeDeliveryTool(input: TranscribeDeliveryInput, deps: ServerDeps): Promise<DeliverySignal>`

**Dependencies:** Tasks 1, 2, 3, 4, 5, 6 — all of them. This is the first task that assembles them.

**Design notes:**
- `ServerDeps` lives in `pipeline.ts` from this task on because every I/O tool takes it. Task 10 rewrites `pipeline.ts` in full to add `analyze()`; the complete resulting file is given there.
- The one conditional in `transcribeDeliveryTool` is transport wiring, not domain logic: with `STT_PROVIDER=fixture` and prosody off there is nothing to read from disk, which is what lets a fresh clone (where `fixtures/audio/*.m4a` is gitignored) still analyse the staged takes.
- `AUDIO_MAX_SECONDS` cannot be known until the audio has been read, so it is checked against `Transcript.durationSec` immediately after transcription and raises `AUDIO_UNREADABLE` naming the limit (design §11).

- [ ] **Step 1: Write the failing test**

`apps/server/src/tools/parse-script.tool.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptSegment } from '@nsh/contracts';
import { CoachError, parseScript } from '@nsh/core-logic';
import { FIXTURE_DIR } from '../takes.js';
import { ParseScriptOutput, parseScriptTool } from './parse-script.tool.js';

const demoScript = readFileSync(join(FIXTURE_DIR, 'script.demo.md'), 'utf8');

describe('parseScriptTool', () => {
  it('is a pure wrapper over parseScript', () => {
    expect(parseScriptTool({ raw: demoScript })).toEqual(parseScript(demoScript));
  });

  it('produces contract-valid, source-ordered segments for the demo script', () => {
    const segments = parseScriptTool({ raw: demoScript });
    expect(segments).toHaveLength(6);
    expect(segments.map((s) => s.id)).toEqual(
      segments.map((_, i) => `seg-${String(i + 1).padStart(3, '0')}`),
    );
    expect(ScriptSegment.array().safeParse(segments).success).toBe(true);
    expect(ParseScriptOutput.safeParse(segments).success).toBe(true);
    // The demo script marks both a pause and key points; the tool must not eat them.
    expect(segments.some((s) => s.markedPause)).toBe(true);
    expect(segments.filter((s) => s.isKeyPoint)).toHaveLength(2);
  });

  it('raises SCRIPT_EMPTY for blank input', () => {
    let thrown: unknown;
    try {
      parseScriptTool({ raw: '   \n\t ' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('SCRIPT_EMPTY');
  });

  it('raises SCRIPT_NO_SEGMENTS when the script is markup only', () => {
    let thrown: unknown;
    try {
      parseScriptTool({ raw: '[pause]\n\n****\n\n[pause]' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('SCRIPT_NO_SEGMENTS');
  });
});
```

`apps/server/src/tools/transcribe-delivery.tool.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeliverySignal, type Transcript } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import { loadConfig } from '../config.js';
import { PROSODY_SAMPLE_RATE, emptyProsody } from '../adapters/audio-decode.js';
import { createDeps, type ServerDeps } from '../pipeline.js';
import { transcribeDeliveryTool } from './transcribe-delivery.tool.js';

const FIXTURE_ENV = { STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' };

function audioScratch(): { audioDir: string; uploadDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'nsh-transcribe-'));
  const audioDir = join(root, 'audio');
  const uploadDir = join(audioDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(join(audioDir, 'take-rough.m4a'), 'not really audio');
  return { audioDir, uploadDir };
}

function tone(seconds: number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * PROSODY_SAMPLE_RATE));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / PROSODY_SAMPLE_RATE);
  }
  return pcm;
}

describe('transcribeDeliveryTool', () => {
  it('returns the frozen rough signal without touching the filesystem for audio', async () => {
    // audioDir deliberately does not exist: with the fixture client and prosody
    // off, a fresh clone with no recordings on disk must still analyse.
    const deps = createDeps(loadConfig(FIXTURE_ENV), {
      audioDir: '/definitely/not/here',
      uploadDir: '/definitely/not/here/uploads',
    });
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);

    expect(signal.transcript.words).toHaveLength(91);
    expect(signal.transcript.durationSec).toBe(38.72);
    expect(signal.prosody).toEqual(emptyProsody());
    expect(DeliverySignal.safeParse(signal).success).toBe(true);
  });

  it('returns the frozen clean signal', async () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV));
    const signal = await transcribeDeliveryTool({ takeId: 'clean' }, deps);
    expect(signal.transcript.words).toHaveLength(86);
    expect(signal.transcript.durationSec).toBe(40.853);
  });

  it('decodes prosody when enabled and an audio file exists', async () => {
    const { audioDir, uploadDir } = audioScratch();
    const deps = createDeps(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'true' }), {
      audioDir,
      uploadDir,
      decode: async () => tone(6),
    });
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    expect(signal.prosody.frames.length).toBeGreaterThan(0);
    expect(signal.prosody.frameHopSec).toBe(emptyProsody().frameHopSec);
  });

  it('degrades to an empty prosody track when decoding fails, and still returns the transcript', async () => {
    const { audioDir, uploadDir } = audioScratch();
    const deps = createDeps(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'true' }), {
      audioDir,
      uploadDir,
      decode: async () => {
        throw new Error('ffmpeg unavailable');
      },
    });
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    expect(signal.prosody).toEqual(emptyProsody());
    expect(signal.transcript.words).toHaveLength(91);
  });

  it('raises AUDIO_UNREADABLE naming the limit when the recording is too long', async () => {
    const deps = createDeps(loadConfig({ ...FIXTURE_ENV, AUDIO_MAX_SECONDS: '10' }));
    let thrown: unknown;
    try {
      await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('AUDIO_UNREADABLE');
    expect((thrown as CoachError).message).toContain('10');
  });

  it('raises STT_FAILED for a take with no frozen transcript', async () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV));
    await expect(transcribeDeliveryTool({ takeId: 'up-0123456789ab' }, deps)).rejects.toMatchObject({
      name: 'CoachError',
      code: 'STT_FAILED',
    });
  });

  it('raises AUDIO_UNREADABLE for a real provider when no audio file is on disk', async () => {
    const stubTranscript: Transcript = { provider: 'deepgram', durationSec: 1, words: [] };
    const overrides: Partial<ServerDeps> = {
      audioDir: '/definitely/not/here',
      uploadDir: '/definitely/not/here/uploads',
      createStt: () => ({ provider: 'deepgram', transcribe: async () => stubTranscript }),
    };
    const deps = createDeps(
      loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'dummy-not-a-real-key', ENABLE_PROSODY: 'false' }),
      overrides,
    );
    await expect(transcribeDeliveryTool({ takeId: 'rough' }, deps)).rejects.toMatchObject({
      name: 'CoachError',
      code: 'AUDIO_UNREADABLE',
    });
  });
});

describe('createDeps', () => {
  it('defaults to the repo directories, the fixture connectors and an ISO clock', () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV));
    expect(deps.fixtureDir.replace(/\\/g, '/')).toMatch(/\/packages\/contracts\/fixtures$/);
    expect(deps.audioDir.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio$/);
    expect(deps.uploadDir.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio\/uploads$/);
    expect(deps.clock()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(typeof deps.context.nextStepContext).toBe('function');
    expect(typeof deps.calendar.createReminder).toBe('function');
    expect(typeof deps.gmail.draft).toBe('function');
  });

  it('lets a caller override any single dependency', () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV), { clock: () => '2026-07-25T09:00:00Z' });
    expect(deps.clock()).toBe('2026-07-25T09:00:00Z');
    expect(deps.audioDir.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/tools/`
Expected: FAIL with `Failed to resolve import "./parse-script.tool.js"` and `Failed to resolve import "../pipeline.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/pipeline.ts` (this task creates it with `ServerDeps` and `createDeps`; Task 10 rewrites it in full to add `analyze()`):

```ts
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
```

`apps/server/src/tools/parse-script.tool.ts`:

```ts
// apps/server/src/tools/parse-script.tool.ts
//
// One function plus its input/output schemas. A plain function, not a class:
// NitroStack's generator supplies its own class and decorator shape, and a
// plain function is the smallest thing that survives that transition.

import { z } from 'zod';
import { ScriptSegment } from '@nsh/contracts';
import { parseScript } from '@nsh/core-logic';

export const ParseScriptInput = z.object({ raw: z.string() });
export type ParseScriptInput = z.infer<typeof ParseScriptInput>;

export const ParseScriptOutput = z.array(ScriptSegment);

export function parseScriptTool(input: ParseScriptInput): ScriptSegment[] {
  return parseScript(ParseScriptInput.parse(input).raw);
}
```

`apps/server/src/tools/transcribe-delivery.tool.ts`:

```ts
// apps/server/src/tools/transcribe-delivery.tool.ts
//
// Returns a DeliverySignal ({ transcript, prosody }) — exactly what
// correlateSegments consumes — rather than an ad-hoc pair.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { DeliverySignal } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import { prosodyForFile } from '../adapters/audio-decode.js';
import type { ServerDeps } from '../pipeline.js';
import { resolveTakeAudio } from '../takes.js';

export const TranscribeDeliveryInput = z.object({ takeId: z.string().min(1) });
export type TranscribeDeliveryInput = z.infer<typeof TranscribeDeliveryInput>;

export const TranscribeDeliveryOutput = DeliverySignal;

export async function transcribeDeliveryTool(
  input: TranscribeDeliveryInput,
  deps: ServerDeps,
): Promise<DeliverySignal> {
  const { takeId } = TranscribeDeliveryInput.parse(input);
  const client = deps.createStt(deps.config, takeId, deps.fixtureDir);

  // Transport wiring, not domain logic: the fixture client replays a committed
  // transcript, so with prosody off there is nothing on disk to read — which is
  // what lets a fresh clone (gitignored recordings) analyse the staged takes.
  const needsBytes = deps.config.sttProvider !== 'fixture' || deps.config.enableProsody;
  const audio = needsBytes ? resolveTakeAudio(deps.audioDir, deps.uploadDir, takeId) : null;

  if (deps.config.sttProvider !== 'fixture' && audio === null) {
    throw new CoachError('AUDIO_UNREADABLE', `No audio file on disk for take "${takeId}".`, { takeId });
  }

  const bytes = audio === null ? new Uint8Array(0) : new Uint8Array(await readFile(audio.path));
  const transcript = await client.transcribe(bytes, audio?.mimeType ?? 'application/octet-stream');

  // AUDIO_MAX_SECONDS cannot be known until the audio has been read, so it is
  // checked here rather than at upload time (design §11).
  if (transcript.durationSec > deps.config.audioMaxSeconds) {
    throw new CoachError(
      'AUDIO_UNREADABLE',
      `Recording is ${transcript.durationSec}s; the limit is ${deps.config.audioMaxSeconds}s.`,
      { takeId, durationSec: transcript.durationSec },
    );
  }

  const prosody = await prosodyForFile({
    filePath: audio?.path ?? null,
    enabled: deps.config.enableProsody,
    decode: deps.decode,
    log: deps.log,
  });

  return { transcript, prosody };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/tools/` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/pipeline.ts apps/server/src/tools/parse-script.tool.ts apps/server/src/tools/parse-script.tool.test.ts apps/server/src/tools/transcribe-delivery.tool.ts apps/server/src/tools/transcribe-delivery.tool.test.ts
git commit -m "feat(server): parse_script and transcribe_delivery tools with shared deps"
```

---

### Task 8: Tools `correlate_segments` and `generate_summary`

**Files:**
- Create: `apps/server/src/tools/correlate-segments.tool.ts`
- Create: `apps/server/src/tools/generate-summary.tool.ts`
- Test: `apps/server/src/tools/correlate-segments.tool.test.ts`
- Test: `apps/server/src/tools/generate-summary.tool.test.ts`

**Interfaces:**
- Consumes: `parseScriptTool` (Task 7); `transcribeDeliveryTool` (Task 7); `createDeps` (Task 7).
- Produces:
  - `CorrelateSegmentsInput` (Zod + type `{ signal: DeliverySignal; segments: ScriptSegment[] }`); `CorrelateSegmentsOutput` (Zod `CorrelationResult`); `correlateSegmentsTool(input: CorrelateSegmentsInput): CorrelationResult`
  - `GenerateSummaryInput` (Zod + type `{ segments: ScriptSegment[]; correlation: CorrelationResult; signal: DeliverySignal; meta: { reportId: string; audioUrl: string | null } }`); `GenerateSummaryOutput` (Zod `DeliveryReport`); `generateSummaryTool(input: GenerateSummaryInput): DeliveryReport`

**Dependencies:** Task 7 (both tests build their input by calling `parseScriptTool` and `transcribeDeliveryTool`).

**Design notes:**
- `correlate_segments` calls `alignSegments(transcript, segments, prosody)` and then `correlateSegments(signal, segments, alignment)`. It does **not** call `computeBaseline` — `correlateSegments` computes the baseline internally and returns it on `CorrelationResult.baseline`.
- `generate_summary` takes `audioUrl` from its caller so the pipeline can hand it `/api/audio/:takeId` while `build-report.mjs` keeps handing it `/fixtures/take-*.wav`.

- [ ] **Step 1: Write the failing test**

`apps/server/src/tools/correlate-segments.tool.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CorrelationResult, type DeliverySignal, type ScriptSegment } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import { loadConfig } from '../config.js';
import { createDeps } from '../pipeline.js';
import { FIXTURE_DIR } from '../takes.js';
import { emptyProsody } from '../adapters/audio-decode.js';
import { parseScriptTool } from './parse-script.tool.js';
import { transcribeDeliveryTool } from './transcribe-delivery.tool.js';
import { correlateSegmentsTool } from './correlate-segments.tool.js';

const FIXTURE_ENV = { STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' };
const deps = createDeps(loadConfig(FIXTURE_ENV));
const segments: ScriptSegment[] = parseScriptTool({
  raw: readFileSync(join(FIXTURE_DIR, 'script.demo.md'), 'utf8'),
});

describe('correlateSegmentsTool', () => {
  it('reproduces the committed rough issue set', async () => {
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    const result = correlateSegmentsTool({ signal, segments });

    expect(CorrelationResult.safeParse(result).success).toBe(true);
    expect(result.issues).toHaveLength(6);
    const high = result.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
    expect(high[0]!.type).toBe('stress_mismatch');
    // Every issue carries a trace, and every alignment is passed through.
    expect(result.trace.map((t) => t.issueId)).toEqual(result.issues.map((i) => i.id));
    expect(result.alignments.map((a) => a.segmentId)).toEqual(segments.map((s) => s.id));
    expect(result.baseline.avgPaceWpm).toBeGreaterThan(0);
  });

  it('reproduces the committed clean issue set — two issues, both low', async () => {
    const signal = await transcribeDeliveryTool({ takeId: 'clean' }, deps);
    const result = correlateSegmentsTool({ signal, segments });
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i) => i.severity === 'low')).toBe(true);
  });

  it('raises ALIGNMENT_FAILED when the recording does not match the script', () => {
    const signal: DeliverySignal = {
      transcript: {
        provider: 'fixture',
        durationSec: 20,
        words: Array.from({ length: 40 }, (_, i) => ({
          text: 'qqq',
          start: i * 0.5,
          end: i * 0.5 + 0.4,
          confidence: 0.9,
          isFiller: false,
        })),
      },
      prosody: emptyProsody(),
    };

    let thrown: unknown;
    try {
      correlateSegmentsTool({ signal, segments });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('ALIGNMENT_FAILED');
  });
});
```

`apps/server/src/tools/generate-summary.tool.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/tools/correlate-segments.tool.test.ts src/tools/generate-summary.tool.test.ts`
Expected: FAIL with `Failed to resolve import "./correlate-segments.tool.js"` and `Failed to resolve import "./generate-summary.tool.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/tools/correlate-segments.tool.ts`:

```ts
// apps/server/src/tools/correlate-segments.tool.ts
//
// alignSegments, then correlateSegments. It does NOT call computeBaseline:
// correlateSegments computes the baseline internally and returns it on
// CorrelationResult.baseline (design §6).

import { z } from 'zod';
import {
  CorrelationResult,
  DeliverySignal,
  ScriptSegment,
} from '@nsh/contracts';
import { alignSegments, correlateSegments } from '@nsh/core-logic';

export const CorrelateSegmentsInput = z.object({
  signal: DeliverySignal,
  segments: z.array(ScriptSegment),
});
export type CorrelateSegmentsInput = z.infer<typeof CorrelateSegmentsInput>;

export const CorrelateSegmentsOutput = CorrelationResult;

export function correlateSegmentsTool(input: CorrelateSegmentsInput): CorrelationResult {
  const { signal, segments } = CorrelateSegmentsInput.parse(input);
  const alignment = alignSegments(signal.transcript, segments, signal.prosody);
  return correlateSegments(signal, segments, alignment);
}
```

`apps/server/src/tools/generate-summary.tool.ts`:

```ts
// apps/server/src/tools/generate-summary.tool.ts

import { z } from 'zod';
import {
  CorrelationResult,
  DeliveryReport,
  DeliverySignal,
  ScriptSegment,
} from '@nsh/contracts';
import { generateSummary } from '@nsh/core-logic';

export const GenerateSummaryInput = z.object({
  segments: z.array(ScriptSegment),
  correlation: CorrelationResult,
  signal: DeliverySignal,
  meta: z.object({
    reportId: z.string().min(1),
    audioUrl: z.string().nullable(),
  }),
});
export type GenerateSummaryInput = z.infer<typeof GenerateSummaryInput>;

export const GenerateSummaryOutput = DeliveryReport;

export function generateSummaryTool(input: GenerateSummaryInput): DeliveryReport {
  const { segments, correlation, signal, meta } = GenerateSummaryInput.parse(input);
  return generateSummary(segments, correlation, signal, meta);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/tools/` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/tools/correlate-segments.tool.ts apps/server/src/tools/correlate-segments.tool.test.ts apps/server/src/tools/generate-summary.tool.ts apps/server/src/tools/generate-summary.tool.test.ts
git commit -m "feat(server): correlate_segments and generate_summary tools"
```

---

### Task 9: Tool `suggest_next_step`

**Files:**
- Create: `apps/server/src/tools/suggest-next-step.tool.ts`
- Test: `apps/server/src/tools/suggest-next-step.tool.test.ts`

**Interfaces:**
- Consumes: `ServerDeps` (Task 7); `ContextProvider`, `CalendarConnector`, `GmailConnector` (Task 6).
- Produces:
  - `SuggestNextStepInput` (Zod + type `{ report: DeliveryReport; takeId: string; now: string; execute: boolean }` — `execute` has a Zod default of `false`)
  - `SuggestNextStepOutput` (Zod `NextStep`)
  - `suggestNextStepTool(input: z.input<typeof SuggestNextStepInput>, deps: ServerDeps): Promise<NextStep>`

**Dependencies:** Tasks 6 and 7.

**Design notes:**
- This is the only tool that mutates the outside world and the only place `NextStep.executed` becomes `true`. `decideNextStep` always emits `false`.
- `execute` defaults to `false`, so `/api/analyze` proposes and the golden comparison in Task 12 holds. The widget's confirm button posts `execute: true` to `/api/tools/suggest_next_step`. See "Two reconciliations" above.
- When `kind` is `'none'`, nothing is executed and the flag stays `false` regardless of `execute`.
- The connector write happens *after* `decideNextStep`, never before, and only the returned copy is flipped — the decision itself is never mutated.

- [ ] **Step 1: Write the failing test**

`apps/server/src/tools/suggest-next-step.tool.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextStep, type DeliveryReport } from '@nsh/contracts';
import { decideNextStep } from '@nsh/core-logic';
import { loadConfig } from '../config.js';
import { createDeps, type ServerDeps } from '../pipeline.js';
import { FIXTURE_DIR } from '../takes.js';
import type { CalendarConnector, GmailConnector } from '../adapters/connectors.js';
import { suggestNextStepTool } from './suggest-next-step.tool.js';

const NOW = '2026-07-25T09:00:00Z';

const golden = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

interface Spies {
  calendarCalls: Array<[string, string]>;
  gmailCalls: Array<[string, string, string | null]>;
  deps: ServerDeps;
}

function spyDeps(): Spies {
  const calendarCalls: Array<[string, string]> = [];
  const gmailCalls: Array<[string, string, string | null]> = [];
  const calendar: CalendarConnector = {
    createReminder: async (title, startsAt) => {
      calendarCalls.push([title, startsAt]);
      return { id: 'spy-event-1' };
    },
  };
  const gmail: GmailConnector = {
    draft: async (subject, body, to) => {
      gmailCalls.push([subject, body, to]);
      return { id: 'spy-draft-1' };
    },
  };
  const deps = createDeps(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }), {
    calendar,
    gmail,
    clock: () => {
      throw new Error('the clock must not be read when `now` is pinned');
    },
  });
  return { calendarCalls, gmailCalls, deps };
}

describe('suggestNextStepTool — proposing (the /api/analyze path)', () => {
  it.each(['rough', 'clean'])('reproduces report.%s.json nextStep with executed false', async (label) => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden(label), nextStep: null };
    const step = await suggestNextStepTool({ report, takeId: label, now: NOW }, deps);

    expect(NextStep.safeParse(step).success).toBe(true);
    expect(step).toEqual(golden(label).nextStep);
    expect(step.executed).toBe(false);
    // Nothing fired. `executed: false` means "proposed, awaiting confirmation".
    expect(calendarCalls).toEqual([]);
    expect(gmailCalls).toEqual([]);
  });

  it('is exactly decideNextStep against the fixture context when not executing', async () => {
    const { deps } = spyDeps();
    const report = { ...golden('rough'), nextStep: null };
    const ctx = await deps.context.nextStepContext('rough', NOW);
    expect(await suggestNextStepTool({ report, takeId: 'rough', now: NOW }, deps)).toEqual(
      decideNextStep(report, ctx),
    );
  });
});

describe('suggestNextStepTool — executing (the confirm path)', () => {
  it('fires the calendar connector and flips only `executed` for the rough take', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden('rough'), nextStep: null };
    const proposed = await suggestNextStepTool({ report, takeId: 'rough', now: NOW }, deps);
    const executed = await suggestNextStepTool({ report, takeId: 'rough', now: NOW, execute: true }, deps);

    expect(executed).toEqual({ ...proposed, executed: true });
    expect(calendarCalls).toEqual([[proposed.eventTitle!, proposed.eventStartsAt!]]);
    expect(gmailCalls).toEqual([]);
  });

  it('fires the gmail connector and flips only `executed` for the clean take', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden('clean'), nextStep: null };
    const proposed = await suggestNextStepTool({ report, takeId: 'clean', now: NOW }, deps);
    const executed = await suggestNextStepTool({ report, takeId: 'clean', now: NOW, execute: true }, deps);

    expect(executed).toEqual({ ...proposed, executed: true });
    expect(gmailCalls).toEqual([[proposed.draftSubject!, proposed.draftBody!, proposed.recipientHint]]);
    expect(calendarCalls).toEqual([]);
  });

  it('executes nothing and leaves the flag false when kind is none', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report: DeliveryReport = { ...golden('rough'), nextStep: null, status: 'analyzing' };
    const step = await suggestNextStepTool({ report, takeId: 'rough', now: NOW, execute: true }, deps);

    expect(step.kind).toBe('none');
    expect(step.executed).toBe(false);
    expect(calendarCalls).toEqual([]);
    expect(gmailCalls).toEqual([]);
  });

  it('honours a pinned `now` that moves the decision past the calendar event', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden('rough'), nextStep: null };
    const step = await suggestNextStepTool(
      { report, takeId: 'rough', now: '2030-01-01T00:00:00Z', execute: true },
      deps,
    );
    expect(step.kind).toBe('draft_note');
    expect(step.executed).toBe(true);
    expect(calendarCalls).toEqual([]);
    expect(gmailCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/tools/suggest-next-step.tool.test.ts`
Expected: FAIL with `Failed to resolve import "./suggest-next-step.tool.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/tools/suggest-next-step.tool.ts`:

```ts
// apps/server/src/tools/suggest-next-step.tool.ts
//
// The only tool that mutates the outside world, and the only place
// NextStep.executed becomes true. decideNextStep always emits false.
//
// `execute` defaults to FALSE. /api/analyze proposes; the widget's confirm
// button posts execute:true to /api/tools/suggest_next_step. That is what keeps
// the committed goldens (executed: false) reproducible end-to-end and honours
// the contract's "never pre-set executed to true".

import { z } from 'zod';
import { DeliveryReport, NextStep } from '@nsh/contracts';
import { decideNextStep } from '@nsh/core-logic';
import type { ServerDeps } from '../pipeline.js';

export const SuggestNextStepInput = z.object({
  report: DeliveryReport,
  takeId: z.string().min(1),
  now: z.string().min(1),
  execute: z.boolean().default(false),
});
export type SuggestNextStepInput = z.infer<typeof SuggestNextStepInput>;

export const SuggestNextStepOutput = NextStep;

export async function suggestNextStepTool(
  input: z.input<typeof SuggestNextStepInput>,
  deps: ServerDeps,
): Promise<NextStep> {
  const { report, takeId, now, execute } = SuggestNextStepInput.parse(input);

  const ctx = await deps.context.nextStepContext(takeId, now);
  const decided = decideNextStep(report, ctx);

  if (!execute || decided.kind === 'none') return decided;

  // The action is performed against the CONFIGURED connector, which is what
  // makes executed:true honest even while the connectors are fixtures.
  if (decided.kind === 'calendar_reminder') {
    const { id } = await deps.calendar.createReminder(decided.eventTitle ?? '', decided.eventStartsAt ?? '');
    deps.log('info', 'next_step.executed', { takeId, kind: decided.kind, externalId: id });
  } else {
    const { id } = await deps.gmail.draft(
      decided.draftSubject ?? '',
      decided.draftBody ?? '',
      decided.recipientHint,
    );
    deps.log('info', 'next_step.executed', { takeId, kind: decided.kind, externalId: id });
  }

  return { ...decided, executed: true };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/tools/suggest-next-step.tool.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/tools/suggest-next-step.tool.ts apps/server/src/tools/suggest-next-step.tool.test.ts
git commit -m "feat(server): suggest_next_step tool with opt-in connector execution"
```

---

### Task 10: `pipeline.ts` — compose the five tools

**Files:**
- Modify: `apps/server/src/pipeline.ts`
- Test: `apps/server/src/pipeline.test.ts`

**Interfaces:**
- Consumes: all five tools from Tasks 7-9; `withAudit` (Task 2).
- Produces (added to `pipeline.ts`, alongside everything it already exports):
  - `AnalyzeInput` (Zod + type `{ takeId: string; script?: string; now?: string; execute?: boolean }`)
  - `reportIdFor(takeId: string): string`
  - `audioUrlFor(takeId: string): string`
  - `analyze(input: z.input<typeof AnalyzeInput>, deps: ServerDeps): Promise<DeliveryReport>`

**Dependencies:** Tasks 2, 7, 8, 9.

**Design notes:**
- One rule for report ids — `rpt-demo-${takeId}` — covers staged takes (so the golden comparison holds) and uploads (whose take id is already a content hash, so the report id stays deterministic and unique per file).
- Each of the five calls is wrapped in `withAudit`, so one `/api/analyze` produces five audit lines plus the request line.
- `now` falls back to `deps.clock()`; when the caller pins it, the clock is never read.

- [ ] **Step 1: Write the failing test**

`apps/server/src/pipeline.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/pipeline.test.ts`
Expected: FAIL with `No "analyze" export is defined on the "./pipeline.js" mock` / `analyze is not a function` — the symbol does not exist yet.

- [ ] **Step 3: Write the implementation**

`apps/server/src/pipeline.ts` — complete resulting file, replacing the Task 7 version:

```ts
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

export const AnalyzeInput = z.object({
  takeId: z.string().min(1),
  script: z.string().optional(),
  now: z.string().optional(),
  execute: z.boolean().optional(),
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
  const { takeId, script, now, execute } = AnalyzeInput.parse(input);
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

  report.nextStep = await withAudit({ ...audit, tool: 'suggest_next_step' }, deps.log, () =>
    suggestNextStepTool(
      { report, takeId, now: now ?? deps.clock(), execute: execute ?? false },
      deps,
    ),
  );

  return report;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/pipeline.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/pipeline.ts apps/server/src/pipeline.test.ts
git commit -m "feat(server): compose the five tools into the analyze pipeline"
```

---

### Task 11: `http.ts` and `main.ts` — routes, range requests, error mapping

**Files:**
- Create: `apps/server/src/http.ts`
- Create: `apps/server/src/main.ts`
- Test: `apps/server/src/http.test.ts`

**Interfaces:**
- Consumes: `mapError`, `GENERIC_MESSAGE` (Task 2); `listTakes`, `resolveTakeAudio`, `uploadTakeId`, `uploadFilenameFor` (Task 3); `ServerDeps`, `createDeps`, `analyze`, `AnalyzeInput` (Tasks 7, 10); all five tools and their input schemas (Tasks 7-9); `getConfig`, `describeConfig` (Task 1).
- Produces:
  - `TOOL_NAMES: readonly string[]`
  - `createApp(deps: ServerDeps): Express`
  - `bootstrap(cfg: AppConfig, overrides?: Partial<ServerDeps>): Promise<{ server: Server; port: number; deps: ServerDeps; close: () => Promise<void> }>` (from `main.ts`)
  - `main(): Promise<void>` (from `main.ts`)

**Dependencies:** Tasks 1, 2, 3, 7, 8, 9, 10.

**Design notes:**
- Request-body schema rejections are an HTTP concern, not a `CoachError`, so they return `400 { error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } }` at the route layer. `mapError` stays exactly the design §10 table and never grows a case it does not have.
- An unknown take on `/api/analyze` or `/api/audio/:takeId` is `404 NOT_FOUND`, again a routing concern rather than a pipeline failure.
- `UPLOAD_MAX_BYTES` is enforced by multer before anything is written to disk; exceeding it is `413`.
- Range support is mandatory: without it the scrubber cannot seek in most browsers, and seeking to a tick is the demo's core interaction.
- `bootstrap` lives in `main.ts` (design §4: "boot: validate config, start listener") and is what Task 12 calls to boot in-process.

- [ ] **Step 1: Write the failing test**

`apps/server/src/http.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { GENERIC_MESSAGE } from './errors.js';
import { FIXTURE_DIR } from './takes.js';
import { bootstrap } from './main.js';

const AUDIO_BYTES = Buffer.from('0123456789abcdef');

let base: string;
let close: () => Promise<void>;
let audioDir: string;
let uploadDir: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'nsh-http-'));
  audioDir = join(root, 'audio');
  uploadDir = join(audioDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(join(audioDir, 'take-rough.m4a'), AUDIO_BYTES);

  const booted = await bootstrap(
    loadConfig({ PORT: '0', STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false', UPLOAD_MAX_BYTES: '64' }),
    { audioDir, uploadDir, fixtureDir: FIXTURE_DIR, log: () => {} },
  );
  base = `http://127.0.0.1:${booted.port}`;
  close = booted.close;
});

afterAll(async () => {
  await close();
});

const postJson = (path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/health', () => {
  it('reports readiness and the effective adapter selection, never the key', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, sttProvider: 'fixture', prosodyEnabled: false, deepgramKeyPresent: false });
  });
});

describe('GET /api/takes', () => {
  it('lists the staged takes with their frozen-transcript flag', async () => {
    const res = await fetch(`${base}/api/takes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { takes: Array<{ id: string; hasFrozenTranscript: boolean }> };
    expect(body.takes.map((t) => t.id)).toContain('rough');
    expect(body.takes.map((t) => t.id)).toContain('clean');
    expect(body.takes.find((t) => t.id === 'rough')!.hasFrozenTranscript).toBe(true);
  });
});

describe('GET /api/audio/:takeId', () => {
  it('serves the whole file with a mime type and advertises range support', async () => {
    const res = await fetch(`${base}/api/audio/rough`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(AUDIO_BYTES);
  });

  it('honours a byte range so the scrubber can seek', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=4-7' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 4-7/${AUDIO_BYTES.length}`);
    expect(res.headers.get('content-length')).toBe('4');
    expect(await res.text()).toBe('4567');
  });

  it('honours an open-ended range', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=12-' } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('cdef');
  });

  it('honours a suffix range', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=-3' } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('def');
  });

  it('rejects an unsatisfiable range with 416', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=999-1000' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${AUDIO_BYTES.length}`);
  });

  it('404s a take with no audio on disk', async () => {
    const res = await fetch(`${base}/api/audio/clean`);
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'NOT_FOUND', message: 'No audio for take "clean".' },
    });
  });
});

describe('POST /api/analyze', () => {
  it('returns a live report for a staged take', async () => {
    const res = await postJson('/api/analyze', { takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { reportId: string; audioUrl: string; issues: unknown[] };
    expect(report.reportId).toBe('rpt-demo-rough');
    expect(report.audioUrl).toBe('/api/audio/rough');
    expect(report.issues).toHaveLength(6);
  });

  it('404s an unknown take', async () => {
    const res = await postJson('/api/analyze', { takeId: 'nope' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('400s a malformed body without leaking internals', async () => {
    const res = await postJson('/api/analyze', { takeId: 42 });
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid request body.' },
    });
  });

  it('maps SCRIPT_EMPTY to 400 with the CoachError message', async () => {
    const res = await postJson('/api/analyze', { takeId: 'rough', script: '   ' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SCRIPT_EMPTY');
    expect(body.error.message).not.toBe(GENERIC_MESSAGE);
  });
});

describe('POST /api/tools/:name', () => {
  it('runs a single named tool', async () => {
    const res = await postJson('/api/tools/parse_script', { raw: 'One line.\n\nAnother line.' });
    expect(res.status).toBe(200);
    const segments = (await res.json()) as Array<{ id: string }>;
    expect(segments.map((s) => s.id)).toEqual(['seg-001', 'seg-002']);
  });

  it('runs transcribe_delivery and returns a DeliverySignal', async () => {
    const res = await postJson('/api/tools/transcribe_delivery', { takeId: 'rough' });
    expect(res.status).toBe(200);
    const signal = (await res.json()) as { transcript: { words: unknown[] }; prosody: { frames: unknown[] } };
    expect(signal.transcript.words).toHaveLength(91);
    expect(signal.prosody.frames).toEqual([]);
  });

  it('404s an unknown tool name', async () => {
    const res = await postJson('/api/tools/definitely_not_a_tool', {});
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('400s a body the tool schema rejects', async () => {
    const res = await postJson('/api/tools/transcribe_delivery', { takeId: '' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('502s an STT failure', async () => {
    const res = await postJson('/api/tools/transcribe_delivery', { takeId: 'up-000000000000' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STT_FAILED');
  });
});

describe('POST /api/uploads', () => {
  it('stores the file under a content-hash take id and makes it discoverable', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('tiny fake audio')], { type: 'audio/mpeg' }), 'clip.mp3');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const { takeId } = (await res.json()) as { takeId: string };
    expect(takeId.startsWith('up-')).toBe(true);

    const takes = (await (await fetch(`${base}/api/takes`)).json()) as { takes: Array<{ id: string }> };
    expect(takes.takes.map((t) => t.id)).toContain(takeId);

    const audio = await fetch(`${base}/api/audio/${takeId}`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('413s a file over UPLOAD_MAX_BYTES before writing anything to disk', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(200, 7)], { type: 'audio/mpeg' }), 'big.mp3');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPLOAD_TOO_LARGE');
  });

  it('415s an unsupported container', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('nope')], { type: 'audio/aiff' }), 'clip.aiff');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    expect(res.status).toBe(415);
  });

  it('400s a request with no file field', async () => {
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/http.test.ts`
Expected: FAIL with `Failed to resolve import "./main.js"`.

- [ ] **Step 3: Write the implementation**

`apps/server/src/http.ts`:

```ts
// apps/server/src/http.ts
//
// Design §7. /api/tools/:name is the NitroStack-shaped surface: one named tool,
// its own schema, one call. Under NitroStack these become @Tool methods and
// this route disappears; /api/analyze is replaced by the host model's own
// orchestration.

import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { describeConfig } from './config.js';
import { withAudit } from './audit.js';
import { mapError } from './errors.js';
import {
  listTakes,
  resolveTakeAudio,
  uploadFilenameFor,
  uploadTakeId,
} from './takes.js';
import { AnalyzeInput, analyze, type ServerDeps } from './pipeline.js';
import { ParseScriptInput, parseScriptTool } from './tools/parse-script.tool.js';
import { TranscribeDeliveryInput, transcribeDeliveryTool } from './tools/transcribe-delivery.tool.js';
import { CorrelateSegmentsInput, correlateSegmentsTool } from './tools/correlate-segments.tool.js';
import { GenerateSummaryInput, generateSummaryTool } from './tools/generate-summary.tool.js';
import { SuggestNextStepInput, suggestNextStepTool } from './tools/suggest-next-step.tool.js';

type ToolHandler = (body: unknown, deps: ServerDeps) => Promise<unknown>;

const TOOLS: Record<string, { takeIdOf: (body: unknown) => string | null; run: ToolHandler }> = {
  parse_script: {
    takeIdOf: () => null,
    run: async (body) => parseScriptTool(ParseScriptInput.parse(body)),
  },
  transcribe_delivery: {
    takeIdOf: (body) => TranscribeDeliveryInput.parse(body).takeId,
    run: (body, deps) => transcribeDeliveryTool(TranscribeDeliveryInput.parse(body), deps),
  },
  correlate_segments: {
    takeIdOf: () => null,
    run: async (body) => correlateSegmentsTool(CorrelateSegmentsInput.parse(body)),
  },
  generate_summary: {
    takeIdOf: () => null,
    run: async (body) => generateSummaryTool(GenerateSummaryInput.parse(body)),
  },
  suggest_next_step: {
    takeIdOf: (body) => SuggestNextStepInput.parse(body).takeId,
    run: (body, deps) => suggestNextStepTool(SuggestNextStepInput.parse(body), deps),
  },
};

export const TOOL_NAMES: readonly string[] = Object.keys(TOOLS);

function sendNotFound(res: Response, message: string): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message } });
}

/**
 * A schema rejection is an HTTP concern, not a CoachError, so it is handled
 * here and mapError stays exactly the design §10 table.
 */
function sendError(res: Response, err: unknown, deps: ServerDeps): void {
  if (err instanceof z.ZodError) {
    deps.log('warn', 'request.invalid', { fields: err.issues.map((i) => i.path.join('.')) });
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } });
    return;
  }
  const mapped = mapError(err);
  // Design §10: the full detail and the CoachError context are logged here and
  // never returned. This is the request log, not the metadata-only audit line.
  deps.log('error', 'request.failed', {
    status: mapped.status,
    code: mapped.body.error.code,
    detail: mapped.logMessage,
    context: mapped.logContext,
  });
  res.status(mapped.status).json(mapped.body);
}

function serveAudio(req: Request, res: Response, deps: ServerDeps): void {
  const takeId = req.params['takeId'] ?? '';
  const found = resolveTakeAudio(deps.audioDir, deps.uploadDir, takeId);
  if (found === null) {
    sendNotFound(res, `No audio for take "${takeId}".`);
    return;
  }

  const size = statSync(found.path).size;
  res.setHeader('Content-Type', found.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range === undefined) {
    res.setHeader('Content-Length', String(size));
    createReadStream(found.path).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const startRaw = match?.[1] ?? '';
  const endRaw = match?.[2] ?? '';

  let start: number;
  let end: number;
  if (match === null || (startRaw === '' && endRaw === '')) {
    start = NaN;
    end = NaN;
  } else if (startRaw === '') {
    const suffix = Number(endRaw);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(end - start + 1));
  createReadStream(found.path, { start, end }).pipe(res);
}

export function createApp(deps: ServerDeps): Express {
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  // memoryStorage plus a fileSize limit: multer aborts at the limit and nothing
  // reaches the disk until the handler explicitly writes it (design §11).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.config.uploadMaxBytes, files: 1 },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ...describeConfig(deps.config) });
  });

  app.get('/api/takes', (_req, res) => {
    res.json({ takes: listTakes(deps.audioDir, deps.uploadDir, deps.fixtureDir) });
  });

  app.get('/api/audio/:takeId', (req, res) => {
    try {
      serveAudio(req, res, deps);
    } catch (err) {
      sendError(res, err, deps);
    }
  });

  app.post('/api/uploads', (req, res) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: {
            code: 'UPLOAD_TOO_LARGE',
            message: `Upload exceeds the ${deps.config.uploadMaxBytes} byte limit.`,
          },
        });
        return;
      }
      if (err !== null && err !== undefined) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Upload could not be parsed.' } });
        return;
      }

      const file = req.file;
      if (file === undefined) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Expected one file field named "file".' } });
        return;
      }

      const takeId = uploadTakeId(file.buffer);
      const filename = uploadFilenameFor(takeId, file.originalname);
      if (filename === null) {
        res.status(415).json({ error: { code: 'AUDIO_UNREADABLE', message: 'Unsupported audio container.' } });
        return;
      }

      mkdirSync(deps.uploadDir, { recursive: true });
      writeFileSync(join(deps.uploadDir, filename), file.buffer);
      deps.log('info', 'upload.stored', { takeId, bytes: file.buffer.byteLength });
      res.json({ takeId });
    });
  });

  app.post('/api/analyze', async (req, res) => {
    try {
      const input = AnalyzeInput.parse(req.body);
      const known = listTakes(deps.audioDir, deps.uploadDir, deps.fixtureDir).some((t) => t.id === input.takeId);
      if (!known) {
        sendNotFound(res, `Unknown take "${input.takeId}".`);
        return;
      }
      res.json(await analyze(input, deps));
    } catch (err) {
      sendError(res, err, deps);
    }
  });

  app.post('/api/tools/:name', async (req, res) => {
    const name = req.params['name'] ?? '';
    const tool = TOOLS[name];
    if (tool === undefined) {
      sendNotFound(res, `Unknown tool "${name}".`);
      return;
    }
    try {
      const takeId = tool.takeIdOf(req.body);
      const out = await withAudit({ tool: name, takeId }, deps.log, () => tool.run(req.body, deps));
      res.json(out);
    } catch (err) {
      sendError(res, err, deps);
    }
  });

  return app;
}
```

`apps/server/src/main.ts`:

```ts
// apps/server/src/main.ts
//
// Boot: validate config, build the dependency record, start the listener.
// bootstrap() is exported so tests can boot the whole server IN-PROCESS on an
// ephemeral port rather than spawning a subprocess.

import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { describeConfig, getConfig, type AppConfig } from './config.js';
import { createApp } from './http.js';
import { createDeps, type ServerDeps } from './pipeline.js';

export interface BootedServer {
  server: Server;
  port: number;
  deps: ServerDeps;
  close: () => Promise<void>;
}

export async function bootstrap(
  cfg: AppConfig,
  overrides: Partial<ServerDeps> = {},
): Promise<BootedServer> {
  const deps = createDeps(cfg, overrides);
  const app = createApp(deps);

  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(cfg.port);
    listener.once('listening', () => resolve(listener));
    listener.once('error', reject);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : cfg.port;
  // describeConfig reports whether the key is set, never its value.
  deps.log('info', 'server.listening', { port, ...describeConfig(cfg) });

  return {
    server,
    port,
    deps,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function main(): Promise<void> {
  await bootstrap(getConfig());
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/http.test.ts` then `npm test`
Expected: PASS — all `@nsh/server` tests green; contracts 18, core-logic 104, widget 3 unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/http.ts apps/server/src/http.test.ts apps/server/src/main.ts
git commit -m "feat(server): HTTP surface with range requests, uploads and error mapping"
```

---

### Task 12: The integration test

**Files:**
- Create: `apps/server/src/integration.test.ts`

**Interfaces:**
- Consumes: `bootstrap` (Task 11); `loadConfig` (Task 1); `FIXTURE_DIR` (Task 3). Produces nothing — this task adds no production code.

**Dependencies:** every preceding task.

**Why this is the plan's most important deliverable:** it reuses the golden lock already covering core-logic to cover the whole assembled system. It fails if any adapter, any tool wrapper, or any wiring step corrupts the pipeline.

**How the comparison excludes `audioUrl`.** The committed fixture says `/fixtures/take-rough.wav`; the server produces `/api/audio/rough`. The field is environment-dependent by construction, so it is removed from **both** objects by destructuring before the deep-equal:

```ts
function withoutAudioUrl(report: DeliveryReport): Omit<DeliveryReport, 'audioUrl'> {
  const { audioUrl: _excluded, ...rest } = report;
  return rest;
}
expect(withoutAudioUrl(actual)).toEqual(withoutAudioUrl(golden));
```

Nothing is masked by that exclusion: the test separately asserts the actual `audioUrl` is `/api/audio/:takeId`, that `isAllowedAudioUrl` accepts it, that `GET` on it really serves bytes, **and** that the golden's `audioUrl` is the different, expected `/fixtures/take-:takeId.wav`. If the two ever converged, the last assertion would fail and the exclusion would be revisited rather than silently hiding a regression.

**Configuration, and why.** `STT_PROVIDER=fixture` (offline, deterministic, design §14) and `ENABLE_PROSODY=false`. The second is not a convenience: `scripts/build-report.mjs` generates both goldens with `{ frames: [], frameHopSec: 0.01 }`, so reproducing them byte-for-byte requires the same empty track. It also keeps the test independent of `ffmpeg-static`. `now` is pinned to `2026-07-25T09:00:00Z`, matching the `next-step-context.json` value the goldens were built with, and the injected clock throws if anything reads it.

- [ ] **Step 1: Write the failing test**

`apps/server/src/integration.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeliveryReport, isAllowedAudioUrl } from '@nsh/contracts';
import { loadConfig } from './config.js';
import { FIXTURE_DIR } from './takes.js';
import { bootstrap } from './main.js';

const NOW = '2026-07-25T09:00:00Z';
const AUDIO_BYTES = Buffer.from('pretend this is a container');

let base: string;
let close: () => Promise<void>;

const golden = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

/**
 * audioUrl is environment-dependent by construction: the committed fixture says
 * /fixtures/take-rough.wav, the server says /api/audio/rough. It is stripped
 * from BOTH sides here, and asserted on separately below.
 */
function withoutAudioUrl(report: DeliveryReport): Omit<DeliveryReport, 'audioUrl'> {
  const { audioUrl: _excluded, ...rest } = report;
  return rest;
}

beforeAll(async () => {
  // A temp audio dir with placeholder files: the recordings are gitignored, and
  // with the fixture STT client and prosody off their contents are never read.
  // They exist so /api/audio/:takeId has something to serve.
  const root = mkdtempSync(join(tmpdir(), 'nsh-integration-'));
  const audioDir = join(root, 'audio');
  const uploadDir = join(audioDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  for (const label of ['rough', 'clean']) {
    writeFileSync(join(audioDir, `take-${label}.m4a`), AUDIO_BYTES);
  }

  const booted = await bootstrap(
    // ENABLE_PROSODY=false: the goldens were generated with an empty
    // ProsodyTrack, so byte-equality requires the same input here.
    loadConfig({ PORT: '0', STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }),
    {
      audioDir,
      uploadDir,
      fixtureDir: FIXTURE_DIR,
      log: () => {},
      clock: () => {
        throw new Error('the clock must not be read when `now` is pinned');
      },
    },
  );
  base = `http://127.0.0.1:${booted.port}`;
  close = booted.close;
});

afterAll(async () => {
  await close();
});

async function analyzeOverHttp(takeId: string): Promise<DeliveryReport> {
  const res = await fetch(`${base}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ takeId, now: NOW }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as DeliveryReport;
}

describe.each(['rough', 'clean'])('POST /api/analyze — %s take', (label) => {
  it('deep-equals the committed golden report, modulo audioUrl', async () => {
    const actual = await analyzeOverHttp(label);
    expect(DeliveryReport.safeParse(actual).success).toBe(true);
    expect(withoutAudioUrl(actual)).toEqual(withoutAudioUrl(golden(label)));
  });

  it('produces an audioUrl the widget can actually load', async () => {
    const actual = await analyzeOverHttp(label);
    expect(actual.audioUrl).toBe(`/api/audio/${label}`);
    expect(isAllowedAudioUrl(actual.audioUrl!)).toBe(true);

    const audio = await fetch(`${base}${actual.audioUrl!}`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(AUDIO_BYTES);
  });

  it('differs from the golden on audioUrl, which is why the field is excluded', async () => {
    const actual = await analyzeOverHttp(label);
    expect(golden(label).audioUrl).toBe(`/fixtures/take-${label}.wav`);
    expect(actual.audioUrl).not.toBe(golden(label).audioUrl);
  });

  it('is byte-stable across repeated calls', async () => {
    const [first, second] = await Promise.all([analyzeOverHttp(label), analyzeOverHttp(label)]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('the numbers the demo turns on', () => {
  it('puts exactly one high-severity stress_mismatch on seg-005 of the rough take', async () => {
    const report = await analyzeOverHttp('rough');
    const high = report.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
    expect(high[0]!.type).toBe('stress_mismatch');
    expect(report.fillerCount).toBe(2);
    expect(report.nextStep!.kind).toBe('calendar_reminder');
    expect(report.nextStep!.executed).toBe(false);
  });

  it('keeps the clean take clean', async () => {
    const report = await analyzeOverHttp('clean');
    expect(report.issues).toHaveLength(2);
    expect(report.issues.every((i) => i.severity === 'low')).toBe(true);
    expect(report.fillerCount).toBe(0);
    expect(report.nextStep!.kind).toBe('draft_note');
    expect(report.nextStep!.executed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Before writing anything, temporarily break the wiring to prove the test can fail: in `apps/server/src/pipeline.ts` change `reportIdFor` to return `` `rpt-${takeId}` ``.

Run: `npm test --workspace @nsh/server -- src/integration.test.ts`
Expected: FAIL with `expected 'rpt-rough' to be 'rpt-demo-rough'` inside the deep-equal diff for both takes.

- [ ] **Step 3: Write the implementation**

Revert the temporary break — restore `reportIdFor` to `` `rpt-demo-${takeId}` ``. This task adds no production code; every line it exercises was written in Tasks 1-11. If the test fails for any other reason, the defect is in one of those tasks and belongs fixed there, not papered over here.

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/server -- src/integration.test.ts` then `npm test` then `npm run typecheck`
Expected: PASS — 10 integration assertions green; the whole `@nsh/server` suite green; contracts 18, core-logic 104, widget 3 unchanged; `tsc --noEmit` clean in every workspace.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/integration.test.ts
git commit -m "test(server): end-to-end golden lock over POST /api/analyze"
```

---

### Task 13: Widget wiring — take picker, upload, offline fallback, Vite proxy

**Files:**
- Modify: `packages/widget/src/App.tsx`
- Modify: `packages/widget/vite.config.ts`
- Test: `packages/widget/src/App.test.ts`

**Interfaces:**
- Consumes: the server's `GET /api/takes`, `POST /api/uploads`, `POST /api/analyze`, `POST /api/tools/suggest_next_step` (Task 11).
- Produces (all exported from `App.tsx` so they are testable without rendering):
  - `interface TakeOption { id: string; label: string; mimeType: string; hasFrozenTranscript: boolean }`
  - `class ApiError extends Error { readonly code: string; readonly status: number }`
  - `fetchTakes(f?: typeof fetch): Promise<TakeOption[]>`
  - `analyzeTake(takeId: string, now?: string | null, f?: typeof fetch): Promise<DeliveryReport>`
  - `uploadTake(file: File, f?: typeof fetch): Promise<string>`
  - `executeNextStep(report: DeliveryReport, takeId: string, f?: typeof fetch): Promise<NextStep>`
  - `OFFLINE_TAKES: TakeOption[]`
  - `offlineReport(takeId: string): DeliveryReport | null`
  - `default function App()`

**Dependencies:** Task 11 (route shapes).

**Scope rule:** no component below `App.tsx` changes. `DeliveryTimelineWidget` still takes one `DeliveryReport` prop. Only `App.tsx`, `vite.config.ts`, and a new colocated test file are touched. If anything deeper needs changing, the contract failed and the fix belongs in the report shape.

**Offline fallback:** if the server is unreachable the widget still renders a report from the two committed fixtures. A demo that dies with the server is worse than one that degrades.

- [ ] **Step 1: Write the failing test**

`packages/widget/src/App.test.ts`:

```ts
import type { DeliveryReport } from '@nsh/contracts';
import cleanFixture from '../../contracts/fixtures/report.clean.json';
import {
  ApiError,
  OFFLINE_TAKES,
  analyzeTake,
  executeNextStep,
  fetchTakes,
  offlineReport,
  uploadTake,
} from './App';

interface Call {
  url: string;
  init: RequestInit;
}

function stub(response: Response, calls: Call[] = []): { f: typeof fetch; calls: Call[] } {
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('fetchTakes unwraps the takes array', async () => {
  const { f, calls } = stub(
    json({ takes: [{ id: 'rough', label: 'Rough take', mimeType: 'audio/mp4', hasFrozenTranscript: true }] }),
  );
  const takes = await fetchTakes(f);
  expect(takes).toHaveLength(1);
  expect(takes[0]!.id).toBe('rough');
  expect(calls[0]!.url).toBe('/api/takes');
});

test('fetchTakes raises ApiError carrying the server code', async () => {
  const { f } = stub(json({ error: { code: 'INTERNAL', message: 'Internal server error.' } }, 500));
  await expect(fetchTakes(f)).rejects.toBeInstanceOf(ApiError);
  await expect(fetchTakes(f)).rejects.toMatchObject({ code: 'INTERNAL', status: 500 });
});

test('analyzeTake posts the take id and returns the report', async () => {
  const { f, calls } = stub(json(cleanFixture));
  const report = await analyzeTake('clean', null, f);
  expect(report.reportId).toBe('rpt-demo-clean');
  expect(calls[0]!.url).toBe('/api/analyze');
  expect(calls[0]!.init.method).toBe('POST');
  expect(JSON.parse(String(calls[0]!.init.body)) as unknown).toEqual({ takeId: 'clean' });
});

test('analyzeTake pins `now` when one is supplied', async () => {
  const { f, calls } = stub(json(cleanFixture));
  await analyzeTake('clean', '2026-07-25T09:00:00Z', f);
  expect(JSON.parse(String(calls[0]!.init.body)) as unknown).toEqual({
    takeId: 'clean',
    now: '2026-07-25T09:00:00Z',
  });
});

test('analyzeTake surfaces a CoachError code from the server', async () => {
  const { f } = stub(json({ error: { code: 'SCRIPT_EMPTY', message: 'Script is empty.' } }, 400));
  await expect(analyzeTake('clean', null, f)).rejects.toMatchObject({
    code: 'SCRIPT_EMPTY',
    status: 400,
    message: 'Script is empty.',
  });
});

test('uploadTake posts multipart to /api/uploads and returns the new take id', async () => {
  const { f, calls } = stub(json({ takeId: 'up-0123456789ab' }));
  const file = new File([new Blob(['fake audio'])], 'clip.mp3', { type: 'audio/mpeg' });
  expect(await uploadTake(file, f)).toBe('up-0123456789ab');
  expect(calls[0]!.url).toBe('/api/uploads');
  expect(calls[0]!.init.method).toBe('POST');
  expect(calls[0]!.init.body).toBeInstanceOf(FormData);
  expect((calls[0]!.init.body as FormData).get('file')).toBeInstanceOf(File);
});

test('executeNextStep asks the server to execute and returns the receipt', async () => {
  const report = structuredClone(cleanFixture) as DeliveryReport;
  const executed = { ...report.nextStep!, executed: true };
  const { f, calls } = stub(json(executed));

  const step = await executeNextStep(report, 'clean', f);
  expect(step.executed).toBe(true);
  expect(calls[0]!.url).toBe('/api/tools/suggest_next_step');
  const body = JSON.parse(String(calls[0]!.init.body)) as { takeId: string; execute: boolean; now: string };
  expect(body.takeId).toBe('clean');
  expect(body.execute).toBe(true);
  expect(typeof body.now).toBe('string');
});

test('offlineReport serves the committed fixtures and nothing else', () => {
  expect(offlineReport('rough')!.reportId).toBe('rpt-demo-rough');
  expect(offlineReport('clean')!.reportId).toBe('rpt-demo-clean');
  expect(offlineReport('up-0123456789ab')).toBeNull();
});

test('offlineReport returns a fresh clone each call so the widget cannot mutate the fixture', () => {
  const first = offlineReport('rough')!;
  first.issues.length = 0;
  expect(offlineReport('rough')!.issues.length).toBeGreaterThan(0);
});

test('OFFLINE_TAKES covers exactly the two staged takes', () => {
  expect(OFFLINE_TAKES.map((t) => t.id)).toEqual(['clean', 'rough']);
  expect(OFFLINE_TAKES.every((t) => t.hasFrozenTranscript)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/widget -- src/App.test.ts`
Expected: FAIL with `No "ApiError" export is defined on the "./App" module` (the current `App.tsx` exports only the default component).

- [ ] **Step 3: Write the implementation**

`packages/widget/src/App.tsx` — complete replacement file:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeliveryTimelineWidget from './widget/DeliveryTimelineWidget';
import type { DeliveryReport, NextStep } from '@nsh/contracts';
import cleanFixture from '../../contracts/fixtures/report.clean.json';
import roughFixture from '../../contracts/fixtures/report.rough.json';

/* ---------------------------------------------------------------------- *
 * Server seam. Everything below is exported so it can be unit-tested with
 * an injected fetch, and so nothing under ./widget/ needs to know a server
 * exists. Vite proxies /api to the server port, so there is no CORS setup.
 * ---------------------------------------------------------------------- */

export interface TakeOption {
  id: string;
  label: string;
  mimeType: string;
  hasFrozenTranscript: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let code = 'INTERNAL';
  let message = `Request failed with HTTP ${res.status}.`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    /* non-JSON error body — keep the defaults */
  }
  throw new ApiError(code, message, res.status);
}

export async function fetchTakes(f: typeof fetch = fetch): Promise<TakeOption[]> {
  const body = await unwrap<{ takes: TakeOption[] }>(await f('/api/takes'));
  return body.takes;
}

export async function analyzeTake(
  takeId: string,
  now: string | null = null,
  f: typeof fetch = fetch,
): Promise<DeliveryReport> {
  const payload = now === null ? { takeId } : { takeId, now };
  const res = await f('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap<DeliveryReport>(res);
}

export async function uploadTake(file: File, f: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const body = await unwrap<{ takeId: string }>(await f('/api/uploads', { method: 'POST', body: form }));
  return body.takeId;
}

/**
 * The confirm step. decideNextStep only ever proposes; this is the call that
 * fires the connector and comes back with executed:true.
 */
export async function executeNextStep(
  report: DeliveryReport,
  takeId: string,
  f: typeof fetch = fetch,
): Promise<NextStep> {
  const res = await f('/api/tools/suggest_next_step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, takeId, now: new Date().toISOString(), execute: true }),
  });
  return unwrap<NextStep>(res);
}

/* ---------------------------------------------------------------------- *
 * Offline fallback. Design §13: if the server is unreachable the widget
 * still renders a report. A demo that dies with the server is worse than
 * one that degrades.
 * ---------------------------------------------------------------------- */

const OFFLINE_FIXTURES: Record<string, unknown> = {
  clean: cleanFixture,
  rough: roughFixture,
};

export const OFFLINE_TAKES: TakeOption[] = [
  { id: 'clean', label: 'Clean take', mimeType: 'audio/mp4', hasFrozenTranscript: true },
  { id: 'rough', label: 'Rough take', mimeType: 'audio/mp4', hasFrozenTranscript: true },
];

export function offlineReport(takeId: string): DeliveryReport | null {
  const fixture = OFFLINE_FIXTURES[takeId];
  if (fixture === undefined) return null;
  return structuredClone(fixture) as DeliveryReport;
}

/* ---------------------------------------------------------------------- */

type Phase = 'loading' | 'ready' | 'error';

export default function App() {
  const [takes, setTakes] = useState<TakeOption[]>(OFFLINE_TAKES);
  const [takeId, setTakeId] = useState<string>('rough');
  const [report, setReport] = useState<DeliveryReport | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTakes()
      .then((live) => {
        if (cancelled || live.length === 0) return;
        setTakes(live);
        setOffline(false);
      })
      .catch(() => {
        if (cancelled) return;
        setOffline(true);
        setNotice('Server unreachable — showing the committed fixtures.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback((id: string) => {
    setPhase('loading');
    setNotice('');
    analyzeTake(id)
      .then((live) => {
        setReport(live);
        setPhase('ready');
        setOffline(false);
      })
      .catch((err: unknown) => {
        const fallback = offlineReport(id);
        if (fallback !== null) {
          setReport(fallback);
          setPhase('ready');
          setOffline(true);
          setNotice('Server unreachable — showing the committed fixture for this take.');
          return;
        }
        setPhase('error');
        setNotice(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Analysis failed.');
      });
  }, []);

  useEffect(() => {
    load(takeId);
  }, [takeId, load]);

  const onUpload = useCallback(
    (file: File) => {
      setPhase('loading');
      setNotice(`Uploading ${file.name}…`);
      uploadTake(file)
        .then(async (id) => {
          setTakes(await fetchTakes());
          setTakeId(id);
        })
        .catch((err: unknown) => {
          setPhase('error');
          setNotice(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Upload failed.');
        });
    },
    [],
  );

  const onExecute = useCallback(
    (step: NextStep) => {
      if (report === null || offline) return;
      executeNextStep(report, takeId)
        .then((executed) => setReport((prev) => (prev === null ? prev : { ...prev, nextStep: executed })))
        .catch((err: unknown) => {
          setNotice(err instanceof ApiError ? `${err.code}: ${err.message}` : `Could not execute ${step.kind}.`);
        });
    },
    [report, takeId, offline],
  );

  const activeLabel = useMemo(
    () => takes.find((t) => t.id === takeId)?.label ?? takeId,
    [takes, takeId],
  );

  return (
    <div className="dev-shell">
      <header className="dev-header">
        <h1>Delivery Coach · Timeline Widget</h1>
        <div className="fixture-tabs" role="tablist">
          {takes.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={takeId === t.id}
              className={`fixture-tab ${takeId === t.id ? 'active' : ''}`}
              onClick={() => setTakeId(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files.item(0);
          if (file !== null) onUpload(file);
        }}
        style={{
          background: 'rgba(148,163,184,0.05)',
          border: '1px dashed var(--border)',
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 12.5,
          color: 'var(--text-dim)',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: 'var(--text)' }}>{activeLabel}.</strong>{' '}
        Drop a recording here, or{' '}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          style={{ background: 'none', border: 0, color: 'var(--text)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          choose a file
        </button>
        .
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.item(0) ?? null;
            if (file !== null) onUpload(file);
          }}
        />
        {notice === '' ? null : (
          <div style={{ marginTop: 6, color: offline ? '#fbbf24' : 'var(--text-dim)' }}>{notice}</div>
        )}
      </div>

      {phase === 'error' || report === null ? (
        <div style={{ padding: 24, color: 'var(--text-dim)' }}>
          {phase === 'error' ? notice : 'Analyzing…'}
        </div>
      ) : (
        <DeliveryTimelineWidget
          key={report.reportId + '|' + report.status}
          report={phase === 'loading' ? { ...report, status: 'analyzing' } : report}
          onNextStepExecute={onExecute}
        />
      )}
    </div>
  );
}
```

`packages/widget/vite.config.ts` — complete replacement file:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const SERVER_PORT = process.env['PORT'] ?? '8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nsh/contracts': path.resolve(__dirname, '../contracts/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: [__dirname, path.resolve(__dirname, '../contracts')],
    },
    // Design §13: proxying /api to the server port means there is no CORS
    // configuration anywhere in this project.
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: false,
      },
    },
  },
});
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @nsh/widget` then `npm test`
Expected: PASS — widget goes from 3 to 13 tests, all green; contracts 18, core-logic 104, `@nsh/server` all still green.

- [ ] **Step 5: Commit**

```bash
git add packages/widget/src/App.tsx packages/widget/src/App.test.ts packages/widget/vite.config.ts
git commit -m "feat(widget): live take picker, upload and offline fixture fallback"
```

---

### Task 14: Root dev script and README

**Files:**
- Modify: `package.json` (root)
- Modify: `README.md`
- Modify: `package-lock.json` (via `npm install`)
- Test: `apps/server/src/workspace-scripts.test.ts`

**Interfaces:**
- Consumes: the `dev` scripts declared in `apps/server/package.json` (Task 1) and `packages/widget/package.json` (unchanged).
- Produces: root `npm run dev`.

**Dependencies:** Tasks 1 and 13.

**Note on the added dependency:** `concurrently` is a root devDependency only. Spec §15 governs runtime dependencies reaching the packages; this one reaches none of them, and it is what makes "one command" work identically on Windows (`&` backgrounding is not available in cmd/PowerShell) and on POSIX.

- [ ] **Step 1: Write the failing test**

`apps/server/src/workspace-scripts.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './takes.js';

interface Manifest {
  name?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
}

const manifest = (relative: string): Manifest =>
  JSON.parse(readFileSync(join(REPO_ROOT, relative), 'utf8')) as Manifest;

describe('the one-command demo path', () => {
  const root = manifest('package.json');

  it('exposes a root dev script that starts both halves', () => {
    expect(root.scripts?.['dev']).toBeDefined();
    expect(root.scripts?.['dev:server']).toBeDefined();
    expect(root.scripts?.['dev:widget']).toBeDefined();
    expect(root.scripts!['dev']).toContain('dev:server');
    expect(root.scripts!['dev']).toContain('dev:widget');
  });

  it('targets workspaces that actually declare a dev script', () => {
    const server = manifest('apps/server/package.json');
    const widget = manifest('packages/widget/package.json');
    expect(server.name).toBe('@nsh/server');
    expect(widget.name).toBe('@nsh/widget');
    expect(server.scripts?.['dev']).toBeDefined();
    expect(widget.scripts?.['dev']).toBeDefined();
    expect(root.scripts!['dev:server']).toContain(server.name!);
    expect(root.scripts!['dev:widget']).toContain(widget.name!);
  });

  it('declares the runner it depends on', () => {
    expect(root.devDependencies?.['concurrently']).toBeDefined();
  });

  it('keeps apps/* in the workspace glob so @nsh/server resolves', () => {
    expect(root.workspaces).toContain('apps/*');
  });
});

describe('README', () => {
  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

  it('documents the one command and the offline default', () => {
    expect(readme).toContain('npm run dev');
    expect(readme).toContain('STT_PROVIDER');
    expect(readme).toContain('http://127.0.0.1:5173');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @nsh/server -- src/workspace-scripts.test.ts`
Expected: FAIL with `expected undefined to be defined` on `root.scripts?.['dev']`.

- [ ] **Step 3: Write the implementation**

`package.json` (root) — complete replacement file:

```json
{
  "name": "nsh",
  "private": true,
  "version": "0.1.0",
  "description": "Delivery-Correction Speech Coach Agent — NitroStack x MCP To The Moon",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "sync:contracts": "node scripts/sync-contracts.mjs",
    "dev": "concurrently -n server,widget -c cyan,magenta \"npm:dev:server\" \"npm:dev:widget\"",
    "dev:server": "npm run dev --workspace @nsh/server",
    "dev:widget": "npm run dev --workspace @nsh/widget"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "concurrently": "^9.1.0",
    "tsx": "^4.23.1",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Then run `npm install` to record `concurrently` in `package-lock.json`.

`README.md` — replace the existing `## Getting started` and `## Status` sections with the following, leaving everything above `## Getting started` untouched (four-backtick fence here because the block itself contains fenced
code):

````markdown
## Getting started

```bash
npm install
```

Then confirm the contract typechecks:

```bash
npm run typecheck
```

## Running the demo

One command brings up the server and the widget:

```bash
npm run dev
```

- Widget: <http://127.0.0.1:5173>
- Server: <http://127.0.0.1:8787> (`GET /api/health` reports the effective adapter selection)

Vite proxies `/api` to the server, so there is no CORS configuration. Pick a take
in the header to analyse it live, or drop a recording onto the panel to upload
and analyse a new one.

`STT_PROVIDER` defaults to `fixture`, so a clean checkout runs **offline and
deterministic**: the staged takes replay the frozen transcripts in
`packages/contracts/fixtures/`. Live Deepgram is opt-in:

```bash
STT_PROVIDER=deepgram DEEPGRAM_API_KEY=... npm run dev
```

The key is read once, in `apps/server/src/config.ts`, and never logged. A
missing key with `STT_PROVIDER=deepgram` fails at boot rather than mid-demo.

`ENABLE_PROSODY=false` skips the ffmpeg decode entirely — useful if
`ffmpeg-static` has no binary for your platform. Prosody only feeds the
key-point rising-pitch check; every other rule derives from word timings.

If the server is unreachable the widget falls back to the committed report
fixtures rather than rendering nothing.

## Tests

```bash
npm test
```

The one that matters most is `apps/server/src/integration.test.ts`: it boots the
server in-process, posts to `/api/analyze` for both staged takes, and asserts
the response deep-equals the committed golden report. It fails if any adapter,
tool wrapper, or wiring step corrupts the pipeline.

## Status

Integration complete — the pipeline runs end-to-end behind HTTP and the widget
renders live reports. NitroStack decorators replace only the transport layer
from here.
````

- [ ] **Step 4: Run tests**

Run: `npm install && npm test --workspace @nsh/server -- src/workspace-scripts.test.ts` then `npm test` then `npm run typecheck`
Expected: PASS — every suite green.

Then verify the command itself: run `npm run dev`, confirm `http://127.0.0.1:8787/api/health` returns `{"ok":true,"sttProvider":"fixture",...}` and `http://127.0.0.1:5173` renders the rough take with the red tick on `seg-005`, then stop it.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json README.md apps/server/src/workspace-scripts.test.ts
git commit -m "chore: one-command dev script and demo instructions"
```

---

## Plan self-review

### 1. Spec coverage

| Spec section | Covered by |
|---|---|
| §1 Goal | Tasks 10-14; success criterion asserted in Task 12 |
| §2 Current state / four P2 divergences | Task 4 (`SttClient` signature, `Word` shape, no second lexicon), Task 9 (`NextStep.kind: 'none'` + `rationale`) |
| §3 Architecture / layering | Task 1 (workspace), Global Constraints |
| §4 Package layout | File Structure table — every file present |
| §5.1 `stt-client.ts` | Task 4 |
| §5.2 `audio-decode.ts` | Task 5 |
| §5.3 `connectors.ts` | Task 6 |
| §6 The five tools | Tasks 7, 8, 9 |
| §7 HTTP surface (6 routes, take ids, range) | Task 11 |
| §8 Data flow | Task 10 |
| §9 Shared context fixture | Task 6, including the byte-identical regeneration gate |
| §10 Error handling | Task 2 (table), Task 11 (route mapping) |
| §11 Configuration | Task 1 (schema, cross-field), Task 7 (`AUDIO_MAX_SECONDS`), Task 11 (`UPLOAD_MAX_BYTES`) |
| §12 Observability | Task 2 (`withAudit`), Task 10 (five audit lines), Task 11 (tools route) |
| §13 Widget changes | Task 13 |
| §14 Testing | Every task's Step 1; Task 12 is the integration test |
| §15 Dependencies added | Task 1 (`express`, `multer`, `ffmpeg-static`); Task 14 adds root-only `concurrently` |
| §16 Explicitly deferred | Not implemented, by design. The AssemblyAI branch that "has the branch, and it throws" is in Task 4 and tested |
| §17 Risks | Task 5 (ffmpeg degradation), Task 3 + Task 10 (report-id determinism), Task 11 (upload path) |

**Gaps found and fixed inline:**
- §16's "the factory has the branch, and it throws" was initially unrepresented; Task 4 now has an explicit `assemblyai` test.
- §11's `UPLOAD_MAX_BYTES` had no enforcement point in the first draft of Task 11; it is now a multer limit with a 413 test.
- §7's range requests needed suffix and open-ended forms, not just `bytes=a-b`; Task 11 covers all three plus 416.
- The `executed` and `ENABLE_PROSODY` contradictions between §6/§14 and the committed fixtures are resolved in "Two reconciliations" rather than left for an implementer to discover at Task 12.

**Not covered, deliberately:** everything in §16 (NitroStack decorators, OAuth/JWT guard, real Gmail/Calendar MCP composition, Ops Canvas, AssemblyAI implementation). The spec defers them; this plan adds only the interface seams they will land behind.

### 2. Placeholder scan

Searched this document for `TBD`, `TODO`, `FIXME`, `...` used as elision, "similar to", "same as Task", "appropriate", "handle edge cases", "etc.". No occurrences. Every code block is complete and runnable: `pipeline.ts` is written in full in both Task 7 and Task 10 rather than diffed, `package.json` and `vite.config.ts` are given as whole files, and `build-report.mjs` and `App.tsx` are complete replacements.

### 3. Type consistency across tasks

Checked every cross-task reference by name and signature:

- `AppConfig` / `loadConfig` / `getConfig` / `describeConfig` (T1) — consumed identically in T4, T7, T10, T11, T12.
- `Logger` (T2) — one definition in `audit.ts`; consumed as `deps.log` in T5, T7, T9, T10, T11. This is why `audit.ts` moved into Task 2.
- `withAudit({ tool, takeId }, log, fn)` (T2) — same argument order in T10 and T11.
- `mapError(err): MappedError` (T2) — used in T2's `withAudit` and T11's `sendError`.
- `resolveTakeAudio(audioDir, uploadDir, takeId)` (T3) — same three-argument order in T7 and T11.
- `listTakes(audioDir, uploadDir, fixtureDir)` (T3) — same in T11 (twice).
- `uploadTakeId(bytes)` / `uploadFilenameFor(takeId, originalName)` (T3) — same in T11.
- `createSttClient(cfg, takeId, fixtureDir)` (T4) — matches `ServerDeps.createStt` exactly (T7, T10) and the override in T7's test.
- `prosodyForFile({ filePath, enabled, decode, log })` (T5) — same object shape in T7.
- `emptyProsody()` (T5) — used in T5, T7, T8 tests.
- `ContextProvider.nextStepContext(takeId, now)` (T6) — same in T9.
- `CalendarConnector.createReminder(title, startsAt)` / `GmailConnector.draft(subject, body, to)` (T6) — same in T9's spies and implementation.
- `ServerDeps` (T7, rewritten identically in T10) — field-for-field the same record; T10's version adds no fields.
- `parseScriptTool(input)`, `transcribeDeliveryTool(input, deps)`, `correlateSegmentsTool(input)`, `generateSummaryTool(input)`, `suggestNextStepTool(input, deps)` — the names and arities used in T10's `analyze` and T11's `TOOLS` registry match their defining tasks exactly.
- `reportIdFor` / `audioUrlFor` (T10) — used in T10 and asserted in T12.
- `bootstrap(cfg, overrides)` (T11) — called with the same shape in T11's and T12's tests.
- `TakeOption` (T13) — structurally identical to `TakeInfo` (T3), which is what `GET /api/takes` serialises.

One naming decision recorded so it is not "fixed" later: the server-side type is `TakeInfo` and the widget-side type is `TakeOption`. They are deliberately separate declarations because the widget must not import from `apps/server` (layering rule); the widget's version is validated against the real route shape by Task 13's `fetchTakes` test and by Task 11's `GET /api/takes` test.
