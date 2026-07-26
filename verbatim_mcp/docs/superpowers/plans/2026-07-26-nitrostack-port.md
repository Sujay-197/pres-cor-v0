# NitroStack Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the finished, tested "Delivery-Correction Speech Coach Agent" logic from the reference repo (`C:\Users\Good Day\Desktop\work\nsh`, plain TypeScript workspaces) into the target repo (`C:\Users\Good Day\Desktop\work\nsh\verbatim_mcp`, a NitroStack `typescript-pizzaz` scaffold) as a real MCP server with five tools, a hero timeline widget, an authed connector-action seam, and a golden end-to-end test — preserving the SPEC §8 demo behaviour byte-for-byte.

**Architecture:** The reference repo's pure `core-logic` and frozen `contracts` port almost verbatim into `src/domain/` (imports rewritten from workspace specifiers to relative paths). The reference's Express `apps/server` layer is re-expressed as NitroStack: `@Injectable` services for config/adapters, five `@Tool` methods on one controller, one composed `analyze_delivery` `@Tool` + `@Widget` that feeds the timeline widget via `getToolOutput()`, a `CoachExceptionFilter` translating `CoachError.code`, an `AuditInterceptor`, and a permissive-but-present `NextStepGuard` seam on the one connector-firing tool. The React widget ports into a Next.js page under `src/widgets/app/`.

**Tech Stack:** `@nitrostack/core` (DI, `@Tool`, `@Widget`, `@McpApp`, guards/filters/interceptors, `JWTModule`, `ConfigModule`), `@nitrostack/core/testing` (`TestingModule`, `MockLogger`, `createMockContext`), `@nitrostack/widgets` (`useWidgetSDK`, `useWidgetState`), Zod, Vitest, `ffmpeg-static` + `pitchfinder` (prosody), Next.js 14 (widget), TypeScript 5 strict.

---

## Global Constraints

Every task inherits all of these. They are copied verbatim from `CONVENTIONS.md`, the reference SPEC/brief, and the two security fixes called out in the port brief.

- **Time is always float seconds.** Never milliseconds anywhere downstream of the STT adapter boundary. The STT adapter is the only place ms→s conversion happens.
- **IDs are deterministic, never random.** `seg-NNN` in source order; `iss-NNN` in ascending-timestamp order assigned *after* sorting. Same input ⇒ byte-identical report. The rehearsed demo click-path breaks if IDs shuffle.
- **Core logic is pure.** No `Date.now()`, no `Math.random()`, no `fs`, no network, and **no NitroStack import** inside `src/domain/`. Anything ambient (`now`, clock, connectors) arrives as an argument or via DI at the tool layer, never inside `src/domain/`.
- **Never throw a raw `Error` across a tool boundary.** Domain code throws `CoachError` with a stable `code`; the `CoachExceptionFilter` maps `code` → structured client-safe payload. `CoachError.context` is logged, **never returned to the client** (it can carry input fragments or secrets).
- **`BAD_INPUT` is the schema-validation failure code.** `@Tool({ inputSchema })` rejects malformed MCP input before the handler runs; the filter renders framework validation errors under the same client contract as `CoachError('BAD_INPUT', …)`.
- **SECURITY — execute-gating (must survive the port intact):** the composed `analyze_delivery` path MUST NEVER pass `execute: true` into the next-step logic. `decideNextStep` always returns `executed: false`. Only a direct, explicit call to the `suggest_next_step` tool with `execute: true` may fire `CalendarConnector`/`GmailConnector`. Do not add an `execute` field to `analyze_delivery`'s input schema. A real vulnerability (a pipeline forwarding a caller-supplied `execute` flag) was fixed in the reference; do not reintroduce it.
- **SECURITY — path traversal (must survive the port intact):** any identifier from tool input that reaches a filesystem path MUST pass the allow-list regex `TAKE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/` AND a resolved-path containment check (`resolve(path).startsWith(resolve(baseDir) + sep)`). Uploaded filenames go through `path.basename` + containment (the NitroStack `tools-resources-prompts` skill recommends the identical pattern).
- **WPM excludes filler words and divides by voiced time** (sum of segment durations), not wall-clock. A pause is a gap `> 0.35s`. Baseline is the speaker's own, computed from this recording only — never a population average.
- **`isFiller` is set by our code, not the vendor.** Deepgram query params `model=nova-3&filler_words=true&punctuate=true&smart_format=false&numerals=false` are load-bearing; `smart_format` and `numerals` MUST stay `false` (they rewrite spoken numbers to digits and break script matching).
- **Severity is data, not control flow.** Verdicts live in `SEVERITY_RULES` (in `thresholds.ts`); every issue names the rule that produced it via `DecisionTrace.rule` for the Ops Canvas.
- **Prosody degrades, never fatal.** A missing/failing `ffmpeg-static` binary or unreadable container → empty `ProsodyTrack` (`{ frames: [], frameHopSec: 0.01 }`), logged as a warning. Only `AUDIO_TOO_SHORT` (thrown by `extractProsody` itself, not by decode) propagates as a real error. Keep the try/catch scoped to `decode()` only, never widened to wrap `extractProsody()`.
- **Secrets read in exactly one place.** `AppConfigService` is the only code that touches `process.env`; it validates with Zod once and is injected everywhere else. Never log or return an API key — presence only.
- **Tests:** Vitest, colocated `*.test.ts`. No vacuous assertions (`expect(x).toBeTruthy()` where any value passes). The golden end-to-end test against `fixtures/report.{clean,rough}.json` is the single most important test — it is the earliest warning the stage demo changed behaviour.
- **Fixtures are golden.** Copy `script.demo.md`, `transcript.{clean,rough}.json`, `report.{clean,rough}.json`, `next-step-context.json` verbatim from the reference repo. Never regenerate or hand-edit them.
- **Every `git add` lists only the files that task's own steps create or modify.** Commit messages end with the trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.

### Documented architecture decisions (made explicit per the brief)

1. **No npm workspaces.** `verbatim_mcp` is a single package. `contracts` and `core-logic` become local source directories under `src/domain/`, imported by relative path (`../contracts/index.js`), NOT as `@nsh/contracts`. Import-specifier rewrites are the *only* change to the ported pure files.
2. **`parseToolInput` is NOT ported for tool inputs.** NitroStack's `@Tool({ inputSchema })` validates MCP input at the boundary before the handler runs (confirmed in the `tools-resources-prompts` skill doc). The composed `analyze_delivery` path passes already-typed, already-validated data between internal service calls (TypeScript-enforced), so no runtime re-validation is needed there. **`assertToolOutput` IS ported** (as a tiny helper) — it catches core-logic contract drift and maps to `INTERNAL`, which framework input validation cannot do.
3. **`CoachError` taxonomy is preserved via a `CoachExceptionFilter implements ExceptionFilterInterface`.** It translates `CoachError.code` into a stable structured response `{ error: { code, message } }` and keeps `context` out of the returned payload — the direct analog of the reference `mapError`. Applied at the controller level via `@UseFilters`.
4. **Auth seam is present but permissive.** `JWTModule.forRoot` is imported; a `NextStepGuard implements Guard` is applied via `@UseGuards` on `suggest_next_step` only (the one connector-firing tool). It currently returns `true` (allows everything) with an explicit documented pre-deploy TODO and a real JWT verification code path gated behind `JWT_SECRET` presence. This follows the codebase's established "interface now, real enforcement at deploy" pattern.
5. **File input via base64 tool input.** The reference's Express `/api/uploads` multipart route does NOT port. `transcribe_delivery` gains optional `file_name`/`file_type`/`file_content` fields (base64, raw or data-URL); staged fixture takes are still addressed by `takeId`. Uploaded audio is saved with the path-traversal-safe pattern.
6. **`noUncheckedIndexedAccess: true` IS added** to the root `tsconfig.json`. The ported core-logic was authored with it on (it relies on `!` assertions and `Float64Array` flat matrices precisely to satisfy it); porting verbatim requires it. Friction risk is limited to new framework-adjacent code, which we write to satisfy it. `src/widgets` is excluded from the root tsconfig and keeps its own config.
7. **`ffmpeg-static` under NitroCloud is treated as unproven.** The port preserves graceful degradation as a first-class, tested behaviour (Task 11) rather than assuming the binary ships in the build environment.

### Reference-repo source map (exact paths to copy/adapt from)

| Target file | Reference source |
|---|---|
| `src/domain/contracts/index.ts` | `packages/contracts/src/index.ts` |
| `src/domain/core-logic/*.ts` | `packages/core-logic/src/*.ts` |
| `src/adapters/stt-client.ts` | `apps/server/src/adapters/stt-client.ts` |
| `src/adapters/audio-decode.ts` | `apps/server/src/adapters/audio-decode.ts` |
| `src/adapters/connectors.ts` | `apps/server/src/adapters/connectors.ts` |
| `src/adapters/takes.ts` | `apps/server/src/takes.ts` |
| `src/config/app-config.service.ts` | `apps/server/src/config.ts` |
| widget components | `packages/widget/src/widget/*.tsx`, `utils.ts` |
| fixtures | `packages/contracts/fixtures/*` |

**Import-rewrite rule for every ported file:** replace `from '@nsh/contracts'` and `from '@nsh/contracts.js'` with the correct relative path to `src/domain/contracts/index.js`; replace `from '@nsh/core-logic'` with the correct relative path to `src/domain/core-logic/index.js`. Keep all intra-directory relative imports (`./errors.js`, etc.) unchanged. Keep `.js` extensions on every relative import (the scaffold is ESM, `type: module`).

---

## Task 1: Test tooling, TypeScript config, and runtime dependencies

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts, devDependencies, dependencies, keywords)
- Modify: `tsconfig.json` (add `noUncheckedIndexedAccess`, `vitest/globals` types)
- Create: `src/domain/sanity.test.ts` (temporary, deleted in this task's last step)

**Interfaces:**
- Produces: an `npm test` script (`vitest run`) and `npm run test:watch` (`vitest`), used by every later task.

- [ ] **Step 1: Write the failing sanity test**

`src/domain/sanity.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';

describe('vitest wiring', () => {
  it('runs and can fail', () => {
    // Would fail if the runner were misconfigured or globals absent.
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify the runner is not yet configured**

Run: `npm test`
Expected: FAIL — `test` script is still the pizzaz default / `vitest` not installed.

- [ ] **Step 3: Install dev + runtime dependencies**

Run:
```bash
npm install -D vitest@^2.1.0
npm install ffmpeg-static@^5.2.0 pitchfinder@^2.3.2
```
(`vitest@^2.1.0` matches the reference root `package.json`; `ffmpeg-static`/`pitchfinder` are the prosody runtime deps used by `src/domain/core-logic/prosody.ts` and `src/adapters/audio-decode.ts`.)

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The Next.js widget app has its own toolchain and its own tsconfig.
    exclude: ['node_modules', 'dist', 'src/widgets/**'],
  },
});
```

- [ ] **Step 5: Update `package.json` scripts and keywords**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit"
```
Replace `"keywords"` with:
```json
"keywords": ["nitrostack", "mcp", "speech-coach", "delivery", "widgets"]
```

- [ ] **Step 6: Add `noUncheckedIndexedAccess` and test globals to `tsconfig.json`**

In `compilerOptions`, add `"noUncheckedIndexedAccess": true`. Change `"types": ["node"]` to `"types": ["node", "vitest/globals"]`. Leave `"exclude": ["node_modules", "dist", "src/widgets"]` as-is.

- [ ] **Step 7: Run the sanity test to verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 8: Delete the sanity test and commit**

```bash
rm src/domain/sanity.test.ts
git add vitest.config.ts package.json package-lock.json tsconfig.json
git commit -m "chore: add vitest, prosody deps, and strict index access"
```

---

## Task 2: Scaffold cleanup — strip pizzaz to an empty shell

**Files:**
- Delete: `src/modules/pizzaz/` (all files), `src/widgets/app/pizza-list/`, `src/widgets/app/pizza-map/`, `src/widgets/app/pizza-shop/`, `src/widgets/components/CompactShopCard.tsx`, `src/widgets/components/PizzaCard.tsx`
- Modify: `src/app.module.ts`
- Modify: `src/widgets/widget-manifest.json`
- Create: `src/widgets/app/page.tsx` (placeholder index so Next.js has a root route)

**Interfaces:**
- Produces: `AppModule` with only `ConfigModule.forRoot()` imported; a boot that starts with zero tools registered.

- [ ] **Step 1: Write the failing test — the app boots with no pizzaz**

`src/app.module.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('scaffold cleanup', () => {
  it('has removed the pizzaz module', () => {
    expect(existsSync(join(process.cwd(), 'src/modules/pizzaz'))).toBe(false);
  });

  it('AppModule source no longer references pizzaz', () => {
    const src = readdirSync(join(process.cwd(), 'src'));
    expect(src).toContain('app.module.ts');
    const text = require('node:fs').readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    expect(text.toLowerCase()).not.toContain('pizzaz');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/app.module.test.ts`
Expected: FAIL — `src/modules/pizzaz` still exists and `app.module.ts` still imports `PizzazModule`.

- [ ] **Step 3: Delete pizzaz sources and pizza widget pages/components**

```bash
rm -rf src/modules/pizzaz
rm -rf src/widgets/app/pizza-list src/widgets/app/pizza-map src/widgets/app/pizza-shop
rm -f src/widgets/components/CompactShopCard.tsx src/widgets/components/PizzaCard.tsx
```

- [ ] **Step 4: Reduce `src/app.module.ts` to an empty shell**

```typescript
import { McpApp, Module, ConfigModule } from '@nitrostack/core';

/**
 * Root application module — Delivery-Correction Speech Coach.
 * Feature modules are added in Task 16 (CoachModule) and Task 14 (JWTModule).
 */
@McpApp({
  module: AppModule,
  server: {
    name: 'delivery-coach',
    version: '1.0.0',
  },
  logging: {
    level: 'info',
  },
})
@Module({
  name: 'delivery-coach',
  description: 'Corrects delivery mechanics against your own script',
  imports: [ConfigModule.forRoot()],
})
export class AppModule {}
```

- [ ] **Step 5: Reset `src/widgets/widget-manifest.json` to empty (real examples land in Task 17)**

```json
{
  "version": "1.0.0",
  "widgets": [],
  "generatedAt": "2026-07-26T00:00:00.000Z"
}
```

- [ ] **Step 6: Add a root widget page so Next.js has an index route**

`src/widgets/app/page.tsx`:
```tsx
export const dynamic = 'force-dynamic';

export default function IndexPage() {
  return <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>Delivery Coach widgets</div>;
}
```

- [ ] **Step 7: Run the cleanup test to verify it passes**

Run: `npm test -- src/app.module.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add -A src/modules src/widgets/app src/widgets/components src/app.module.ts src/widgets/widget-manifest.json src/app.module.test.ts
git commit -m "chore: strip pizzaz scaffold to an empty AppModule shell"
```

---

## Task 3: Port the frozen contract

**Files:**
- Create: `src/domain/contracts/index.ts`
- Create: `src/domain/contracts/index.test.ts`

**Interfaces:**
- Produces: every Zod schema + inferred type (`ScriptSegment`, `DeliveryIssue`, `NextStep`, `DeliveryReport`, `Word`, `Transcript`, `ProsodyFrame`, `ProsodyTrack`, `DeliverySignal`, `SegmentAlignment`, `AlignmentResult`, `Baseline`, `DecisionTrace`, `CorrelationResult`, `NextStepContext`), the `CoreLogic` and `SttClient` interfaces, constants (`CONTRACT_VERSION`, `FILLER_LEXICON`, `SEVERITY_COLOR`, `SEVERITY_LABEL`, `ISSUE_TYPE_LABEL`, `AUDIO_URL_SCHEMES`, `SCRIPT_MARKUP`), and `isAllowedAudioUrl`. Consumed by every later task.

- [ ] **Step 1: Write the failing contract round-trip test**

`src/domain/contracts/index.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  DeliveryReport,
  NextStep,
  isAllowedAudioUrl,
  FILLER_LEXICON,
} from './index.js';

describe('contract', () => {
  it('pins the contract version', () => {
    expect(CONTRACT_VERSION).toBe('1.0.0');
  });

  it('rejects a report missing required fields', () => {
    // Would pass (wrongly) if DeliveryReport were too loose.
    const bad = DeliveryReport.safeParse({ reportId: 'x' });
    expect(bad.success).toBe(false);
  });

  it('accepts a minimal well-formed report', () => {
    const ok = DeliveryReport.safeParse({
      reportId: 'rpt-1', contractVersion: '1.0.0', segments: [], issues: [],
      fillerCount: 0, avgPaceWpm: 0, durationSec: 0, audioUrl: null,
      status: 'ready', nextStep: null,
    });
    expect(ok.success).toBe(true);
  });

  it('defaults NextStep nullable fields to null', () => {
    const parsed = NextStep.parse({ kind: 'none', rationale: 'x', executed: false });
    expect(parsed.eventTitle).toBeNull();
    expect(parsed.draftBody).toBeNull();
  });

  it('rejects a javascript: audio url but allows a root-relative one', () => {
    expect(isAllowedAudioUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedAudioUrl('/api/audio/rough')).toBe(true);
  });

  it('treats multi-word hedges as fillers in the lexicon', () => {
    expect(FILLER_LEXICON).toContain('you know');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/domain/contracts`
Expected: FAIL — `./index.js` does not exist.

- [ ] **Step 3: Create `src/domain/contracts/index.ts` by copying the reference contract verbatim**

Copy `C:\Users\Good Day\Desktop\work\nsh\packages\contracts\src\index.ts` verbatim into `src/domain/contracts/index.ts`. It imports **only** `zod` (`import { z } from 'zod';`) and has no workspace imports, so **no import rewrites are needed**. Do not edit any schema, comment, or constant.

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `npm test -- src/domain/contracts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/contracts/index.ts src/domain/contracts/index.test.ts
git commit -m "feat: port frozen contract into src/domain/contracts"
```

---

## Task 4: Copy the golden fixtures

**Files:**
- Create: `fixtures/script.demo.md`, `fixtures/transcript.clean.json`, `fixtures/transcript.rough.json`, `fixtures/report.clean.json`, `fixtures/report.rough.json`, `fixtures/next-step-context.json`
- Create: `fixtures/fixtures.test.ts`

**Interfaces:**
- Produces: the on-disk `fixtures/` directory the `AppConfigService` (Task 9) will point `fixtureDir` at, and the golden reports Tasks 8/17/18 assert against.

- [ ] **Step 1: Write the failing fixtures test**

`fixtures/fixtures.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeliveryReport, Transcript } from '../src/domain/contracts/index.js';

const dir = join(process.cwd(), 'fixtures');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('golden fixtures', () => {
  it.each(['clean', 'rough'])('report.%s.json matches the contract', (label) => {
    expect(DeliveryReport.safeParse(read(`report.${label}.json`)).success).toBe(true);
  });

  it.each(['clean', 'rough'])('transcript.%s.json matches the contract', (label) => {
    expect(Transcript.safeParse(read(`transcript.${label}.json`)).success).toBe(true);
  });

  it('the rough report carries exactly one high-severity issue on seg-005', () => {
    const rough = read('report.rough.json') as ReturnType<typeof DeliveryReport.parse>;
    const high = rough.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- fixtures/fixtures.test.ts`
Expected: FAIL — `fixtures/` files do not exist.

- [ ] **Step 3: Copy the six fixtures verbatim**

```bash
mkdir -p "C:/Users/Good Day/Desktop/work/nsh/verbatim_mcp/fixtures"
cp "C:/Users/Good Day/Desktop/work/nsh/packages/contracts/fixtures/script.demo.md" fixtures/
cp "C:/Users/Good Day/Desktop/work/nsh/packages/contracts/fixtures/transcript.clean.json" fixtures/
cp "C:/Users/Good Day/Desktop/work/nsh/packages/contracts/fixtures/transcript.rough.json" fixtures/
cp "C:/Users/Good Day/Desktop/work/nsh/packages/contracts/fixtures/report.clean.json" fixtures/
cp "C:/Users/Good Day/Desktop/work/nsh/packages/contracts/fixtures/report.rough.json" fixtures/
cp "C:/Users/Good Day/Desktop/work/nsh/packages/contracts/fixtures/next-step-context.json" fixtures/
```
Do not open or edit them.

- [ ] **Step 4: Run the fixtures test to verify it passes**

Run: `npm test -- fixtures/fixtures.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add fixtures/script.demo.md fixtures/transcript.clean.json fixtures/transcript.rough.json fixtures/report.clean.json fixtures/report.rough.json fixtures/next-step-context.json fixtures/fixtures.test.ts
git commit -m "test: copy golden fixtures verbatim"
```

---

## Task 5: Port core-logic — errors, thresholds, tokenize

**Files:**
- Create: `src/domain/core-logic/errors.ts`, `src/domain/core-logic/thresholds.ts`, `src/domain/core-logic/tokenize.ts`
- Create: `src/domain/core-logic/tokenize.test.ts`

**Interfaces:**
- Produces: `CoachError`, `CoachErrorCode`; `THRESHOLDS`, `SEVERITY_RULES`, `ruleById`; `normaliseText`, `isHardFiller`, `isSoftFiller`, `fillerMatchLength`, `tagHardFillers`, `HARD_FILLERS`, `SOFT_FILLERS`. Consumed by Tasks 6–8 and the adapters.

- [ ] **Step 1: Write the failing tokenize test**

`src/domain/core-logic/tokenize.test.ts` — copy verbatim from `C:\Users\Good Day\Desktop\work\nsh\packages\core-logic\src\tokenize.test.ts`, then apply the import-rewrite rule (any `@nsh/contracts` → `../contracts/index.js`; intra-dir `./tokenize.js` unchanged).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/domain/core-logic/tokenize.test.ts`
Expected: FAIL — `./tokenize.js`, `./errors.js`, `./thresholds.js` do not exist.

- [ ] **Step 3: Copy the three source files with import rewrites**

- `errors.ts`: copy `packages/core-logic/src/errors.ts` verbatim (no external imports — no rewrite).
- `thresholds.ts`: copy `packages/core-logic/src/thresholds.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`; keep `from './errors.js'`.
- `tokenize.ts`: copy `packages/core-logic/src/tokenize.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`.

- [ ] **Step 4: Run the tokenize test to verify it passes**

Run: `npm test -- src/domain/core-logic/tokenize.test.ts`
Expected: PASS (all cases from the reference test).

- [ ] **Step 5: Commit**

```bash
git add src/domain/core-logic/errors.ts src/domain/core-logic/thresholds.ts src/domain/core-logic/tokenize.ts src/domain/core-logic/tokenize.test.ts
git commit -m "feat: port core-logic errors, thresholds, tokenize"
```

---

## Task 6: Port core-logic — parse-script and align

**Files:**
- Create: `src/domain/core-logic/parse-script.ts`, `src/domain/core-logic/align.ts`
- Create: `src/domain/core-logic/parse-script.test.ts`, `src/domain/core-logic/align.test.ts`

**Interfaces:**
- Consumes: `CoachError`, `THRESHOLDS`, `normaliseText`, `isHardFiller`, `isSoftFiller` (Task 5); contract types (Task 3).
- Produces: `parseScript(raw): ScriptSegment[]`; `needlemanWunsch`, `alignSegments(transcript, segments, prosody?): AlignmentResult`, and re-export of `AlignmentResult`. Consumed by Tasks 7, 15.

- [ ] **Step 1: Write the failing tests**

Copy `packages/core-logic/src/parse-script.test.ts` and `align.test.ts` into `src/domain/core-logic/`, applying the import-rewrite rule.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/domain/core-logic/parse-script.test.ts src/domain/core-logic/align.test.ts`
Expected: FAIL — `./parse-script.js`, `./align.js` do not exist.

- [ ] **Step 3: Copy the two source files with import rewrites**

- `parse-script.ts`: copy `packages/core-logic/src/parse-script.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`; keep `from './errors.js'`.
- `align.ts`: copy `packages/core-logic/src/align.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'` (there are two such lines — the type import and the `export type { AlignmentResult } from '@nsh/contracts'` re-export; rewrite both). Keep `from './errors.js'`, `from './thresholds.js'`, `from './tokenize.js'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/domain/core-logic/parse-script.test.ts src/domain/core-logic/align.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/core-logic/parse-script.ts src/domain/core-logic/align.ts src/domain/core-logic/parse-script.test.ts src/domain/core-logic/align.test.ts
git commit -m "feat: port core-logic parse-script and align"
```

---

## Task 7: Port core-logic — baseline and correlate

**Files:**
- Create: `src/domain/core-logic/baseline.ts`, `src/domain/core-logic/correlate.ts`
- Create: `src/domain/core-logic/baseline.test.ts`, `src/domain/core-logic/correlate.test.ts`

**Interfaces:**
- Consumes: `THRESHOLDS`, `ruleById` (Task 5); `AlignmentResult` (Task 6); contract types.
- Produces: `computeBaseline(alignments, words, prosody): Baseline`; `correlateSegments(signal, segments, alignment): CorrelationResult`, `sortAndNumberIssues`, `RawIssue`, `RawTrace`. Consumed by Tasks 8, 15.

- [ ] **Step 1: Write the failing tests**

Copy `packages/core-logic/src/baseline.test.ts` and `correlate.test.ts` into `src/domain/core-logic/`, applying the import-rewrite rule.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/domain/core-logic/baseline.test.ts src/domain/core-logic/correlate.test.ts`
Expected: FAIL — `./baseline.js`, `./correlate.js` do not exist.

- [ ] **Step 3: Copy the two source files with import rewrites**

- `baseline.ts`: copy `packages/core-logic/src/baseline.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`; keep `from './thresholds.js'`.
- `correlate.ts`: copy `packages/core-logic/src/correlate.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`; keep `from './align.js'`, `from './baseline.js'`, `from './thresholds.js'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/domain/core-logic/baseline.test.ts src/domain/core-logic/correlate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/core-logic/baseline.ts src/domain/core-logic/correlate.ts src/domain/core-logic/baseline.test.ts src/domain/core-logic/correlate.test.ts
git commit -m "feat: port core-logic baseline and correlate (the branch point)"
```

---

## Task 8: Port core-logic — prosody, summary, next-step, and the index + golden

**Files:**
- Create: `src/domain/core-logic/prosody.ts`, `src/domain/core-logic/summary.ts`, `src/domain/core-logic/next-step.ts`, `src/domain/core-logic/index.ts`
- Create: `src/domain/core-logic/prosody.test.ts`, `src/domain/core-logic/summary.test.ts`, `src/domain/core-logic/next-step.test.ts`, `src/domain/core-logic/golden.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–7; contract types.
- Produces: `extractProsody(pcm, sampleRate): ProsodyTrack`; `generateSummary(segments, correlation, signal, meta): DeliveryReport`; `decideNextStep(report, ctx): NextStep`; and `src/domain/core-logic/index.ts` re-exporting all ten modules. This barrel is the single import surface for the adapters and tools (Tasks 9–16).

- [ ] **Step 1: Write the failing tests**

Copy `packages/core-logic/src/prosody.test.ts`, `summary.test.ts`, `next-step.test.ts` into `src/domain/core-logic/`, applying the import-rewrite rule. Then create `src/domain/core-logic/golden.test.ts` adapted from `packages/core-logic/src/golden.test.ts` — change the fixtures dir to the target layout and import from the barrel:
```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NextStepContext } from '../contracts/index.js';
import { alignSegments, correlateSegments, decideNextStep, generateSummary, parseScript } from './index.js';

const dir = join(process.cwd(), 'fixtures');
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/domain/core-logic`
Expected: FAIL — `./prosody.js`, `./summary.js`, `./next-step.js`, `./index.js` do not exist.

- [ ] **Step 3: Copy the three source files with import rewrites**

- `prosody.ts`: copy `packages/core-logic/src/prosody.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`; keep `import Pitchfinder from 'pitchfinder'`, `from './errors.js'`, `from './thresholds.js'`.
- `summary.ts`: copy `packages/core-logic/src/summary.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`.
- `next-step.ts`: copy `packages/core-logic/src/next-step.ts`, rewrite `from '@nsh/contracts'` → `from '../contracts/index.js'`.

- [ ] **Step 4: Create the barrel `src/domain/core-logic/index.ts`**

```typescript
/**
 * Pure domain logic. No network, no fs, no Date.now(), no Math.random(),
 * and no NitroStack import — ever. See CONVENTIONS §1.
 */
export * from './align.js';
export * from './baseline.js';
export * from './correlate.js';
export * from './errors.js';
export * from './next-step.js';
export * from './parse-script.js';
export * from './prosody.js';
export * from './summary.js';
export * from './thresholds.js';
export * from './tokenize.js';
```

- [ ] **Step 5: Run the full core-logic suite to verify it passes**

Run: `npm test -- src/domain/core-logic`
Expected: PASS, including `golden.test.ts` reproducing both committed reports exactly.

- [ ] **Step 6: Commit**

```bash
git add src/domain/core-logic/prosody.ts src/domain/core-logic/summary.ts src/domain/core-logic/next-step.ts src/domain/core-logic/index.ts src/domain/core-logic/prosody.test.ts src/domain/core-logic/summary.test.ts src/domain/core-logic/next-step.test.ts src/domain/core-logic/golden.test.ts
git commit -m "feat: port core-logic prosody, summary, next-step, barrel + golden"
```

---

## Task 9: AppConfigService — single validated env read

**Files:**
- Create: `src/config/app-config.service.ts`
- Create: `src/config/app-config.service.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `CoachError` (core-logic barrel).
- Produces: `loadConfig(env): AppConfig` (pure), `AppConfig`, and `@Injectable AppConfigService` exposing `cfg: AppConfig`, `fixtureDir`, `audioDir`, `uploadDir`, and `describe()`. Consumed by Tasks 10, 12, 13, 15.

- [ ] **Step 1: Write the failing config test**

`src/config/app-config.service.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { loadConfig, AppConfigService } from './app-config.service.js';

describe('loadConfig', () => {
  it('defaults to the fixture provider', () => {
    const cfg = loadConfig({});
    expect(cfg.sttProvider).toBe('fixture');
    expect(cfg.enableProsody).toBe(true);
  });

  it('parses "false" as boolean false, not truthy string', () => {
    // Boolean('false') === true — the schema must not use z.coerce.boolean().
    expect(loadConfig({ ENABLE_PROSODY: 'false' }).enableProsody).toBe(false);
  });

  it('throws when deepgram is selected without an API key', () => {
    expect(() => loadConfig({ STT_PROVIDER: 'deepgram' })).toThrow(/DEEPGRAM_API_KEY/);
  });

  it('never exposes the raw key via describe()', () => {
    const svc = new AppConfigService(loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'sk-secret' }));
    const described = svc.describe();
    expect(described.deepgramKeyPresent).toBe(true);
    expect(JSON.stringify(described)).not.toContain('sk-secret');
  });

  it('computes fixtureDir under the project root', () => {
    const svc = new AppConfigService(loadConfig({}));
    expect(svc.fixtureDir.endsWith('fixtures')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/config`
Expected: FAIL — `./app-config.service.js` does not exist.

- [ ] **Step 3: Implement `src/config/app-config.service.ts`**

Adapt `apps/server/src/config.ts`: keep `loadConfig` pure (verbatim schema and cross-field checks), drop the module-level `cached`/`getConfig` (the DI container owns the single instance now), and wrap it in an `@Injectable` service that reads `process.env` exactly once at construction.

```typescript
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
```

- [ ] **Step 4: Update `.env.example`**

Append the coach's required vars (documenting, not hardcoding, secrets):
```
# --- Delivery Coach configuration ---
# STT_PROVIDER: fixture | deepgram (assemblyai is stubbed, not implemented)
STT_PROVIDER=fixture
# Required only when STT_PROVIDER=deepgram. Set in NitroCloud env, never commit.
DEEPGRAM_API_KEY=
# Prosody decode via ffmpeg-static. Degrades to empty track if unavailable.
ENABLE_PROSODY=true
AUDIO_MAX_SECONDS=180
UPLOAD_MAX_BYTES=26214400
LOG_LEVEL=info
# Required before enabling real auth on suggest_next_step (Task 14). Deploy-only.
JWT_SECRET=
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `npm test -- src/config`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config/app-config.service.ts src/config/app-config.service.test.ts .env.example
git commit -m "feat: AppConfigService — single Zod-validated env read"
```

---

## Task 10: STT adapter — fixture + Deepgram

**Files:**
- Create: `src/adapters/stt-client.ts`
- Create: `src/adapters/stt-client.test.ts`

**Interfaces:**
- Consumes: `Transcript`, `SttClient`, `Word` (contracts); `CoachError` (core-logic); `AppConfig` (Task 9); `frozenTranscriptPath` (Task 12 — but this task only needs the standalone `createSttClient` signature, so implement the fixture path resolver inline here as the reference does via `frozenTranscriptPath`).
- Produces: `FixtureSttClient`, `DeepgramSttClient`, `DEEPGRAM_URL`, `DEEPGRAM_QUERY`, `createSttClient(cfg, takeId, fixtureDir): SttClient`. Consumed by Task 15.

> Dependency note: `stt-client.ts` imports `frozenTranscriptPath` from `../adapters/takes.js` (Task 12). To keep this task self-contained and testable first, implement Task 12's `takes.ts` **before** this task if executing strictly in order, OR temporarily inline `frozenTranscriptPath` and swap the import in Task 12. **Recommended:** run Task 12 before Task 10.** The plan lists Task 12 (takes) after this only for narrative grouping; the DAG edge is takes → stt.

- [ ] **Step 1: Write the failing STT test**

`src/adapters/stt-client.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { FixtureSttClient, DeepgramSttClient, DEEPGRAM_QUERY, createSttClient } from './stt-client.js';
import { loadConfig } from '../config/app-config.service.js';

const fixtureDir = join(process.cwd(), 'fixtures');

describe('FixtureSttClient', () => {
  it('replays the committed transcript for a known take', async () => {
    const c = new FixtureSttClient(fixtureDir, 'rough');
    const t = await c.transcribe(new Uint8Array(0), 'audio/mp4');
    expect(t.provider).toBe('fixture');
    expect(t.words.length).toBeGreaterThan(0);
  });

  it('throws STT_FAILED for an unknown take', async () => {
    const c = new FixtureSttClient(fixtureDir, 'does-not-exist');
    await expect(c.transcribe(new Uint8Array(0), 'audio/mp4')).rejects.toMatchObject({ code: 'STT_FAILED' });
  });
});

describe('DeepgramSttClient', () => {
  it('keeps smart_format and numerals off (spoken-number matching)', () => {
    expect(DEEPGRAM_QUERY.smart_format).toBe('false');
    expect(DEEPGRAM_QUERY.numerals).toBe('false');
    expect(DEEPGRAM_QUERY.filler_words).toBe('true');
  });

  it('maps a vendor response to seconds and isFiller:false', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({
        metadata: { duration: 1.5 },
        results: { channels: [{ alternatives: [{ words: [{ word: 'hello', start: 0.1, end: 0.4, confidence: 0.9 }] }] }] },
      }), { status: 200 })) as unknown as typeof fetch;
    const c = new DeepgramSttClient('key', fakeFetch);
    const t = await c.transcribe(new Uint8Array([1]), 'audio/mp4');
    expect(t.words[0]!.isFiller).toBe(false);
    expect(t.words[0]!.start).toBe(0.1);
    expect(t.durationSec).toBe(1.5);
  });

  it('never leaks vendor error text — maps non-200 to STT_FAILED', async () => {
    const fakeFetch = (async () => new Response('unauthorized detail', { status: 401 })) as unknown as typeof fetch;
    const c = new DeepgramSttClient('key', fakeFetch);
    await expect(c.transcribe(new Uint8Array([1]), 'audio/mp4')).rejects.toMatchObject({ code: 'STT_FAILED' });
  });
});

describe('createSttClient', () => {
  it('returns the fixture client by default', () => {
    const c = createSttClient(loadConfig({}), 'rough', fixtureDir);
    expect(c.provider).toBe('fixture');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/adapters/stt-client.test.ts`
Expected: FAIL — `./stt-client.js` does not exist.

- [ ] **Step 3: Copy `stt-client.ts` with import rewrites**

Copy `apps/server/src/adapters/stt-client.ts`. Rewrite:
- `from '@nsh/contracts'` → `from '../domain/contracts/index.js'`
- `from '@nsh/core-logic'` → `from '../domain/core-logic/index.js'`
- `from '../config.js'` → `from '../config/app-config.service.js'`
- `from '../takes.js'` → `from './takes.js'`

Keep everything else verbatim (the `DEEPGRAM_QUERY`, the r3 rounding, the `Word` mapping with `isFiller: false`, all `CoachError` throws).

- [ ] **Step 4: Run the STT test to verify it passes**

Run: `npm test -- src/adapters/stt-client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/stt-client.ts src/adapters/stt-client.test.ts
git commit -m "feat: port STT adapter (fixture + deepgram)"
```

---

## Task 11: Audio-decode adapter — prosody with graceful degradation

**Files:**
- Create: `src/adapters/audio-decode.ts`
- Create: `src/adapters/audio-decode.test.ts`

**Interfaces:**
- Consumes: `ProsodyTrack` (contracts); `CoachError`, `extractProsody` (core-logic).
- Produces: `emptyProsody()`, `decodeWithFfmpeg(filePath, ffmpegBinary?)`, `prosodyForFile(req): Promise<ProsodyTrack>`, `DecodeFn`, `PROSODY_SAMPLE_RATE`, `PROSODY_HOP_SEC`. Consumed by Task 15.

- [ ] **Step 1: Write the failing degradation test**

`src/adapters/audio-decode.test.ts`:
```typescript
import { describe, expect, it, vi } from 'vitest';
import { prosodyForFile, emptyProsody } from './audio-decode.js';

describe('prosodyForFile', () => {
  it('returns an empty track when prosody is disabled', async () => {
    const t = await prosodyForFile({ filePath: '/whatever.wav', enabled: false });
    expect(t).toEqual(emptyProsody());
  });

  it('DEGRADES to an empty track when decode throws (missing ffmpeg / bad container)', async () => {
    const logs: Array<[string, string, unknown]> = [];
    const t = await prosodyForFile({
      filePath: '/broken.wav',
      enabled: true,
      decode: async () => { throw new Error('ffmpeg missing'); },
      log: (level, msg, meta) => logs.push([level, msg, meta]),
    });
    expect(t).toEqual(emptyProsody());
    expect(logs.some(([lvl, msg]) => lvl === 'warn' && msg === 'prosody.degraded')).toBe(true);
  });

  it('PROPAGATES AUDIO_TOO_SHORT from extractProsody (not a decode hiccup)', async () => {
    // A 0.5s decode result: extractProsody throws AUDIO_TOO_SHORT, which must
    // NOT be swallowed into an empty track. Would fail if the try wrapped
    // extractProsody instead of just decode().
    const halfSecond = new Float32Array(16_000 * 0.5);
    await expect(
      prosodyForFile({ filePath: '/short.wav', enabled: true, decode: async () => halfSecond }),
    ).rejects.toMatchObject({ code: 'AUDIO_TOO_SHORT' });
  });

  it('returns real frames for a valid long decode', async () => {
    const twoSecOfTone = new Float32Array(16_000 * 6);
    for (let i = 0; i < twoSecOfTone.length; i++) twoSecOfTone[i] = Math.sin(i * 0.1) * 0.5;
    const t = await prosodyForFile({ filePath: '/ok.wav', enabled: true, decode: async () => twoSecOfTone });
    expect(t.frames.length).toBeGreaterThan(0);
    expect(t.frameHopSec).toBeCloseTo(0.01);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/adapters/audio-decode.test.ts`
Expected: FAIL — `./audio-decode.js` does not exist.

- [ ] **Step 3: Copy `audio-decode.ts` with import rewrites**

Copy `apps/server/src/adapters/audio-decode.ts`. Rewrite:
- `from '@nsh/contracts'` → `from '../domain/contracts/index.js'`
- `from '@nsh/core-logic'` → `from '../domain/core-logic/index.js'`
- `from '../audit.js'` → `from '../common/logger.js'` (the `Logger` type; created in Task 13). **Until Task 13 exists, define the `Logger` type inline** to keep this task self-contained:
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;
```
Place that type at the top of `audio-decode.ts` and drop the `Logger` import; Task 13 will re-home it and this file will import it. Keep `import ffmpegStatic from 'ffmpeg-static'`.

**Do not widen the try/catch.** The `try { pcm = await decode(...) }` block wraps only `decode()`; `extractProsody(pcm, …)` runs outside it so `AUDIO_TOO_SHORT` propagates. This is the load-bearing bug-fix scoping from the reference — preserve it exactly.

- [ ] **Step 4: Run the degradation test to verify it passes**

Run: `npm test -- src/adapters/audio-decode.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/audio-decode.ts src/adapters/audio-decode.test.ts
git commit -m "feat: port audio-decode adapter with graceful prosody degradation"
```

---

## Task 12: `takes` — path-traversal-safe take/upload resolution

**Files:**
- Create: `src/adapters/takes.ts`
- Create: `src/adapters/takes.test.ts`

**Interfaces:**
- Produces: `isValidTakeId`, `TAKE_ID_PATTERN`, `AUDIO_MIME_BY_EXT`, `mimeTypeForFile`, `takeIdFromFilename`, `labelForTake`, `frozenTranscriptPath`, `listTakes`, `resolveTakeAudio`, `uploadTakeId`, `uploadFilenameFor`, `UPLOAD_ID_PREFIX`, `TakeInfo`. Consumed by Tasks 10, 15.

> This task must be executed **before Task 10** (STT imports `frozenTranscriptPath` from here). If executing in listed order, do Task 12 immediately before Task 10.

- [ ] **Step 1: Write the failing security test**

`src/adapters/takes.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { isValidTakeId, frozenTranscriptPath, uploadFilenameFor, resolveTakeAudio } from './takes.js';

const fixtureDir = join(process.cwd(), 'fixtures');

describe('take id validation (path-traversal guard)', () => {
  it('rejects traversal and separator characters', () => {
    for (const bad of ['../etc', 'a/b', 'a\\b', '..', '.hidden', 'UPPER', 'a.b']) {
      expect(isValidTakeId(bad)).toBe(false);
    }
  });
  it('accepts lowercase alnum + hyphen ids', () => {
    expect(isValidTakeId('rough')).toBe(true);
    expect(isValidTakeId('up-abc123')).toBe(true);
  });
});

describe('frozenTranscriptPath', () => {
  it('returns null for an invalid take id even if a file might exist', () => {
    expect(frozenTranscriptPath(fixtureDir, '../report.rough')).toBeNull();
  });
  it('resolves the committed transcript for a valid take', () => {
    expect(frozenTranscriptPath(fixtureDir, 'rough')).not.toBeNull();
  });
});

describe('uploadFilenameFor', () => {
  it('rejects an unsupported extension', () => {
    expect(uploadFilenameFor('up-abc', 'evil.exe')).toBeNull();
  });
  it('builds take-<id><ext> for an allowed extension', () => {
    expect(uploadFilenameFor('up-abc', 'clip.m4a')).toBe('take-up-abc.m4a');
  });
});

describe('resolveTakeAudio', () => {
  it('returns null when no matching audio file is present', () => {
    expect(resolveTakeAudio(fixtureDir, join(fixtureDir, 'audio', 'uploads'), 'rough')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/adapters/takes.test.ts`
Expected: FAIL — `./takes.js` does not exist.

- [ ] **Step 3: Copy `takes.ts` with the base-dir change**

Copy `apps/server/src/takes.ts`. The reference derives `REPO_ROOT` via `import.meta.url` (`../../../`). In the target, base dirs come from the project root. Replace the top-of-file path constants block:
```typescript
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

export const REPO_ROOT = process.cwd();
export const FIXTURE_DIR = join(REPO_ROOT, 'fixtures');
export const AUDIO_DIR = join(FIXTURE_DIR, 'audio');
export const UPLOAD_DIR = join(AUDIO_DIR, 'uploads');
```
Keep `AUDIO_MIME_BY_EXT`, `TAKE_ID_PATTERN`, `isValidTakeId`, `takeIdFromFilename`, `labelForTake`, `frozenTranscriptPath` (with the `resolve()` + `startsWith(resolvedFixtureDir + sep)` containment check — **do not remove it**), `listTakes`, `resolveTakeAudio`, `uploadTakeId`, `uploadFilenameFor` verbatim.

- [ ] **Step 4: Run the security test to verify it passes**

Run: `npm test -- src/adapters/takes.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/takes.ts src/adapters/takes.test.ts
git commit -m "feat: port takes resolver with path-traversal guards"
```

---

## Task 13: Connectors, context provider, shared logger + AuditInterceptor + CoachExceptionFilter

**Files:**
- Create: `src/common/logger.ts`
- Create: `src/adapters/connectors.ts`
- Create: `src/adapters/connectors.test.ts`
- Create: `src/common/coach-exception.filter.ts`
- Create: `src/common/coach-exception.filter.test.ts`
- Create: `src/common/audit.interceptor.ts`
- Create: `src/common/audit.interceptor.test.ts`
- Modify: `src/adapters/audio-decode.ts` (re-home the `Logger` type import to `../common/logger.js`)

**Interfaces:**
- Produces:
  - `src/common/logger.ts`: `LogLevel`, `Logger` type.
  - `connectors.ts`: `ContextProvider`, `CalendarConnector`, `GmailConnector` interfaces; `@Injectable` `FixtureContextProvider` (deps: `[AppConfigService]`), `FixtureCalendarConnector`, `FixtureGmailConnector`; `NEUTRAL_CONTEXT`.
  - `coach-exception.filter.ts`: `@Injectable CoachExceptionFilter implements ExceptionFilterInterface`, `ERROR_STATUS`, `mapCoachError(err)`.
  - `audit.interceptor.ts`: `@Injectable AuditInterceptor implements InterceptorInterface`.
- Consumed by Tasks 15, 16.

- [ ] **Step 1: Write the failing tests**

`src/adapters/connectors.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector, NEUTRAL_CONTEXT } from './connectors.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';

const config = new AppConfigService(loadConfig({}));

describe('FixtureContextProvider', () => {
  it('returns the pinned now and rough events for the rough take', async () => {
    const cp = new FixtureContextProvider(config);
    const ctx = await cp.nextStepContext('rough', '2026-07-25T09:00:00Z');
    expect(ctx.now).toBe('2026-07-25T09:00:00Z');
    expect(ctx.upcomingEvents.length).toBeGreaterThan(0);
  });
  it('returns neutral context for an unknown take', async () => {
    const cp = new FixtureContextProvider(config);
    const ctx = await cp.nextStepContext('up-unknown', '2026-07-25T09:00:00Z');
    expect(ctx.upcomingEvents).toEqual(NEUTRAL_CONTEXT.upcomingEvents);
    expect(ctx.knownMentor).toBeNull();
  });
});

describe('connectors are deterministic', () => {
  it('calendar returns a stable synthetic id for identical inputs', async () => {
    const cal = new FixtureCalendarConnector();
    const a = await cal.createReminder('Pitch', '2026-07-27T14:00:00Z');
    const b = await cal.createReminder('Pitch', '2026-07-27T14:00:00Z');
    expect(a.id).toBe(b.id);
  });
  it('gmail returns a stable synthetic id for identical inputs', async () => {
    const gm = new FixtureGmailConnector();
    const a = await gm.draft('s', 'b', 'to');
    const b = await gm.draft('s', 'b', 'to');
    expect(a.id).toBe(b.id);
  });
});
```

`src/common/coach-exception.filter.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { CoachExceptionFilter, mapCoachError } from './coach-exception.filter.js';
import { CoachError } from '../domain/core-logic/index.js';

describe('mapCoachError', () => {
  it('preserves the CoachError code and message, never the context', () => {
    const mapped = mapCoachError(new CoachError('BAD_INPUT', 'bad field', { secret: 'x' }));
    expect(mapped.body.error.code).toBe('BAD_INPUT');
    expect(JSON.stringify(mapped.body)).not.toContain('secret');
  });
  it('maps an unknown error to a generic INTERNAL 500', () => {
    const mapped = mapCoachError(new Error('stack detail'));
    expect(mapped.body.error.code).toBe('INTERNAL');
    expect(mapped.body.error.message).not.toContain('stack detail');
  });
});

describe('CoachExceptionFilter', () => {
  it('returns the client-safe body for a thrown CoachError', () => {
    const filter = new CoachExceptionFilter();
    const out = filter.catch(new CoachError('ALIGNMENT_FAILED', 'no match', { matchRate: 12 }), {} as never);
    expect(out).toMatchObject({ error: { code: 'ALIGNMENT_FAILED' } });
  });
});
```

`src/common/audit.interceptor.test.ts`:
```typescript
import { describe, expect, it, vi } from 'vitest';
import { AuditInterceptor } from './audit.interceptor.js';

function ctx(toolName: string) {
  const logs: unknown[] = [];
  return {
    context: { toolName, logger: { info: (m: string, meta?: unknown) => logs.push(['info', m, meta]), error: (m: string, meta?: unknown) => logs.push(['error', m, meta]) } } as never,
    logs,
  };
}

describe('AuditInterceptor', () => {
  it('logs one ok line with tool + durationMs on success', async () => {
    const { context, logs } = ctx('parse_script');
    const out = await new AuditInterceptor().intercept(context, async () => ({ ok: true }));
    expect(out).toEqual({ ok: true });
    expect(logs.some(([lvl, m]) => lvl === 'info' && m === 'tool.call')).toBe(true);
  });
  it('logs an error line and rethrows on failure', async () => {
    const { context, logs } = ctx('suggest_next_step');
    await expect(new AuditInterceptor().intercept(context, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(logs.some(([lvl, m]) => lvl === 'error' && m === 'tool.call')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/adapters/connectors.test.ts src/common`
Expected: FAIL — the source files do not exist.

- [ ] **Step 3: Create `src/common/logger.ts`**

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;
```

- [ ] **Step 4: Re-home the `Logger` type in `audio-decode.ts`**

Remove the inline `LogLevel`/`Logger` type block added in Task 11 and add `import type { Logger } from '../common/logger.js';`.

- [ ] **Step 5: Port `connectors.ts` as `@Injectable` classes**

Copy `apps/server/src/adapters/connectors.ts`. Rewrite `from '@nsh/contracts'` → `from '../domain/contracts/index.js'`; `from '@nsh/core-logic'` → `from '../domain/core-logic/index.js'`; drop `from '../audit.js'` (`Logger`). Convert the three implementation classes to DI, and change the connectors to log via the tool's `ctx.logger` at the call site (Task 15) rather than holding a `Logger` — so the connector constructors take no logger. `FixtureContextProvider` takes `AppConfigService` and reads `config.fixtureDir`:

```typescript
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nitrostack/core';
import { NextStepContext } from '../domain/contracts/index.js';
import { CoachError } from '../domain/core-logic/index.js';
import { AppConfigService } from '../config/app-config.service.js';

export interface ContextProvider {
  nextStepContext(takeId: string, now: string): Promise<NextStepContext>;
}
export interface CalendarConnector {
  createReminder(title: string, startsAt: string): Promise<{ id: string }>;
}
export interface GmailConnector {
  draft(subject: string, body: string, to: string | null): Promise<{ id: string }>;
}

export const NEUTRAL_CONTEXT: Omit<NextStepContext, 'now'> = { upcomingEvents: [], knownMentor: null };
const CONTEXT_FIXTURE = 'next-step-context.json';

@Injectable({ deps: [AppConfigService] })
export class FixtureContextProvider implements ContextProvider {
  constructor(private readonly config: AppConfigService) {}

  async nextStepContext(takeId: string, now: string): Promise<NextStepContext> {
    const path = join(this.config.fixtureDir, CONTEXT_FIXTURE);
    let all: Record<string, unknown>;
    try {
      all = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    } catch (cause) {
      throw new CoachError('INTERNAL', `Failed to read or parse "${CONTEXT_FIXTURE}".`, {
        path, cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (!Object.hasOwn(all, takeId)) return { ...NEUTRAL_CONTEXT, now };
    const entry = all[takeId];
    if (entry === undefined) return { ...NEUTRAL_CONTEXT, now };
    const parsed = NextStepContext.safeParse({ ...(entry as object), now });
    if (!parsed.success) {
      throw new CoachError('INTERNAL', `next-step-context.json entry "${takeId}" does not match the contract.`, {
        takeId, issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

const syntheticId = (prefix: string, parts: Array<string | null>): string =>
  `${prefix}${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12)}`;

@Injectable()
export class FixtureCalendarConnector implements CalendarConnector {
  async createReminder(title: string, startsAt: string): Promise<{ id: string }> {
    return { id: syntheticId('fixture-event-', [title, startsAt]) };
  }
}

@Injectable()
export class FixtureGmailConnector implements GmailConnector {
  async draft(subject: string, body: string, to: string | null): Promise<{ id: string }> {
    return { id: syntheticId('fixture-draft-', [subject, body, to]) };
  }
}
```

- [ ] **Step 6: Create `src/common/coach-exception.filter.ts`**

Adapt `apps/server/src/errors.ts` into a filter. Keep `ERROR_STATUS` and the never-leak-context principle; render the client body:

```typescript
import { ExceptionFilterInterface, ExecutionContext, Injectable } from '@nitrostack/core';
import { CoachError, type CoachErrorCode } from '../domain/core-logic/index.js';

export const ERROR_STATUS: Record<CoachErrorCode, number> = {
  BAD_INPUT: 400, SCRIPT_EMPTY: 400, SCRIPT_NO_SEGMENTS: 400,
  AUDIO_UNREADABLE: 415, AUDIO_TOO_SHORT: 422, STT_FAILED: 502,
  ALIGNMENT_FAILED: 422, INTERNAL: 500,
};
export const GENERIC_MESSAGE = 'Internal server error.';

export interface MappedError {
  status: number;
  body: { error: { code: string; message: string } };
  logMessage: string;
  logContext: Record<string, unknown>;
}

export function mapCoachError(err: unknown): MappedError {
  if (err instanceof CoachError) {
    return {
      status: ERROR_STATUS[err.code],
      body: { error: { code: err.code, message: err.message } },
      logMessage: err.message,
      logContext: err.context,
    };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { code: 'INTERNAL', message: GENERIC_MESSAGE } }, logMessage: detail, logContext: {} };
}

@Injectable()
export class CoachExceptionFilter implements ExceptionFilterInterface {
  catch(exception: unknown, context: ExecutionContext): unknown {
    const mapped = mapCoachError(exception);
    // context is logged, never returned. Framework input-validation errors that
    // are not CoachError land in the generic branch above (client-safe).
    try {
      context?.logger?.error?.('tool.error', { code: mapped.body.error.code, ...mapped.logContext });
    } catch { /* logger optional in some contexts */ }
    return mapped.body;
  }
}
```

- [ ] **Step 7: Create `src/common/audit.interceptor.ts`**

```typescript
import { InterceptorInterface, ExecutionContext, Injectable } from '@nitrostack/core';
import { mapCoachError } from './coach-exception.filter.js';

/** One metadata-only audit line per tool call. Never transcript text or keys. */
@Injectable()
export class AuditInterceptor implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
    const startedAt = Date.now();
    const tool = context?.toolName ?? 'unknown';
    try {
      const out = await next();
      context?.logger?.info?.('tool.call', { tool, durationMs: Date.now() - startedAt, outcome: 'ok' });
      return out;
    } catch (err) {
      context?.logger?.error?.('tool.call', {
        tool, durationMs: Date.now() - startedAt, outcome: 'error',
        errorCode: mapCoachError(err).body.error.code,
      });
      throw err;
    }
  }
}
```

- [ ] **Step 8: Run all Task-13 tests to verify they pass**

Run: `npm test -- src/adapters/connectors.test.ts src/common src/adapters/audio-decode.test.ts`
Expected: PASS (connectors 4, filter 3, interceptor 2, and audio-decode still 4 after the Logger re-home).

- [ ] **Step 9: Commit**

```bash
git add src/common/logger.ts src/adapters/connectors.ts src/adapters/connectors.test.ts src/common/coach-exception.filter.ts src/common/coach-exception.filter.test.ts src/common/audit.interceptor.ts src/common/audit.interceptor.test.ts src/adapters/audio-decode.ts
git commit -m "feat: connectors, exception filter, audit interceptor, shared logger"
```

---

## Task 14: Auth guard seam on the connector-firing tool

**Files:**
- Create: `src/common/next-step.guard.ts`
- Create: `src/common/next-step.guard.test.ts`

**Interfaces:**
- Consumes: `AppConfigService` — but reads `JWT_SECRET` directly from env-derived config for the seam. To avoid adding `JWT_SECRET` to `AppConfig` (it is deploy-only), the guard reads it via `process.env.JWT_SECRET` **inside the guard only** and documents this as the single exception to the "one env read" rule, justified because auth secrets are a distinct lifecycle from analysis config.
- Produces: `@Injectable NextStepGuard implements Guard`. Consumed by Task 15 (`@UseGuards(NextStepGuard)` on `suggest_next_step`).

- [ ] **Step 1: Write the failing guard test**

`src/common/next-step.guard.test.ts`:
```typescript
import { describe, expect, it, afterEach } from 'vitest';
import { NextStepGuard } from './next-step.guard.js';

const mkCtx = (authorization?: string) => ({ metadata: authorization ? { authorization } : {} }) as never;

describe('NextStepGuard (seam)', () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => { if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original; });

  it('allows all calls when JWT_SECRET is unset (documented pre-deploy seam)', async () => {
    delete process.env.JWT_SECRET;
    expect(await new NextStepGuard().canActivate(mkCtx())).toBe(true);
  });

  it('rejects a call with no bearer token once JWT_SECRET is set', async () => {
    process.env.JWT_SECRET = 'deploy-secret';
    expect(await new NextStepGuard().canActivate(mkCtx())).toBe(false);
  });

  it('rejects a malformed bearer token once JWT_SECRET is set', async () => {
    process.env.JWT_SECRET = 'deploy-secret';
    expect(await new NextStepGuard().canActivate(mkCtx('Bearer not-a-jwt'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/common/next-step.guard.test.ts`
Expected: FAIL — `./next-step.guard.js` does not exist.

- [ ] **Step 3: Implement `src/common/next-step.guard.ts`**

The seam: permissive while `JWT_SECRET` is unset (local demo has no auth surface, per SPEC), real verification when it is set. No `jsonwebtoken` dependency is added yet — a structural bearer check stands in until deploy wires real JWT verification (documented TODO).

```typescript
import { Guard, ExecutionContext, Injectable } from '@nitrostack/core';

/**
 * PRE-DEPLOY SEAM. suggest_next_step is the one tool that fires a real-world
 * connector action, so per ARCHITECTURE_BRIEF §3 it must be authed on a live
 * deploy. Locally there is no auth surface, so this guard ALLOWS everything
 * while JWT_SECRET is unset. When JWT_SECRET is present it enforces a bearer
 * token.
 *
 * TODO (deploy): import JWTModule + jsonwebtoken and verify the token
 * signature against JWT_SECRET here, populating context.auth. Until then this
 * enforces presence/shape only. See auth-security SKILL.md JWTGuard for the
 * full verification body.
 */
@Injectable()
export class NextStepGuard implements Guard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = process.env.JWT_SECRET;
    if (!secret) return true; // documented local seam

    const auth = context.metadata?.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false;
    const token = auth.slice('Bearer '.length).trim();
    // Structural check only until real JWT verification is wired at deploy.
    const looksLikeJwt = token.split('.').length === 3 && token.length > 20;
    return looksLikeJwt;
  }
}
```

- [ ] **Step 4: Run the guard test to verify it passes**

Run: `npm test -- src/common/next-step.guard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/next-step.guard.ts src/common/next-step.guard.test.ts
git commit -m "feat: NextStepGuard auth seam on the connector-firing tool"
```

---

## Task 15: The five tools + orchestration service

**Files:**
- Create: `src/coach/coach.service.ts`
- Create: `src/coach/coach.service.test.ts`
- Create: `src/coach/coach.tools.ts`
- Create: `src/coach/coach.tools.test.ts`

**Interfaces:**
- Consumes: core-logic barrel (`parseScript`, `alignSegments`, `correlateSegments`, `generateSummary`, `decideNextStep`); adapters (`createSttClient`, `prosodyForFile`, connectors, `resolveTakeAudio`, `uploadFilenameFor`, `uploadTakeId`); `AppConfigService`; guard + interceptor + filter.
- Produces:
  - `assertToolOutput(schema, output, toolName)` helper (in `coach.service.ts`).
  - `@Injectable CoachService` with `analyze(input): Promise<DeliveryReport>` (composed, always `execute:false`), and per-tool methods used by both the controller and `analyze`.
  - `@Controller CoachTools` (or `@Injectable` with `@Tool` methods) exposing `parse_script`, `transcribe_delivery`, `correlate_segments`, `generate_summary`, `suggest_next_step` (with `@UseGuards(NextStepGuard)`), and `analyze_delivery` (with `@Widget('delivery-timeline')`). Consumed by Task 16 (module), Task 17 (widget).

- [ ] **Step 1: Write the failing orchestration + execute-gating tests**

`src/coach/coach.service.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoachService } from './coach.service.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';
import { DeliveryReport } from '../domain/contracts/index.js';

const fixtureDir = join(process.cwd(), 'fixtures');
const golden = (label: string) => JSON.parse(readFileSync(join(fixtureDir, `report.${label}.json`), 'utf8')) as DeliveryReport;
const stripUrl = (r: DeliveryReport) => { const { audioUrl, ...rest } = r; return rest; };

function service() {
  const config = new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }));
  return new CoachService(config, new FixtureContextProvider(config), new FixtureCalendarConnector(), new FixtureGmailConnector());
}

describe('CoachService.analyze', () => {
  it.each(['rough', 'clean'])('reproduces the golden %s report modulo audioUrl', async (label) => {
    const report = await service().analyze({ takeId: label, now: '2026-07-25T09:00:00Z' });
    expect(DeliveryReport.safeParse(report).success).toBe(true);
    expect(stripUrl(report)).toEqual(stripUrl(golden(label)));
  });

  it('SECURITY: analyze never executes the next step (executed stays false)', async () => {
    const report = await service().analyze({ takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    expect(report.nextStep!.executed).toBe(false);
    expect(report.nextStep!.kind).toBe('calendar_reminder');
  });
});

describe('CoachService.suggestNextStep execute-gating', () => {
  it('proposes without firing a connector when execute is false', async () => {
    const svc = service();
    const report = await svc.analyze({ takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    const ns = await svc.suggestNextStep({ report, takeId: 'rough', now: '2026-07-25T09:00:00Z', execute: false });
    expect(ns.executed).toBe(false);
  });

  it('fires the connector and flips executed:true only when execute is true', async () => {
    const svc = service();
    const report = await svc.analyze({ takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    const ns = await svc.suggestNextStep({ report, takeId: 'rough', now: '2026-07-25T09:00:00Z', execute: true });
    expect(ns.executed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/coach/coach.service.test.ts`
Expected: FAIL — `./coach.service.js` does not exist.

- [ ] **Step 3: Implement `src/coach/coach.service.ts`**

This is the reference `pipeline.ts` + the five tool bodies, collapsed into one injectable service. It owns the composition order and the execute-gating invariant.

```typescript
import { readFile } from 'node:fs/promises';
import { Injectable } from '@nitrostack/core';
import { z } from 'zod';
import {
  DeliveryReport, DeliverySignal, NextStep, ScriptSegment, CorrelationResult,
} from '../domain/contracts/index.js';
import {
  CoachError, alignSegments, correlateSegments, decideNextStep, generateSummary, parseScript,
} from '../domain/core-logic/index.js';
import { AppConfigService } from '../config/app-config.service.js';
import { createSttClient } from '../adapters/stt-client.js';
import { prosodyForFile } from '../adapters/audio-decode.js';
import { resolveTakeAudio } from '../adapters/takes.js';
import {
  FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector,
  type ContextProvider, type CalendarConnector, type GmailConnector,
} from '../adapters/connectors.js';
import type { Logger } from '../common/logger.js';

/** Output-side contract-drift guard. Maps to INTERNAL, never BAD_INPUT. */
export function assertToolOutput<T extends z.ZodTypeAny>(schema: T, output: unknown, toolName: string): void {
  const result = schema.safeParse(output);
  if (result.success) return;
  const summary = result.error.issues.map((i) => `"${i.path.join('.') || '(root)'}" (${i.code})`).join(', ');
  throw new CoachError('INTERNAL', `${toolName}: output failed contract validation at ${summary}.`, {
    issues: result.error.issues,
  });
}

export function reportIdFor(takeId: string): string { return `rpt-demo-${takeId}`; }
export function audioUrlFor(takeId: string): string { return `/api/audio/${takeId}`; }

export interface AnalyzeInput { takeId: string; script?: string; now: string; }
export interface SuggestNextStepArgs {
  report: DeliveryReport; takeId: string; now: string; execute: boolean;
}

@Injectable({ deps: [AppConfigService, FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector] })
export class CoachService {
  constructor(
    private readonly config: AppConfigService,
    private readonly context: ContextProvider,
    private readonly calendar: CalendarConnector,
    private readonly gmail: GmailConnector,
  ) {}

  parseScriptText(raw: string): ScriptSegment[] {
    return parseScript(raw);
  }

  async transcribe(takeId: string, log?: Logger): Promise<DeliverySignal> {
    const cfg = this.config.cfg;
    const client = createSttClient(cfg, takeId, this.config.fixtureDir);
    const needsBytes = cfg.sttProvider !== 'fixture' || cfg.enableProsody;
    const audio = needsBytes ? resolveTakeAudio(this.config.audioDir, this.config.uploadDir, takeId) : null;
    if (cfg.sttProvider !== 'fixture' && audio === null) {
      throw new CoachError('AUDIO_UNREADABLE', `No audio file on disk for take "${takeId}".`, { takeId });
    }
    const bytes = audio === null ? new Uint8Array(0) : new Uint8Array(await readFile(audio.path));
    const transcript = await client.transcribe(bytes, audio?.mimeType ?? 'application/octet-stream');
    if (transcript.durationSec > cfg.audioMaxSeconds) {
      throw new CoachError('AUDIO_UNREADABLE',
        `Recording is ${transcript.durationSec}s; the limit is ${cfg.audioMaxSeconds}s.`, { takeId });
    }
    const prosody = await prosodyForFile({ filePath: audio?.path ?? null, enabled: cfg.enableProsody, log });
    const result: DeliverySignal = { transcript, prosody };
    assertToolOutput(DeliverySignal, result, 'transcribe');
    return result;
  }

  correlate(signal: DeliverySignal, segments: ScriptSegment[]): CorrelationResult {
    const alignment = alignSegments(signal.transcript, segments, signal.prosody);
    const result = correlateSegments(signal, segments, alignment);
    assertToolOutput(CorrelationResult, result, 'correlate');
    return result;
  }

  summarize(
    segments: ScriptSegment[], correlation: CorrelationResult, signal: DeliverySignal,
    meta: { reportId: string; audioUrl: string | null },
  ): DeliveryReport {
    const result = generateSummary(segments, correlation, signal, meta);
    assertToolOutput(DeliveryReport, result, 'summarize');
    return result;
  }

  /**
   * The one place a connector can fire. execute:false → decideNextStep only.
   * execute:true → fire the CONFIGURED connector and flip executed:true.
   */
  async suggestNextStep(args: SuggestNextStepArgs, log?: Logger): Promise<NextStep> {
    const ctx = await this.context.nextStepContext(args.takeId, args.now);
    const decided = decideNextStep(args.report, ctx);
    if (!args.execute || decided.kind === 'none') return decided;

    if (decided.kind === 'calendar_reminder') {
      const { id } = await this.calendar.createReminder(decided.eventTitle ?? '', decided.eventStartsAt ?? '');
      log?.('info', 'next_step.executed', { takeId: args.takeId, kind: decided.kind, externalId: id });
    } else {
      const { id } = await this.gmail.draft(decided.draftSubject ?? '', decided.draftBody ?? '', decided.recipientHint);
      log?.('info', 'next_step.executed', { takeId: args.takeId, kind: decided.kind, externalId: id });
    }
    const result: NextStep = { ...decided, executed: true };
    assertToolOutput(NextStep, result, 'suggestNextStep');
    return result;
  }

  private defaultScript(): string {
    return readFileSyncUtf8(this.config.fixtureDir, 'script.demo.md');
  }

  /**
   * Composed pipeline. NEVER passes execute:true — analyze proposes, it never
   * acts. The widget's confirm button reaches execution through the discrete
   * suggest_next_step tool with execute:true.
   */
  async analyze(input: AnalyzeInput, log?: Logger): Promise<DeliveryReport> {
    const segments = this.parseScriptText(input.script ?? this.defaultScript());
    const signal = await this.transcribe(input.takeId, log);
    const correlation = this.correlate(signal, segments);
    const report = this.summarize(segments, correlation, signal, {
      reportId: reportIdFor(input.takeId), audioUrl: audioUrlFor(input.takeId),
    });
    report.nextStep = await this.suggestNextStep(
      { report, takeId: input.takeId, now: input.now, execute: false }, log,
    );
    return report;
  }
}

// Local helper to keep the single fs import obvious.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
function readFileSyncUtf8(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8');
}
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `npm test -- src/coach/coach.service.test.ts`
Expected: PASS (6 tests) — both goldens reproduced, execute-gating enforced both ways.

- [ ] **Step 5: Write the failing controller test**

`src/coach/coach.tools.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { CoachTools } from './coach.tools.js';
import { CoachService } from './coach.service.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';

function tools() {
  const config = new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }));
  const svc = new CoachService(config, new FixtureContextProvider(config), new FixtureCalendarConnector(), new FixtureGmailConnector());
  return new CoachTools(svc);
}
const ctx = () => ({ toolName: 't', logger: { info() {}, error() {}, warn() {}, debug() {} } }) as never;

describe('CoachTools', () => {
  it('parse_script returns deterministic seg-NNN ids', async () => {
    const segs = await tools().parseScript({ raw: 'Intro line.\n\n**Key stat** is 98 percent.' }, ctx());
    expect(segs[0]!.id).toBe('seg-001');
    expect(segs[1]!.isKeyPoint).toBe(true);
  });

  it('analyze_delivery returns a full report the widget can render', async () => {
    const report = await tools().analyzeDelivery({ takeId: 'rough', now: '2026-07-25T09:00:00Z' }, ctx());
    expect(report.status).toBe('ready');
    expect(report.issues.some((i) => i.severity === 'high')).toBe(true);
    expect(report.nextStep!.executed).toBe(false);
  });

  it('suggest_next_step with execute:true flips executed', async () => {
    const t = tools();
    const report = await t.analyzeDelivery({ takeId: 'rough', now: '2026-07-25T09:00:00Z' }, ctx());
    const ns = await t.suggestNextStep({ report, takeId: 'rough', now: '2026-07-25T09:00:00Z', execute: true }, ctx());
    expect(ns.executed).toBe(true);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- src/coach/coach.tools.test.ts`
Expected: FAIL — `./coach.tools.js` does not exist.

- [ ] **Step 7: Implement `src/coach/coach.tools.ts`**

The MCP surface. Five discrete tools (for Ops Canvas / composability) plus the composed `analyze_delivery` (for the widget). `inputSchema` handles boundary validation; the guard sits on `suggest_next_step`; the widget route is on `analyze_delivery`.

```typescript
import {
  ControllerDecorator as Controller, ToolDecorator as Tool, Widget, UseGuards, UseFilters,
  UseInterceptors, ExecutionContext, Injectable,
} from '@nitrostack/core';
import { z } from 'zod';
import {
  DeliveryReport, DeliverySignal, ScriptSegment, CorrelationResult, NextStep,
} from '../domain/contracts/index.js';
import { CoachService } from './coach.service.js';
import { NextStepGuard } from '../common/next-step.guard.js';
import { CoachExceptionFilter } from '../common/coach-exception.filter.js';
import { AuditInterceptor } from '../common/audit.interceptor.js';
import type { Logger, LogLevel } from '../common/logger.js';

const AnalyzeSchema = z.object({
  takeId: z.string().min(1).describe('Staged take id (e.g. "rough", "clean") or an upload id.'),
  script: z.string().optional().describe('Raw script markdown. Defaults to the demo script.'),
  now: z.string().min(1).describe('ISO 8601 clock, injected for deterministic next-step timing.'),
});
const ParseScriptSchema = z.object({ raw: z.string().describe('Raw script markdown.') });
const TranscribeSchema = z.object({
  takeId: z.string().min(1),
  file_name: z.string().optional().describe('Uploaded recording filename.'),
  file_type: z.string().optional().describe('Uploaded recording MIME type.'),
  file_content: z.string().optional().describe('Base64 (raw or data-URL) recording bytes.'),
});
const CorrelateSchema = z.object({ signal: DeliverySignal, segments: z.array(ScriptSegment) });
const SummarizeSchema = z.object({
  segments: z.array(ScriptSegment), correlation: CorrelationResult, signal: DeliverySignal,
  meta: z.object({ reportId: z.string().min(1), audioUrl: z.string().nullable() }),
});
const SuggestSchema = z.object({
  report: DeliveryReport, takeId: z.string().min(1), now: z.string().min(1),
  execute: z.boolean().default(false),
});

/** Bridge ctx.logger (info/warn/error methods) to the adapters' Logger callback. */
function toLogger(ctx: ExecutionContext): Logger {
  return (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const fn = (ctx.logger as Record<string, ((m: string, meta?: unknown) => void) | undefined>)[level];
    fn?.(message, meta);
  };
}

@Controller()
@UseFilters(CoachExceptionFilter)
@UseInterceptors(AuditInterceptor)
@Injectable({ deps: [CoachService] })
export class CoachTools {
  constructor(private readonly coach: CoachService) {}

  @Tool({
    name: 'parse_script',
    description: 'Parse script markdown into structured segments with key-point and pause markers.',
    inputSchema: ParseScriptSchema,
    outputSchema: z.array(ScriptSegment),
  })
  async parseScript(input: z.infer<typeof ParseScriptSchema>, _ctx: ExecutionContext): Promise<ScriptSegment[]> {
    return this.coach.parseScriptText(input.raw);
  }

  @Tool({
    name: 'transcribe_delivery',
    description: 'Transcribe a recording (staged take or uploaded audio) into a timestamped transcript + prosody.',
    inputSchema: TranscribeSchema,
    outputSchema: DeliverySignal,
  })
  async transcribeDelivery(input: z.infer<typeof TranscribeSchema>, ctx: ExecutionContext): Promise<DeliverySignal> {
    const takeId = await this.coach.resolveUploadIfPresent(input);
    return this.coach.transcribe(takeId, toLogger(ctx));
  }

  @Tool({
    name: 'correlate_segments',
    description: 'THE BRANCH TOOL. Align delivery to script and decide severity per deviation.',
    inputSchema: CorrelateSchema,
    outputSchema: CorrelationResult,
  })
  async correlateSegments(input: z.infer<typeof CorrelateSchema>, _ctx: ExecutionContext): Promise<CorrelationResult> {
    return this.coach.correlate(input.signal, input.segments);
  }

  @Tool({
    name: 'generate_summary',
    description: 'Assemble the timestamped DeliveryReport from correlation output.',
    inputSchema: SummarizeSchema,
    outputSchema: DeliveryReport,
  })
  async generateSummary(input: z.infer<typeof SummarizeSchema>, _ctx: ExecutionContext): Promise<DeliveryReport> {
    return this.coach.summarize(input.segments, input.correlation, input.signal, input.meta);
  }

  @Tool({
    name: 'suggest_next_step',
    description: 'Closing agentic action: calendar reminder or a drafted note to a mentor. Fires the connector only when execute=true.',
    inputSchema: SuggestSchema,
    outputSchema: NextStep,
  })
  @UseGuards(NextStepGuard)
  async suggestNextStep(input: z.infer<typeof SuggestSchema>, ctx: ExecutionContext): Promise<NextStep> {
    return this.coach.suggestNextStep(input, toLogger(ctx));
  }

  @Tool({
    name: 'analyze_delivery',
    description: 'Run the full pipeline (parse → transcribe → correlate → summarize → propose next step) and render the timeline widget. Proposes the next step; never fires a connector.',
    inputSchema: AnalyzeSchema,
    outputSchema: DeliveryReport,
  })
  @Widget('delivery-timeline')
  async analyzeDelivery(input: z.infer<typeof AnalyzeSchema>, ctx: ExecutionContext): Promise<DeliveryReport> {
    return this.coach.analyze(input, toLogger(ctx));
  }
}
```

- [ ] **Step 8: Add `resolveUploadIfPresent` to `CoachService`**

Append to `CoachService` (uses the path-safe upload pattern; when no file is supplied, returns `takeId` unchanged for staged fixtures):

```typescript
  // In coach.service.ts — add imports at top:
  // import { mkdir, writeFile } from 'node:fs/promises';
  // import { basename, join, resolve, sep } from 'node:path';
  // import { uploadTakeId, uploadFilenameFor } from '../adapters/takes.js';

  async resolveUploadIfPresent(input: { takeId: string; file_name?: string; file_type?: string; file_content?: string }): Promise<string> {
    if (!input.file_content || !input.file_name) return input.takeId;
    const bytes = decodeBase64File(input.file_content);
    if (bytes.byteLength > this.config.cfg.uploadMaxBytes) {
      throw new CoachError('AUDIO_UNREADABLE', 'Uploaded file exceeds the size limit.', {});
    }
    const id = uploadTakeId(bytes);
    const filename = uploadFilenameFor(id, basename(input.file_name));
    if (filename === null) throw new CoachError('AUDIO_UNREADABLE', 'Unsupported audio file type.', {});
    await mkdir(this.config.uploadDir, { recursive: true });
    const dest = join(this.config.uploadDir, filename);
    if (!resolve(dest).startsWith(resolve(this.config.uploadDir) + sep)) {
      throw new CoachError('AUDIO_UNREADABLE', 'Invalid upload path.', {});
    }
    await writeFile(dest, bytes);
    return id;
  }
```
And add the decoder helper at the bottom of `coach.service.ts`:
```typescript
function decodeBase64File(content: string): Uint8Array {
  const m = content.match(/^data:([A-Za-z0-9-+/.]+);base64,(.+)$/);
  return m ? new Uint8Array(Buffer.from(m[2]!, 'base64')) : new Uint8Array(Buffer.from(content, 'base64'));
}
```

- [ ] **Step 9: Run all Task-15 tests to verify they pass**

Run: `npm test -- src/coach`
Expected: PASS (service 6, tools 3).

- [ ] **Step 10: Commit**

```bash
git add src/coach/coach.service.ts src/coach/coach.service.test.ts src/coach/coach.tools.ts src/coach/coach.tools.test.ts
git commit -m "feat: five tools + analyze_delivery orchestration with execute-gating"
```

---

## Task 16: Module wiring — CoachModule, JWTModule, AppModule

**Files:**
- Create: `src/coach/coach.module.ts`
- Modify: `src/app.module.ts`
- Create: `src/app.module.wiring.test.ts`

**Interfaces:**
- Consumes: `CoachTools`, `CoachService`, connectors, config, guard/filter/interceptor.
- Produces: `CoachModule` registering the controller + providers; `AppModule` importing `ConfigModule.forRoot()`, `JWTModule.forRoot(...)`, and `CoachModule`.

- [ ] **Step 1: Write the failing wiring test**

`src/app.module.wiring.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { TestingModule } from '@nitrostack/core/testing';
import { CoachService } from './coach/coach.service.js';
import { CoachTools } from './coach/coach.tools.js';
import { AppConfigService, loadConfig } from './config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from './adapters/connectors.js';

describe('DI wiring', () => {
  it('resolves CoachTools with CoachService injected', () => {
    const mod = TestingModule.create()
      .addMock(AppConfigService, new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' })))
      .addProvider(FixtureContextProvider)
      .addProvider(FixtureCalendarConnector)
      .addProvider(FixtureGmailConnector)
      .addProvider(CoachService)
      .addProvider(CoachTools)
      .compile();
    const tools = mod.get(CoachTools);
    expect(tools).toBeInstanceOf(CoachTools);
    mod.cleanup();
  });
});
```

> If `TestingModule`'s `addProvider`/`addMock` resolution differs from this shape at execution time, fall back to constructing `CoachTools` manually (as `coach.tools.test.ts` already does) and assert the module file at least imports the expected symbols via a source-text check. Flag any API mismatch to the reviewer.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/app.module.wiring.test.ts`
Expected: FAIL — `./coach/coach.module.js` does not exist / providers not registered.

- [ ] **Step 3: Create `src/coach/coach.module.ts`**

```typescript
import { Module } from '@nitrostack/core';
import { CoachTools } from './coach.tools.js';
import { CoachService } from './coach.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';
import { NextStepGuard } from '../common/next-step.guard.js';
import { CoachExceptionFilter } from '../common/coach-exception.filter.js';
import { AuditInterceptor } from '../common/audit.interceptor.js';

@Module({
  name: 'coach',
  description: 'Delivery-correction speech coach tools and widget',
  controllers: [CoachTools],
  providers: [
    AppConfigService,
    CoachService,
    FixtureContextProvider,
    FixtureCalendarConnector,
    FixtureGmailConnector,
    NextStepGuard,
    CoachExceptionFilter,
    AuditInterceptor,
  ],
})
export class CoachModule {}
```

- [ ] **Step 4: Update `src/app.module.ts` to import CoachModule + JWTModule**

```typescript
import { McpApp, Module, ConfigModule, JWTModule } from '@nitrostack/core';
import { CoachModule } from './coach/coach.module.js';

@McpApp({
  module: AppModule,
  server: { name: 'delivery-coach', version: '1.0.0' },
  logging: { level: 'info' },
})
@Module({
  name: 'delivery-coach',
  description: 'Corrects delivery mechanics against your own script',
  imports: [
    ConfigModule.forRoot(),
    // Registered so the deploy-time NextStepGuard can verify tokens. Locally,
    // with JWT_SECRET unset, the guard allows all calls (documented seam).
    JWTModule.forRoot({ secret: process.env.JWT_SECRET ?? 'dev-insecure-secret', expiresIn: '7d' }),
    CoachModule,
  ],
})
export class AppModule {}
```

> The `app.module.test.ts` from Task 2 asserts `app.module.ts` contains no "pizzaz"; this edit keeps that true.

- [ ] **Step 5: Run the wiring test (and the Task-2 test) to verify they pass**

Run: `npm test -- src/app.module.wiring.test.ts src/app.module.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the whole server**

Run: `npm run typecheck`
Expected: no errors. (If NitroStack decorator signatures surface friction under `noUncheckedIndexedAccess`, address locally in the new files; do not weaken the flag.)

- [ ] **Step 7: Commit**

```bash
git add src/coach/coach.module.ts src/app.module.ts src/app.module.wiring.test.ts
git commit -m "feat: wire CoachModule + JWTModule into AppModule"
```

---

## Task 17: The timeline widget — manifest, components, Next.js page

**Files:**
- Create: `src/widgets/app/delivery-timeline/page.tsx`
- Create: `src/widgets/components/coach/` — `DeliveryTimelineWidget.tsx`, `Timeline.tsx`, `ScriptPanel.tsx`, `SummaryCard.tsx`, `NextStepCard.tsx`, `SkeletonLoader.tsx`, `utils.ts`, `index.css`
- Create: `src/widgets/components/coach/contracts.ts` (widget-local copy of the Tier-1 types + display constants)
- Modify: `src/widgets/widget-manifest.json`
- Modify: `src/widgets/package.json` (drop mapbox/lucide if unused; add nothing new — components are dependency-free)

**Interfaces:**
- Consumes: `DeliveryReport` shape (from the widget-local `contracts.ts`), the tool output of `analyze_delivery` via `getToolOutput<DeliveryReport>()`, and `callTool('suggest_next_step', …)` for the confirm action.
- Produces: the `delivery-timeline` route rendered by `@Widget('delivery-timeline')`.

> The widget is a separate Next.js app with its own `node_modules`/tsconfig and is excluded from Vitest and the root tsconfig. It cannot import from `src/domain` (different build root), so it carries a small widget-local `contracts.ts` with the Tier-1 types + `SEVERITY_COLOR`/`SEVERITY_LABEL`/`ISSUE_TYPE_LABEL`/`isAllowedAudioUrl`. This mirrors the reference widget importing `@nsh/contracts`.

- [ ] **Step 1: Create the widget-local contracts file**

`src/widgets/components/coach/contracts.ts`: copy the **Tier-1 types and display constants only** from `src/domain/contracts/index.ts` — `IssueType`, `Severity`, `ScriptSegment`, `DeliveryIssue`, `NextStep`, `DeliveryReport` (as TypeScript `interface`/`type`, not Zod, to avoid pulling Zod into the widget bundle — or keep Zod if already a widget dep; TS types suffice), plus `SEVERITY_COLOR`, `SEVERITY_LABEL`, `ISSUE_TYPE_LABEL`, and the `isAllowedAudioUrl` function verbatim. Keep field names identical to the contract.

- [ ] **Step 2: Copy the six components + utils + css**

Copy from `packages/widget/src/widget/`:
- `DeliveryTimelineWidget.tsx`, `Timeline.tsx`, `ScriptPanel.tsx`, `SummaryCard.tsx`, `NextStepCard.tsx`, `SkeletonLoader.tsx`, `utils.ts`, `index.css`

into `src/widgets/components/coach/`. In every file, rewrite `from '@nsh/contracts'` → `from './contracts'` (relative, no `.js` — Next.js/TS resolves bare). Keep all component logic verbatim (the timeline ticks, tooltip/popover, `layoutTicks`, `formatTime`, `computePaceVariancePm`, severity colors). `DeliveryTimelineWidget.tsx` keeps its `report: DeliveryReport` + `onNextStepExecute` props — the page wires those.

- [ ] **Step 3: Create the Next.js page that feeds the widget from tool output**

`src/widgets/app/delivery-timeline/page.tsx`:
```tsx
'use client';

export const dynamic = 'force-dynamic';

import { useCallback } from 'react';
import { useWidgetSDK } from '@nitrostack/widgets';
import DeliveryTimelineWidget from '../../components/coach/DeliveryTimelineWidget';
import type { DeliveryReport, NextStep } from '../../components/coach/contracts';
import '../../components/coach/index.css';

export default function DeliveryTimelinePage() {
  const { isReady, getToolOutput, callTool } = useWidgetSDK();
  const report = getToolOutput<DeliveryReport>();

  const onExecute = useCallback(
    (step: NonNullable<DeliveryReport['nextStep']>) => {
      if (!report) return;
      // The confirm button — the ONLY path that fires a connector. execute:true.
      callTool('suggest_next_step', {
        report,
        takeId: report.reportId.replace(/^rpt-demo-/, ''),
        now: new Date().toISOString(),
        execute: true,
      }).catch(() => { /* surfaced by the card's optimistic receipt */ });
      void step;
    },
    [report, callTool],
  );

  if (!isReady) return <div style={{ padding: 24 }}>Connecting to host…</div>;
  if (!report) return <div style={{ padding: 24 }}>No delivery report received.</div>;

  return <DeliveryTimelineWidget report={report} onNextStepExecute={onExecute} />;
}
```

- [ ] **Step 4: Update `widget-manifest.json` with real examples from the goldens**

Replace the empty `widgets: []` with one entry for `/delivery-timeline`, whose two `examples[].data` are the **verbatim contents** of `fixtures/report.clean.json` and `fixtures/report.rough.json`:
```json
{
  "version": "1.0.0",
  "widgets": [
    {
      "uri": "/delivery-timeline",
      "name": "Delivery Timeline",
      "description": "Timestamped delivery-mechanics corrections against your own script",
      "examples": [
        { "name": "Clean take", "description": "Rehearsed take — mostly green ticks", "data": <PASTE fixtures/report.clean.json HERE> },
        { "name": "Rough take", "description": "One red tick on the rushed key stat", "data": <PASTE fixtures/report.rough.json HERE> }
      ],
      "tags": ["timeline", "speech", "coaching"]
    }
  ],
  "generatedAt": "2026-07-26T00:00:00.000Z"
}
```
Paste the full JSON objects (not string references) in place of the `<PASTE …>` markers.

- [ ] **Step 5: Trim widget deps**

In `src/widgets/package.json`, remove `mapbox-gl`, `@types/mapbox-gl`, and `lucide-react` (the coach components use no icons library or maps). Remove the `import 'mapbox-gl/dist/mapbox-gl.css';` line from `src/widgets/app/layout.tsx`. Run `npm --prefix src/widgets install` to refresh the lockfile.

- [ ] **Step 6: Verify the widget builds**

Run: `npm --prefix src/widgets run build`
Expected: Next.js build succeeds with routes `/` and `/delivery-timeline`. (No Vitest here — the widget is excluded; the build is the gate.)

- [ ] **Step 7: Commit**

```bash
git add src/widgets/app/delivery-timeline/page.tsx src/widgets/components/coach src/widgets/widget-manifest.json src/widgets/package.json src/widgets/package-lock.json src/widgets/app/layout.tsx
git commit -m "feat: port delivery timeline widget as a NitroStack @Widget page"
```

---

## Task 18: Golden end-to-end test via TestingModule

**Files:**
- Create: `src/coach/coach.e2e.test.ts`

**Interfaces:**
- Consumes: the assembled `CoachTools` + `CoachService` (real providers), the golden fixtures.
- Produces: the single most important test — the port's analog of the reference `integration.test.ts`, invoked as direct tool-method calls (there is no HTTP layer).

- [ ] **Step 1: Write the failing end-to-end test**

`src/coach/coach.e2e.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoachTools } from './coach.tools.js';
import { CoachService } from './coach.service.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';
import { DeliveryReport, isAllowedAudioUrl } from '../domain/contracts/index.js';

const fixtureDir = join(process.cwd(), 'fixtures');
const golden = (label: string) => JSON.parse(readFileSync(join(fixtureDir, `report.${label}.json`), 'utf8')) as DeliveryReport;
const stripUrl = (r: DeliveryReport) => { const { audioUrl, ...rest } = r; return rest; };
const ctx = () => ({ toolName: 'analyze_delivery', logger: { info() {}, warn() {}, error() {}, debug() {} } }) as never;

function tools() {
  // ENABLE_PROSODY=false: the goldens were generated with an empty ProsodyTrack.
  const config = new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }));
  const svc = new CoachService(config, new FixtureContextProvider(config), new FixtureCalendarConnector(), new FixtureGmailConnector());
  return new CoachTools(svc);
}

describe.each(['rough', 'clean'])('analyze_delivery — %s take (golden lock)', (label) => {
  it('deep-equals the committed golden report, modulo audioUrl', async () => {
    const actual = await tools().analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx());
    expect(DeliveryReport.safeParse(actual).success).toBe(true);
    expect(stripUrl(actual)).toEqual(stripUrl(golden(label)));
  });

  it('produces a widget-loadable audioUrl', async () => {
    const actual = await tools().analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx());
    expect(actual.audioUrl).toBe(`/api/audio/${label}`);
    expect(isAllowedAudioUrl(actual.audioUrl!)).toBe(true);
    // The golden carries a DIFFERENT url; that's exactly why it is excluded above.
    expect(actual.audioUrl).not.toBe(golden(label).audioUrl);
  });

  it('is byte-stable across repeated runs', async () => {
    const t = tools();
    const [a, b] = await Promise.all([
      t.analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx()),
      t.analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx()),
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the numbers the demo turns on', () => {
  it('rough: exactly one high-severity stress_mismatch on seg-005, calendar next step', async () => {
    const r = await tools().analyzeDelivery({ takeId: 'rough', now: '2026-07-25T09:00:00Z' }, ctx());
    const high = r.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
    expect(high[0]!.type).toBe('stress_mismatch');
    expect(r.fillerCount).toBe(2);
    expect(r.nextStep!.kind).toBe('calendar_reminder');
    expect(r.nextStep!.executed).toBe(false);
  });

  it('clean: two low-severity issues, zero fillers, draft-note next step', async () => {
    const r = await tools().analyzeDelivery({ takeId: 'clean', now: '2026-07-25T09:00:00Z' }, ctx());
    expect(r.issues).toHaveLength(2);
    expect(r.issues.every((i) => i.severity === 'low')).toBe(true);
    expect(r.fillerCount).toBe(0);
    expect(r.nextStep!.kind).toBe('draft_note');
    expect(r.nextStep!.executed).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails (or passes if all upstream is correct)**

Run: `npm test -- src/coach/coach.e2e.test.ts`
Expected: initially FAIL only if any upstream port drifted; the assertions must all be able to fail (e.g. flip `ENABLE_PROSODY` to `true` and the golden deep-equals would break, proving the assertion bites).

- [ ] **Step 3: Fix any drift surfaced, then verify it passes**

Run: `npm test -- src/coach/coach.e2e.test.ts`
Expected: PASS (rough+clean × 3 golden-lock cases, plus 2 demo-number cases).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests green across domain, config, adapters, common, coach.

- [ ] **Step 5: Commit**

```bash
git add src/coach/coach.e2e.test.ts
git commit -m "test: golden end-to-end lock via direct tool-method calls"
```

---

## Task 19: Demo run instructions for NitroStudio

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: the operator instructions that make the SPEC §8 90-second demo reproducible in NitroStudio.

- [ ] **Step 1: Write the failing docs test**

`src/readme.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('README demo instructions', () => {
  it('documents the analyze_delivery demo and the required env vars', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('analyze_delivery');
    expect(readme).toContain('STT_PROVIDER');
    expect(readme).toContain('delivery-timeline');
    expect(readme.toLowerCase()).toContain('nitrostudio');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/readme.test.ts`
Expected: FAIL — the pizzaz README lacks these strings.

- [ ] **Step 3: Rewrite `README.md`**

Replace the pizzaz README with sections covering:
- **What it is** — one-paragraph pitch (from SPEC §1).
- **Run locally** — `npm install`, `npm run dev` (NitroStack CLI), widget dev `npm --prefix src/widgets run dev`.
- **Tests** — `npm test` (golden lock explained), `npm run typecheck`.
- **Env** — the `.env.example` table: `STT_PROVIDER` (`fixture`|`deepgram`), `DEEPGRAM_API_KEY` (deploy-only), `ENABLE_PROSODY`, `AUDIO_MAX_SECONDS`, `JWT_SECRET` (enables real auth on `suggest_next_step`). Note secrets live in NitroCloud env, never committed.
- **The 90-second demo (SPEC §8) in NitroStudio's tool-invocation pane:**
  1. Invoke `analyze_delivery` with `{ "takeId": "clean", "now": "2026-07-25T09:00:00Z" }` → the `delivery-timeline` widget renders with mostly green ticks, filler count 0.
  2. Invoke `analyze_delivery` with `{ "takeId": "rough", "now": "2026-07-25T09:00:00Z" }` → one **red** tick lands on **seg-005** (the rushed key stat); click it to see the WPM mismatch and the script line.
  3. Open Ops Canvas on `correlate_segments` → watch severity decided per issue (most fillers low, the key-claim rush high) via `DecisionTrace.rule`.
  4. Click the next-step card's confirm → the widget calls `suggest_next_step` with `execute:true`; a calendar reminder (rough) or draft note (clean) fires and the receipt shows.
  5. Land on the summary card.
- **Architecture** — name the NitroStack surfaces used: `@Tool` + Zod on every tool, `@Widget` timeline, `AuditInterceptor` on every call, `NextStepGuard` on the connector tool, `JWTModule`, `ConfigModule`, deploy-on-push to NitroCloud.
- **Graceful degradation note** — prosody decode via `ffmpeg-static` falls back to an empty track if the binary is unavailable in the build environment; the analysis still runs (word-timing rules are unaffected).

- [ ] **Step 4: Run the docs test to verify it passes**

Run: `npm test -- src/readme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md src/readme.test.ts
git commit -m "docs: NitroStudio demo run instructions and architecture overview"
```

---

## Self-Review

**1. Spec coverage** — every capability in "the product being ported" maps to a task:

| Capability | Task(s) |
|---|---|
| Frozen contract (all Zod types, `CoreLogic`/`SttClient`, constants, `isAllowedAudioUrl`) | 3 |
| Seven pure functions (tokenize, parse-script, align, baseline, correlate, summary, next-step, prosody) + thresholds/errors | 5, 6, 7, 8 |
| Deterministic IDs / units / purity | Global Constraints + inherited by 5–8, verified in 8/18 golden |
| STT fixture + Deepgram (load-bearing query params) | 10 |
| Prosody decode + non-fatal degradation + `AUDIO_TOO_SHORT` propagation | 11 |
| Connectors + context provider + `NEUTRAL_CONTEXT` | 13 |
| `parseToolInput` decision (dropped) / `assertToolOutput` (kept) | Decision #2, 15 |
| Path-traversal guard (`takes`) | 12 |
| Execute-gating security constraint | 15 (service + tools tests), 18 |
| Exception filter / `CoachError` taxonomy | 13 |
| Auth guard seam on `suggest_next_step` | 14 |
| Secrets → env config, documented vars | 9, README 19 |
| Five `@Tool` wrappers + base64 upload replacing multipart | 15 |
| Module wiring (`app.module.ts`, JWTModule) | 16 |
| Widget-manifest real examples + fixture copy | 4, 17 |
| Five React components → Next.js `@Widget` page | 17 |
| Golden end-to-end test via `TestingModule`/direct calls | 18 |
| SPEC §8 demo (clean green / rough red on key point, clickable) | 17 (widget), 18 (numbers lock), 19 (run steps) |
| Audit-logging interceptor (brief §3) | 13, applied in 15 |
| `ffmpeg-static` uncertainty under NitroCloud | 11 (tested degradation), README 19 |
| `noUncheckedIndexedAccess` decision | Decision #6, Task 1 |
| Single-package (no workspaces) decision | Decision #1, Tasks 3/5–8 import rewrites |

No gaps found.

**2. Placeholder scan** — the only `<PASTE …>` markers are in Task 17 Step 4, where the instruction is explicit (paste the verbatim JSON of the two golden report files); this is a deliberate copy instruction, not an unfilled placeholder, because inlining two ~large golden JSON blobs here would duplicate files the plan already commits in Task 4. Every code step contains complete code. No "TODO"/"similar to Task N"/"add error handling" placeholders remain (the `NextStepGuard` and `audio-decode` `Logger` "TODO" comments are load-bearing documented seams, matching the reference's own comments, not plan gaps).

**3. Type/name consistency** — cross-task references checked: `AppConfigService` (9 → 10/12/13/15/16/18), `CoachService`/`CoachTools` (15 → 16/18), `FixtureContextProvider`/`FixtureCalendarConnector`/`FixtureGmailConnector` (13 → 15/16/18), `NextStepGuard` (14 → 15/16), `CoachExceptionFilter`/`AuditInterceptor` (13 → 15/16), `Logger` type (13 → 11/15), `assertToolOutput` (15, self-contained), `frozenTranscriptPath`/`resolveTakeAudio`/`uploadFilenameFor`/`uploadTakeId` (12 → 10/15), `reportIdFor`/`audioUrlFor` (15, `/api/audio/<takeId>` consistent with widget's `reportId.replace(/^rpt-demo-/, '')` in 17). The takes→stt dependency ordering (Task 12 before Task 10) is flagged explicitly in both tasks.

**4. NitroStack API verification** — every NitroStack symbol used is confirmed in the installed skill docs or the pizzaz scaffold: `@McpApp`, `@Module` (imports/controllers/providers/name/description), `ConfigModule.forRoot`, `@Injectable({ deps })`, `ControllerDecorator`, `@Tool({ name, description, inputSchema, outputSchema })`, `@Widget(route)`, `ExecutionContext`/`ctx.logger`, `@UseGuards`/`Guard`/`canActivate`/`ctx.metadata?.authorization`, `@UseFilters`/`ExceptionFilterInterface`/`catch`, `@UseInterceptors`/`InterceptorInterface`/`intercept`, `JWTModule.forRoot`, `useWidgetSDK`/`getToolOutput`/`callTool`, `TestingModule.create().addProvider/.addMock/.compile()`/`.get()`/`.cleanup()`, `McpApplicationFactory.create().start()`.

**Flagged as uncertain / unverified — reviewer should confirm at execution time:**
- **`@UseFilters`/`@UseInterceptors`/`@UseGuards` at the class (controller) level.** The skill docs only show these decorators applied to individual tool *methods*. Applying `@UseFilters(CoachExceptionFilter)` and `@UseInterceptors(AuditInterceptor)` to the whole `CoachTools` class (Task 15) is assumed to cascade to all methods. If class-level application is unsupported, move both decorators onto each `@Tool` method individually.
- **`ExecutionContext.toolName` and `ctx.logger.{info,warn,error,debug}(message, meta)` shape.** The middleware skill uses `context.toolName` and `context.logger.info(...)`; the tools skill uses `ctx.logger.info(msg, meta)`. The `AuditInterceptor` and `toLogger` bridge assume both. Confirm the exact `ExecutionContext` interface (`node_modules/@nitrostack/core/dist/core/types.d.ts`) and adjust `toLogger`/`AuditInterceptor` if method names differ.
- **`TestingModule.addProvider(Class)` resolving a class with constructor `deps`.** The `.d.ts` signature is `addProvider<T>(token, provider?)`. Task 16's wiring test assumes it constructs `CoachService`/`CoachTools` by resolving their `deps`. A fallback (manual construction) is documented in Task 16.
- **`ExceptionFilterInterface.catch` return semantics.** Whether the returned object becomes the tool's error payload verbatim, or is wrapped, is unverified; the filter returns `mapped.body` and the reviewer should confirm the client sees `{ error: { code, message } }`.
- **`@Widget` feeding `getToolOutput<DeliveryReport>()` with the tool's raw return value.** The ui-widgets skill states the widget receives the tool return via `getToolOutput<T>()`; confirmed by doc, but the exact serialization of a Zod-validated `DeliveryReport` (nested arrays, nullable fields) through the widget bridge should be eyeballed in NitroStudio during Task 17.
- **`JWTModule.forRoot({ secret, expiresIn })`** is used from the auth-security skill example verbatim; no separate `jsonwebtoken` verification is wired (the guard does a structural check only) — flagged as the deploy-time TODO in Task 14.

Fix-inline decisions applied: none required beyond the flags above (those are runtime-confirmation items, not plan errors).

---

**Plan complete.** Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.
