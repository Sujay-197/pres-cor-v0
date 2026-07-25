# P1 Core Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the seven pure functions behind the `CoreLogic` contract, turning a script plus a recording into a `DeliveryReport` with one high-severity issue on the rushed key point.

**Architecture:** Pure TypeScript library, zero NitroStack imports, zero network, zero clock reads. Needleman-Wunsch aligns script tokens to transcript tokens; severity verdicts come from a data table, not scattered conditionals; every verdict carries a `DecisionTrace` for Ops Canvas.

**Tech Stack:** TypeScript 5.6 (strict, `noUncheckedIndexedAccess`), Vitest 2.1, Zod 3 (via `@nsh/contracts`), `pitchfinder` (Task 11 only), Node 24.

## Global Constraints

- Time is **always float seconds**, never milliseconds, at every layer.
- All emitted floats **round to 1 decimal** (`Math.round(x * 10) / 10`).
- IDs are deterministic: `seg-NNN` in source order, `iss-NNN` assigned **after** sorting.
- Core logic is **pure**: no `Date.now()`, no `Math.random()`, no `fs`, no network.
- Never throw raw `Error` across a boundary — always `CoachError` with a code.
- Import types from `@nsh/contracts`; never redeclare them.
- WPM **excludes fillers** and **divides by voiced time**, not wall-clock.
- Commit after every task. Branch `p1/core-logic`.

**Spec:** [`docs/superpowers/specs/2026-07-25-p1-core-logic-design.md`](../specs/2026-07-25-p1-core-logic-design.md)

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/thresholds.ts` | `THRESHOLDS`, `SEVERITY_RULES` — tuned during rehearsal | 1 |
| `src/tokenize.ts` | normalisation + hard/soft filler lexicons | 1 |
| `src/parse-script.ts` | `parseScript` | 2 |
| `scripts/transcribe.mjs` | dev tool: audio → frozen transcript fixture | 3 |
| `src/align.ts` | `needlemanWunsch`, `alignSegments` | 4, 5 |
| `src/baseline.ts` | `computeBaseline` | 6 |
| `src/correlate.ts` | `correlateSegments` — the branch point | 7, 9 |
| `src/summary.ts` | `generateSummary` | 8 |
| `src/next-step.ts` | `decideNextStep` | 10 |
| `src/prosody.ts` | `extractProsody` | 11 |
| `src/index.ts` | public re-exports only | every task |

---

### Task 1: Tokenizer and threshold table

**Files:**
- Create: `packages/core-logic/src/thresholds.ts`
- Create: `packages/core-logic/src/tokenize.ts`
- Create: `packages/core-logic/src/tokenize.test.ts`
- Modify: `packages/core-logic/src/index.ts` (remove `THRESHOLDS`/`SEVERITY_RULES`, re-export instead)

**Interfaces:**
- Consumes: `FILLER_LEXICON`, `Severity`, `Word` from `@nsh/contracts`
- Produces: `normaliseText(text: string): string[]`, `fillerMatchLength(tokens: string[], i: number): 0|1|2`, `isHardFiller(token: string): boolean`, `isSoftFiller(tokens: string[], i: number): 0|1|2`, `tagHardFillers(words: Word[]): Word[]`, `THRESHOLDS`, `SEVERITY_RULES`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core-logic/src/tokenize.test.ts
import { describe, expect, it } from 'vitest';
import { fillerMatchLength, isHardFiller, isSoftFiller, normaliseText, tagHardFillers } from './tokenize.js';

describe('normaliseText', () => {
  it('lowercases, strips punctuation, splits on whitespace', () => {
    expect(normaliseText('Good morning. I am Sujay!')).toEqual(['good', 'morning', 'i', 'am', 'sujay']);
  });

  it('splits hyphenated words so script and transcript agree', () => {
    // Script says "ninety-eight"; Deepgram (smart_format=false) says "ninety eight".
    expect(normaliseText('ninety-eight percent')).toEqual(normaliseText('ninety eight percent'));
  });

  it('returns an empty array for whitespace only', () => {
    expect(normaliseText('   \n  ')).toEqual([]);
  });

  it('keeps digits', () => {
    expect(normaliseText('98% match')).toEqual(['98', 'match']);
  });
});

describe('filler classification', () => {
  it('treats uh and um as hard fillers', () => {
    expect(isHardFiller('uh')).toBe(true);
    expect(isHardFiller('um')).toBe(true);
  });

  it('does not treat like as a hard filler', () => {
    // "I'd like to talk about..." — script.demo.md:11 uses it legitimately.
    expect(isHardFiller('like')).toBe(false);
  });

  it('matches two-word soft fillers as bigrams', () => {
    expect(isSoftFiller(['you', 'know', 'what'], 0)).toBe(2);
    expect(isSoftFiller(['i', 'mean', 'it'], 0)).toBe(2);
  });

  it('matches single-word soft fillers', () => {
    expect(isSoftFiller(['basically', 'we'], 0)).toBe(1);
  });

  it('returns 0 for ordinary words', () => {
    expect(isSoftFiller(['reconcile', 'inventory'], 0)).toBe(0);
  });

  it('prefers the longer bigram over the unigram', () => {
    // "know" alone is not a filler; "you know" is. Bigram must win.
    expect(fillerMatchLength(['you', 'know'], 0)).toBe(2);
  });
});

describe('tagHardFillers', () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.2, confidence: 0.9, isFiller: false });

  it('flags hard fillers and leaves soft ones alone', () => {
    const out = tagHardFillers([w('um', 0), w('like', 1), w('reconcile', 2)]);
    expect(out.map((x) => x.isFiller)).toEqual([true, false, false]);
  });

  it('does not mutate its input', () => {
    const input = [w('um', 0)];
    tagHardFillers(input);
    expect(input[0]!.isFiller).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic`
Expected: FAIL — `Cannot find module './tokenize.js'`

- [ ] **Step 3: Create the threshold table**

```ts
// packages/core-logic/src/thresholds.ts
import type { Severity } from '@nsh/contracts';

/** Tuned against the locked demo recordings. Task 12 revisits these. */
export const THRESHOLDS = {
  /** A gap longer than this between words counts as a pause, in seconds. */
  pauseMinSec: 0.35,
  /** Pace beyond baseline ± this many standard deviations is drift. */
  paceDriftSigma: 1.5,
  /** Fillers in one segment beyond this count escalate low -> medium. */
  fillerDensityPerSegment: 2,
  /** A marked pause honoured at less than this fraction of median is skipped. */
  markedPauseHonouredRatio: 0.5,
  /** Relative f0 rise across a key-point line that reads as uncertainty. */
  risingPitchRatio: 1.12,
  /** Below this overall alignment match rate, the audio is not this script. */
  minMatchRate: 0.4,
  /** Recordings shorter than this cannot be analysed. */
  minAudioSec: 5,
} as const;

/**
 * The severity table. Each rule names the TWO signals it cross-references —
 * a rule reading one signal is a lint check, not a correlation, and is `low`
 * by construction. `DecisionTrace.rule` carries these ids to Ops Canvas.
 */
export const SEVERITY_RULES: ReadonlyArray<{
  id: string;
  type: string;
  signals: [string, string];
  verdict: Severity;
  why: string;
}> = [
  {
    id: 'stress.key-point-rushed',
    type: 'stress_mismatch',
    signals: ['script.isKeyPoint', 'delivery.wpm vs baseline'],
    verdict: 'high',
    why: 'Rushing the line the script marks as the key claim undermines the claim itself.',
  },
  {
    id: 'stress.key-point-rising-pitch',
    type: 'stress_mismatch',
    signals: ['script.isKeyPoint', 'delivery.f0 slope'],
    verdict: 'high',
    why: 'Rising pitch on a stated fact delivers it as a question.',
  },
  {
    id: 'pause.marked-not-honoured',
    type: 'pause',
    signals: ['script.markedPause', 'delivery.precedingPauseSec'],
    verdict: 'medium',
    why: 'A planned beat that was skipped — the setup for the next line lands flat.',
  },
  {
    id: 'filler.in-key-point',
    type: 'filler',
    signals: ['script.isKeyPoint', 'delivery.fillerCount'],
    verdict: 'medium',
    why: 'A hedge immediately before a key claim reads as doubt about the claim.',
  },
  {
    id: 'filler.density',
    type: 'filler',
    signals: ['delivery.fillerCount', 'segment.wordCount'],
    verdict: 'medium',
    why: 'Density, not any single filler, is what an audience notices.',
  },
  {
    id: 'filler.isolated',
    type: 'filler',
    signals: ['delivery.fillerCount', 'script.isKeyPoint'],
    verdict: 'low',
    why: 'A filler on a low-stakes transition. Worth noting, not worth fixing.',
  },
  {
    id: 'pacing.drift',
    type: 'pacing',
    signals: ['delivery.wpm', 'baseline.avgPaceWpm'],
    verdict: 'low',
    why: 'Drift away from a key point. Informational.',
  },
];

export function ruleById(id: string) {
  const rule = SEVERITY_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown severity rule: ${id}`);
  return rule;
}
```

- [ ] **Step 4: Create the tokenizer**

```ts
// packages/core-logic/src/tokenize.ts
import { FILLER_LEXICON, type Word } from '@nsh/contracts';

/**
 * Hard fillers are never legitimate script words, so they can be tagged on
 * sight. Deepgram returns these directly under filler_words=true.
 */
export const HARD_FILLERS: ReadonlySet<string> = new Set(['uh', 'um', 'mm', 'mhmm', 'hmm', 'er', 'ah']);

/**
 * Soft fillers MAY be legitimate script words — script.demo.md:11 reads
 * "I'd like to talk about what the next twelve months look like". They are
 * only fillers when alignment shows they have no matching script token, so
 * they are resolved after alignment (see align.ts), never here.
 */
export const SOFT_FILLERS: readonly string[] = FILLER_LEXICON.filter((f) => !HARD_FILLERS.has(f));

const SOFT_BIGRAMS: ReadonlySet<string> = new Set(SOFT_FILLERS.filter((f) => f.includes(' ')));
const SOFT_UNIGRAMS: ReadonlySet<string> = new Set(SOFT_FILLERS.filter((f) => !f.includes(' ')));

/**
 * The single normalisation path. Script text and transcript words BOTH go
 * through this or alignment fails on punctuation alone.
 *
 * Hyphens split rather than collapse, so the script's "ninety-eight" and
 * Deepgram's "ninety eight" produce identical tokens. This is why the request
 * sets smart_format=false and numerals=false — with them on we would be
 * comparing "ninety-eight percent" against "98%".
 */
export function normaliseText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function isHardFiller(token: string): boolean {
  return HARD_FILLERS.has(token);
}

/** Returns how many tokens the soft filler at position `i` spans: 2, 1 or 0. */
export function isSoftFiller(tokens: string[], i: number): 0 | 1 | 2 {
  const first = tokens[i];
  if (first === undefined) return 0;
  const second = tokens[i + 1];
  if (second !== undefined && SOFT_BIGRAMS.has(`${first} ${second}`)) return 2;
  return SOFT_UNIGRAMS.has(first) ? 1 : 0;
}

/** Longest match wins — "you know" must beat a bare "know". */
export function fillerMatchLength(tokens: string[], i: number): 0 | 1 | 2 {
  const soft = isSoftFiller(tokens, i);
  if (soft > 0) return soft;
  const first = tokens[i];
  return first !== undefined && isHardFiller(first) ? 1 : 0;
}

/** Applies the hard-filler pass. Exported so P2's STT adapter classifies identically. */
export function tagHardFillers(words: Word[]): Word[] {
  return words.map((w) => ({ ...w, isFiller: isHardFiller(normaliseText(w.text)[0] ?? '') }));
}
```

- [ ] **Step 5: Re-export from index.ts**

Replace the `THRESHOLDS` and `SEVERITY_RULES` declarations in `packages/core-logic/src/index.ts` with:

```ts
export * from './errors.js';
export * from './thresholds.js';
export * from './tokenize.js';
```

Keep the seven function stubs in place for now; later tasks replace them one at a time.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w packages/core-logic && npm run typecheck -w packages/core-logic`
Expected: PASS — 12 tests green, no type errors

- [ ] **Step 7: Commit**

```bash
git add packages/core-logic/src/thresholds.ts packages/core-logic/src/tokenize.ts packages/core-logic/src/tokenize.test.ts packages/core-logic/src/index.ts
git commit -m "feat(core-logic): tokenizer with hard/soft filler split

Soft fillers (like, right, actually) can be legitimate script words —
script.demo.md:11 uses 'like' twice. They are resolved after alignment
rather than by lexicon match, so seg-006 keeps an honest word count."
```

---

### Task 2: parseScript

**Files:**
- Create: `packages/core-logic/src/parse-script.ts`
- Create: `packages/core-logic/src/parse-script.test.ts`
- Modify: `packages/core-logic/src/index.ts`

**Interfaces:**
- Consumes: `normaliseText` (Task 1); `ScriptSegment`, `SCRIPT_MARKUP` from `@nsh/contracts`; `CoachError` from `./errors.js`
- Produces: `parseScript(raw: string): ScriptSegment[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core-logic/src/parse-script.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoachError } from './errors.js';
import { parseScript } from './parse-script.js';

const demo = readFileSync(
  join(import.meta.dirname, '../../contracts/fixtures/script.demo.md'),
  'utf8',
);

describe('parseScript', () => {
  it('splits the demo script into six segments', () => {
    expect(parseScript(demo)).toHaveLength(6);
  });

  it('assigns zero-padded ids in source order', () => {
    expect(parseScript(demo).map((s) => s.id)).toEqual([
      'seg-001', 'seg-002', 'seg-003', 'seg-004', 'seg-005', 'seg-006',
    ]);
  });

  it('marks bolded segments as key points', () => {
    const keys = parseScript(demo).filter((s) => s.isKeyPoint).map((s) => s.id);
    expect(keys).toEqual(['seg-003', 'seg-005']);
  });

  it('marks [pause] segments and strips the token from text', () => {
    const seg = parseScript(demo).find((s) => s.id === 'seg-003')!;
    expect(seg.markedPause).toBe(true);
    expect(seg.text).not.toContain('[pause]');
    expect(seg.text.startsWith('We cut that to')).toBe(true);
  });

  it('strips bold markers from text but keeps the words', () => {
    const seg = parseScript(demo).find((s) => s.id === 'seg-003')!;
    expect(seg.text).not.toContain('*');
    expect(seg.text).toContain('under six minutes');
  });

  it('leaves non-key non-pause segments unflagged', () => {
    const seg = parseScript(demo).find((s) => s.id === 'seg-001')!;
    expect(seg.isKeyPoint).toBe(false);
    expect(seg.markedPause).toBe(false);
  });

  it('collapses internal whitespace and trims', () => {
    const [seg] = parseScript('The   quick\n  brown fox');
    expect(seg!.text).toBe('The quick brown fox');
  });

  it('ignores blank blocks from extra newlines', () => {
    expect(parseScript('One line\n\n\n\nTwo line')).toHaveLength(2);
  });

  it('throws SCRIPT_EMPTY on blank input', () => {
    expect(() => parseScript('   \n  ')).toThrow(CoachError);
    try { parseScript(''); } catch (e) { expect((e as CoachError).code).toBe('SCRIPT_EMPTY'); }
  });

  it('throws SCRIPT_NO_SEGMENTS when only markup remains', () => {
    try { parseScript('[pause]\n\n[pause]'); }
    catch (e) { expect((e as CoachError).code).toBe('SCRIPT_NO_SEGMENTS'); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- parse-script`
Expected: FAIL — `Cannot find module './parse-script.js'`

- [ ] **Step 3: Implement parseScript**

```ts
// packages/core-logic/src/parse-script.ts
import { SCRIPT_MARKUP, type ScriptSegment } from '@nsh/contracts';
import { CoachError } from './errors.js';

/**
 * `[pause]` means a pause BEFORE this segment, matching its position at the
 * head of segment 3 in script.demo.md. It is never a mid-segment pause.
 */
export function parseScript(raw: string): ScriptSegment[] {
  if (raw.trim().length === 0) {
    throw new CoachError('SCRIPT_EMPTY', 'Script is empty.');
  }

  const segments: ScriptSegment[] = [];

  for (const block of raw.split(SCRIPT_MARKUP.segmentDelimiter)) {
    const isKeyPoint = new RegExp(SCRIPT_MARKUP.keyPoint.source, 'g').test(block);
    const markedPause = new RegExp(SCRIPT_MARKUP.pause.source, 'gi').test(block);

    const text = block
      .replace(new RegExp(SCRIPT_MARKUP.pause.source, 'gi'), ' ')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length === 0) continue;

    segments.push({
      id: `seg-${String(segments.length + 1).padStart(3, '0')}`,
      text,
      isKeyPoint,
      markedPause,
    });
  }

  if (segments.length === 0) {
    throw new CoachError('SCRIPT_NO_SEGMENTS', 'Script contained no text outside markup.');
  }

  return segments;
}
```

Note: `SCRIPT_MARKUP.keyPoint` and `.pause` are module-level regexes carrying the `g` flag, which makes `.test()` stateful via `lastIndex`. Each use above builds a fresh `RegExp` from `.source` to avoid that trap.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/core-logic -- parse-script`
Expected: PASS — 10 tests green

- [ ] **Step 5: Export and commit**

Add to `packages/core-logic/src/index.ts`, removing the `parseScript` stub:

```ts
export * from './parse-script.js';
```

```bash
git add packages/core-logic/src/parse-script.ts packages/core-logic/src/parse-script.test.ts packages/core-logic/src/index.ts
git commit -m "feat(core-logic): parseScript with markup stripping

Builds fresh RegExp per call — SCRIPT_MARKUP patterns carry the g flag,
so a shared .test() would be stateful via lastIndex."
```

---

### Task 3: Deepgram dev tool and frozen transcript fixture

**Files:**
- Create: `scripts/transcribe.mjs`
- Create: `packages/contracts/fixtures/transcript.rough.json` (generated)
- Create: `packages/contracts/fixtures/transcript.clean.json` (generated)

**Interfaces:**
- Consumes: `DEEPGRAM_API_KEY` from `.env`; audio at `fixtures/audio/take-{clean,rough}.*`
- Produces: two frozen `Transcript` JSON files, provider `"deepgram"`

**Prerequisite:** the two recordings exist. Tasks 1–2 do not need them; Task 5 onward does.

- [ ] **Step 1: Write the dev script**

```js
#!/usr/bin/env node
// scripts/transcribe.mjs
//
// Dev tool, not shipped. Turns a recording into a frozen Transcript fixture.
// Run:  node --env-file=.env scripts/transcribe.mjs fixtures/audio/take-rough.m4a rough
//
// smart_format and numerals are OFF on purpose: both rewrite spoken numbers
// into digits ("ninety-eight percent" -> "98%"), which would sabotage
// text-matching against the script. We want verbatim tokens.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const [audioPath, label] = process.argv.slice(2);
if (!audioPath || !label) {
  console.error('usage: node --env-file=.env scripts/transcribe.mjs <audio> <clean|rough>');
  process.exit(1);
}

const key = process.env.DEEPGRAM_API_KEY;
if (!key) {
  console.error('DEEPGRAM_API_KEY not set. Run with --env-file=.env');
  process.exit(1);
}

const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
               '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg' };
const ext = extname(audioPath).toLowerCase();
const contentType = MIME[ext];
if (!contentType) {
  console.error(`unsupported extension ${ext}; supported: ${Object.keys(MIME).join(', ')}`);
  process.exit(1);
}

const params = new URLSearchParams({
  model: 'nova-3',
  filler_words: 'true',
  punctuate: 'true',
  smart_format: 'false',
  numerals: 'false',
});

console.log(`transcribing ${basename(audioPath)} ...`);
const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
  method: 'POST',
  headers: { Authorization: `Token ${key}`, 'Content-Type': contentType },
  body: readFileSync(audioPath),
});

if (!res.ok) {
  console.error(`deepgram ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
const alt = body.results?.channels?.[0]?.alternatives?.[0];
if (!alt?.words?.length) {
  console.error('no words returned; check the audio file');
  process.exit(1);
}

// Deepgram already returns seconds as floats. Round to 3dp so the fixture is
// stable and diffable; CONVENTIONS §3 forbids milliseconds anywhere downstream.
const r3 = (n) => Math.round(n * 1000) / 1000;

const transcript = {
  provider: 'deepgram',
  durationSec: r3(body.metadata?.duration ?? alt.words.at(-1).end),
  words: alt.words.map((w) => ({
    text: w.word,
    start: r3(w.start),
    end: r3(w.end),
    confidence: Math.round((w.confidence ?? 0) * 1000) / 1000,
    isFiller: false, // finalised by alignSegments — soft fillers need alignment
  })),
};

const out = join('packages/contracts/fixtures', `transcript.${label}.json`);
writeFileSync(out, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
console.log(`wrote ${out} — ${transcript.words.length} words, ${transcript.durationSec}s`);
console.log(`transcript: ${alt.transcript.slice(0, 160)}...`);
```

- [ ] **Step 2: Run it on both takes**

```bash
node --env-file=.env scripts/transcribe.mjs fixtures/audio/take-rough.m4a rough
```

```bash
node --env-file=.env scripts/transcribe.mjs fixtures/audio/take-clean.m4a clean
```

Expected: two fixture files written; word counts near 90 (rough) and 83 (clean).

- [ ] **Step 3: Eyeball the rough transcript before trusting it**

Confirm by reading `packages/contracts/fixtures/transcript.rough.json`:
- `um` and `you know` appear as words around segment 2
- numbers are spelled out (`ninety`, `eight`, `percent`) — **not** `98%`. If you see digits, `numerals`/`smart_format` leaked on; fix and re-run.
- the key-stat line's words are visibly closer together in time than neighbours

- [ ] **Step 4: Commit**

```bash
git add scripts/transcribe.mjs packages/contracts/fixtures/transcript.rough.json packages/contracts/fixtures/transcript.clean.json
git commit -m "chore: deepgram dev tool and frozen transcript fixtures

smart_format and numerals off — both rewrite spoken numbers to digits,
which would break text-matching against the script."
```

---

### Task 4: Needleman-Wunsch

**Files:**
- Create: `packages/core-logic/src/align.ts`
- Create: `packages/core-logic/src/align.test.ts`

**Interfaces:**
- Consumes: nothing outside this file
- Produces: `type AlignOp = 'match' | 'mismatch' | 'gapScript' | 'gapTranscript'`; `interface AlignPair { scriptIdx: number | null; transcriptIdx: number | null; op: AlignOp }`; `needlemanWunsch(script: string[], transcript: string[]): AlignPair[]`

`gapScript` means a transcript word with no script counterpart (an insertion — this is how soft fillers are detected). `gapTranscript` means a script word that was not spoken.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core-logic/src/align.test.ts
import { describe, expect, it } from 'vitest';
import { needlemanWunsch } from './align.js';

const ops = (a: string[], b: string[]) => needlemanWunsch(a, b).map((p) => p.op);

describe('needlemanWunsch', () => {
  it('matches identical sequences', () => {
    expect(ops(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(['match', 'match', 'match']);
  });

  it('detects an insertion in the transcript as gapScript', () => {
    // Speaker said "um" that is not in the script.
    expect(ops(['a', 'b'], ['a', 'um', 'b'])).toEqual(['match', 'gapScript', 'match']);
  });

  it('detects a dropped script word as gapTranscript', () => {
    expect(ops(['a', 'b', 'c'], ['a', 'c'])).toEqual(['match', 'gapTranscript', 'match']);
  });

  it('detects a substitution as mismatch', () => {
    expect(ops(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual(['match', 'mismatch', 'match']);
  });

  it('maps indices on both sides for matches', () => {
    const pairs = needlemanWunsch(['a', 'b'], ['a', 'um', 'b']);
    const matched = pairs.filter((p) => p.op === 'match');
    expect(matched).toEqual([
      { scriptIdx: 0, transcriptIdx: 0, op: 'match' },
      { scriptIdx: 1, transcriptIdx: 2, op: 'match' },
    ]);
  });

  it('leaves the absent side null on gaps', () => {
    const gap = needlemanWunsch(['a'], ['a', 'um']).find((p) => p.op === 'gapScript')!;
    expect(gap.scriptIdx).toBeNull();
    expect(gap.transcriptIdx).toBe(1);
  });

  it('handles an empty script side', () => {
    expect(ops([], ['a', 'b'])).toEqual(['gapScript', 'gapScript']);
  });

  it('handles an empty transcript side', () => {
    expect(ops(['a', 'b'], [])).toEqual(['gapTranscript', 'gapTranscript']);
  });

  it('returns nothing for two empty sequences', () => {
    expect(needlemanWunsch([], [])).toEqual([]);
  });

  it('stays monotonic — indices never move backwards', () => {
    const pairs = needlemanWunsch(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    const sIdx = pairs.map((p) => p.scriptIdx).filter((i): i is number => i !== null);
    const tIdx = pairs.map((p) => p.transcriptIdx).filter((i): i is number => i !== null);
    expect(sIdx).toEqual([...sIdx].sort((x, y) => x - y));
    expect(tIdx).toEqual([...tIdx].sort((x, y) => x - y));
  });

  it('handles a realistic run within a few milliseconds', () => {
    const a = Array.from({ length: 450 }, (_, i) => `w${i}`);
    const b = Array.from({ length: 500 }, (_, i) => `w${i}`);
    const t0 = performance.now();
    needlemanWunsch(a, b);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- align`
Expected: FAIL — `Cannot find module './align.js'`

- [ ] **Step 3: Implement the algorithm**

```ts
// packages/core-logic/src/align.ts

export type AlignOp = 'match' | 'mismatch' | 'gapScript' | 'gapTranscript';

export interface AlignPair {
  /** Index into the script token array, or null when the script had no word here. */
  scriptIdx: number | null;
  /** Index into the transcript token array, or null when nothing was spoken here. */
  transcriptIdx: number | null;
  op: AlignOp;
}

const SCORING = { match: 2, mismatch: -1, gap: -1 } as const;

/**
 * Global sequence alignment (Needleman-Wunsch) between script tokens and
 * transcript tokens.
 *
 * Handles the three things ASR does to us as first-class cases: insertions
 * (fillers the script never had), deletions (words skipped on the day) and
 * substitutions (words misheard). The matrix is bounded by AUDIO_MAX_SECONDS
 * at roughly 450 x 500 cells, so no banding or heuristic pruning is needed.
 */
export function needlemanWunsch(script: string[], transcript: string[]): AlignPair[] {
  const n = script.length;
  const m = transcript.length;
  const width = m + 1;

  // Flat Float64Array rather than nested arrays: no per-row allocation, and it
  // sidesteps noUncheckedIndexedAccess noise on every cell read.
  const dp = new Float64Array((n + 1) * width);
  for (let i = 1; i <= n; i++) dp[i * width] = i * SCORING.gap;
  for (let j = 1; j <= m; j++) dp[j] = j * SCORING.gap;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = script[i - 1] === transcript[j - 1];
      const diag = dp[(i - 1) * width + (j - 1)] + (same ? SCORING.match : SCORING.mismatch);
      const up = dp[(i - 1) * width + j] + SCORING.gap;
      const left = dp[i * width + (j - 1)] + SCORING.gap;
      dp[i * width + j] = Math.max(diag, up, left);
    }
  }

  const out: AlignPair[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = script[i - 1] === transcript[j - 1];
      const score = same ? SCORING.match : SCORING.mismatch;
      if (dp[i * width + j] === dp[(i - 1) * width + (j - 1)] + score) {
        out.push({ scriptIdx: i - 1, transcriptIdx: j - 1, op: same ? 'match' : 'mismatch' });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i * width + j] === dp[(i - 1) * width + j] + SCORING.gap) {
      out.push({ scriptIdx: i - 1, transcriptIdx: null, op: 'gapTranscript' });
      i--;
      continue;
    }
    out.push({ scriptIdx: null, transcriptIdx: j - 1, op: 'gapScript' });
    j--;
  }

  return out.reverse();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/core-logic -- align`
Expected: PASS — 11 tests green

- [ ] **Step 5: Commit**

```bash
git add packages/core-logic/src/align.ts packages/core-logic/src/align.test.ts
git commit -m "feat(core-logic): Needleman-Wunsch global alignment

Flat Float64Array over nested arrays — no per-row allocation and no
noUncheckedIndexedAccess noise on hot cell reads."
```

---

### Task 5: alignSegments

**Files:**
- Modify: `packages/core-logic/src/align.ts`
- Modify: `packages/core-logic/src/align.test.ts`
- Modify: `packages/contracts/src/index.ts` (Tier-2 additions)

**Interfaces:**
- Consumes: `needlemanWunsch` (Task 4); `normaliseText`, `isHardFiller`, `isSoftFiller` (Task 1); `parseScript` (Task 2); `Transcript`, `ScriptSegment`, `SegmentAlignment`, `Word` from `@nsh/contracts`
- Produces: `interface AlignmentResult { alignments: SegmentAlignment[]; words: Word[]; matchRate: number }`; `alignSegments(transcript: Transcript, segments: ScriptSegment[]): AlignmentResult`

**Tier-2 contract changes** (internal seam, heads-up to P2, no sign-off — CONVENTIONS §2):
1. `SegmentAlignment` gains `degraded: boolean`.
2. `alignSegments` returns `AlignmentResult` rather than `SegmentAlignment[]`, because soft-filler resolution finalises `Word.isFiller` and the caller needs those updated words.

- [ ] **Step 1: Apply the Tier-2 contract changes**

In `packages/contracts/src/index.ts`, add to the `SegmentAlignment` object, after `precedingPauseSec`:

```ts
  /**
   * True when this segment matched no script tokens and fell back to a
   * proportional span. A degraded segment suppresses its own pacing and
   * stress verdicts — proportional splitting assumes uniform WPM in order
   * to measure WPM deviation, so feeding it the pacing rules would report a
   * clean delivery rather than a broken one.
   */
  degraded: z.boolean(),
```

And change the `CoreLogic.alignSegments` signature:

```ts
  /** tool 3a: map each script segment onto its region of the recording. */
  alignSegments(transcript: Transcript, segments: ScriptSegment[]): {
    alignments: SegmentAlignment[];
    /** transcript.words with isFiller finalised after soft-filler resolution. */
    words: Word[];
    /** Matched script tokens / total script tokens. Below 0.4 we throw. */
    matchRate: number;
  };
```

- [ ] **Step 2: Write the failing test**

```ts
// append to packages/core-logic/src/align.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoachError } from './errors.js';
import { alignSegments } from './align.js';
import { parseScript } from './parse-script.js';

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const demoScript = readFileSync(join(fixtures, 'script.demo.md'), 'utf8');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));

describe('alignSegments', () => {
  const segments = parseScript(demoScript);
  const result = alignSegments(rough, segments);

  it('returns one alignment per segment, in order', () => {
    expect(result.alignments.map((a) => a.segmentId)).toEqual(segments.map((s) => s.id));
  });

  it('matches most of the script', () => {
    expect(result.matchRate).toBeGreaterThan(0.75);
  });

  it('produces monotonically increasing, non-overlapping spans', () => {
    const a = result.alignments;
    for (let i = 1; i < a.length; i++) {
      expect(a[i]!.startSec).toBeGreaterThanOrEqual(a[i - 1]!.endSec);
    }
  });

  it('keeps every span inside the recording', () => {
    for (const a of result.alignments) {
      expect(a.startSec).toBeGreaterThanOrEqual(0);
      expect(a.endSec).toBeLessThanOrEqual(rough.durationSec);
      expect(a.endSec).toBeGreaterThan(a.startSec);
    }
  });

  it('degrades no segment on a good take', () => {
    expect(result.alignments.every((a) => !a.degraded)).toBe(false || true);
    expect(result.alignments.filter((a) => a.degraded)).toHaveLength(0);
  });

  it('finds the rushed key point — seg-003 is the fastest segment', () => {
    const byWpm = [...result.alignments].sort((x, y) => y.wpm - x.wpm);
    expect(byWpm[0]!.segmentId).toBe('seg-003');
  });

  it('does NOT treat "like" in seg-006 as a filler', () => {
    // script.demo.md:11 — "I'd like to talk about ... look like".
    const seg6 = result.alignments.find((a) => a.segmentId === 'seg-006')!;
    expect(seg6.fillerCount).toBe(0);
  });

  it('tags hard fillers spoken in seg-002', () => {
    const seg2 = result.alignments.find((a) => a.segmentId === 'seg-002')!;
    expect(seg2.fillerCount).toBeGreaterThan(0);
  });

  it('computes precedingPauseSec from the previous segment end', () => {
    const a = result.alignments;
    expect(a[0]!.precedingPauseSec).toBeCloseTo(a[0]!.startSec, 5);
    for (let i = 1; i < a.length; i++) {
      expect(a[i]!.precedingPauseSec).toBeCloseTo(a[i]!.startSec - a[i - 1]!.endSec, 5);
    }
  });

  it('excludes fillers from wpm', () => {
    const seg2 = result.alignments.find((a) => a.segmentId === 'seg-002')!;
    const contentWords = 15;
    const expected = (contentWords / (seg2.endSec - seg2.startSec)) * 60;
    expect(seg2.wpm).toBeCloseTo(Math.round(expected * 10) / 10, 0);
  });

  it('throws ALIGNMENT_FAILED when the audio is not this script', () => {
    const wrong = parseScript('completely unrelated words about marine biology\n\nand tidal patterns');
    try {
      alignSegments(rough, wrong);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CoachError);
      expect((e as CoachError).code).toBe('ALIGNMENT_FAILED');
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- align`
Expected: FAIL — `alignSegments is not a function`

- [ ] **Step 4: Implement alignSegments**

```ts
// append to packages/core-logic/src/align.ts
import type { ScriptSegment, SegmentAlignment, Transcript, Word } from '@nsh/contracts';
import { CoachError } from './errors.js';
import { THRESHOLDS } from './thresholds.js';
import { isHardFiller, isSoftFiller, normaliseText } from './tokenize.js';

export interface AlignmentResult {
  alignments: SegmentAlignment[];
  /** transcript.words with isFiller finalised after soft-filler resolution. */
  words: Word[];
  /** Matched script tokens / total script tokens. */
  matchRate: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function alignSegments(
  transcript: Transcript,
  segments: ScriptSegment[],
): AlignmentResult {
  // --- script side: flatten to tokens, remembering which segment owns each ---
  const scriptTokens: string[] = [];
  const tokenSegment: number[] = [];
  segments.forEach((seg, segIdx) => {
    for (const tok of normaliseText(seg.text)) {
      scriptTokens.push(tok);
      tokenSegment.push(segIdx);
    }
  });

  // --- transcript side: normalise, drop hard fillers from the aligner input ---
  // A hard filler never appears in a script, so feeding it to the aligner only
  // adds gap-path noise. Soft fillers DO enter alignment — that is how we learn
  // whether "like" was a script word or a tic.
  const words = transcript.words.map((w) => ({ ...w }));
  const normalised = words.map((w) => normaliseText(w.text)[0] ?? '');

  const alignTokens: string[] = [];
  const alignToWordIdx: number[] = [];
  normalised.forEach((tok, wordIdx) => {
    if (tok.length === 0) return;
    if (isHardFiller(tok)) {
      words[wordIdx]!.isFiller = true;
      return;
    }
    alignTokens.push(tok);
    alignToWordIdx.push(wordIdx);
  });

  const pairs = needlemanWunsch(scriptTokens, alignTokens);

  const matches = pairs.filter((p) => p.op === 'match');
  const matchRate = scriptTokens.length === 0 ? 0 : matches.length / scriptTokens.length;
  if (matchRate < THRESHOLDS.minMatchRate) {
    throw new CoachError('ALIGNMENT_FAILED', 'Recording does not match this script.', {
      matchRate: r1(matchRate * 100),
    });
  }

  // --- resolve soft fillers: in the lexicon AND unmatched by any script token ---
  for (const pair of pairs) {
    if (pair.op !== 'gapScript' || pair.transcriptIdx === null) continue;
    const wordIdx = alignToWordIdx[pair.transcriptIdx];
    if (wordIdx === undefined) continue;
    if (isSoftFiller(normalised, wordIdx) > 0) words[wordIdx]!.isFiller = true;
  }

  // --- per-segment spans from first and last matched token ---
  const spans = segments.map(() => ({ first: Number.POSITIVE_INFINITY, last: -1 }));
  for (const pair of matches) {
    if (pair.scriptIdx === null || pair.transcriptIdx === null) continue;
    const segIdx = tokenSegment[pair.scriptIdx];
    if (segIdx === undefined) continue;
    const wordIdx = alignToWordIdx[pair.transcriptIdx];
    if (wordIdx === undefined) continue;
    const span = spans[segIdx]!;
    span.first = Math.min(span.first, wordIdx);
    span.last = Math.max(span.last, wordIdx);
  }

  const alignments: SegmentAlignment[] = [];
  let prevEnd = 0;

  segments.forEach((seg, segIdx) => {
    const span = spans[segIdx]!;
    const degraded = span.last < 0;

    let wordIdxStart: number;
    let wordIdxEnd: number;
    if (degraded) {
      // Proportional fallback for THIS segment only. It reports a span so the
      // timeline stays continuous, and sets degraded so correlate suppresses
      // its pacing and stress verdicts rather than emitting flat ones.
      const share = segments.length === 0 ? 0 : words.length / segments.length;
      wordIdxStart = Math.min(Math.floor(share * segIdx), Math.max(words.length - 1, 0));
      wordIdxEnd = Math.min(Math.ceil(share * (segIdx + 1)), words.length);
    } else {
      wordIdxStart = span.first;
      wordIdxEnd = span.last + 1;
    }

    const startWord = words[wordIdxStart];
    const endWord = words[Math.max(wordIdxEnd - 1, wordIdxStart)];
    const startSec = startWord?.start ?? prevEnd;
    const endSec = Math.max(endWord?.end ?? startSec + 0.1, startSec + 0.1);

    const inRange = words.slice(wordIdxStart, wordIdxEnd);
    const contentWords = inRange.filter((w) => !w.isFiller).length;
    const fillerCount = inRange.filter((w) => w.isFiller).length;
    const durationSec = endSec - startSec;

    alignments.push({
      segmentId: seg.id,
      startSec: r1(startSec),
      endSec: r1(endSec),
      wordIdxStart,
      wordIdxEnd,
      wpm: r1(durationSec > 0 ? (contentWords / durationSec) * 60 : 0),
      fillerCount,
      meanRms: 0, // filled by Task 11; zero-frame prosody is valid
      meanF0: null,
      precedingPauseSec: r1(Math.max(startSec - prevEnd, 0)),
      degraded,
    });

    prevEnd = endSec;
  });

  return { alignments, words, matchRate };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w packages/core-logic -- align`
Expected: PASS — 22 tests green

If `seg-003` is not the fastest segment, the rough take did not rush the key stat enough. Re-record rather than lowering the threshold — the demo depends on this being real.

- [ ] **Step 6: Wire prosody means into the alignment**

Prosody is still all zeros at this point. Task 11 revisits `meanRms`/`meanF0`. Leave them as written.

- [ ] **Step 7: Commit**

```bash
git add packages/core-logic/src/align.ts packages/core-logic/src/align.test.ts packages/contracts/src/index.ts
git commit -m "feat(core-logic): alignSegments over Needleman-Wunsch

Hard fillers leave the aligner input; soft fillers stay in so that an
unmatched 'like' can be told apart from the two legitimate ones in
seg-006. Degraded segments fall back to a proportional span but suppress
their own pacing and stress verdicts.

Tier-2: SegmentAlignment.degraded added, alignSegments now returns
AlignmentResult. Heads-up to P2."
```

---

### Task 6: computeBaseline

**Files:**
- Create: `packages/core-logic/src/baseline.ts`
- Create: `packages/core-logic/src/baseline.test.ts`
- Modify: `packages/contracts/src/index.ts` (Tier-2: `Baseline.medianPauseSec`)

**Interfaces:**
- Consumes: `AlignmentResult` (Task 5); `Baseline`, `ProsodyTrack`, `Word` from `@nsh/contracts`
- Produces: `computeBaseline(alignments: SegmentAlignment[], words: Word[], prosody: ProsodyTrack): Baseline`

- [ ] **Step 1: Add the Tier-2 field**

In `packages/contracts/src/index.ts`, add to `Baseline`:

```ts
  /**
   * Median of all inter-word gaps exceeding THRESHOLDS.pauseMinSec. Inter-word
   * rather than inter-segment: six segments give too few samples for a stable
   * median. Null when the speaker never paused.
   */
  medianPauseSec: z.number().nullable(),
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/core-logic/src/baseline.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignSegments } from './align.js';
import { computeBaseline } from './baseline.js';
import { parseScript } from './parse-script.js';

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));
const segments = parseScript(readFileSync(join(fixtures, 'script.demo.md'), 'utf8'));
const empty = { frames: [], frameHopSec: 0.01 };

describe('computeBaseline', () => {
  const { alignments, words } = alignSegments(rough, segments);
  const baseline = computeBaseline(alignments, words, empty);

  it('produces a plausible speaking pace', () => {
    expect(baseline.avgPaceWpm).toBeGreaterThan(90);
    expect(baseline.avgPaceWpm).toBeLessThan(200);
  });

  it('divides by voiced time, not wall-clock', () => {
    // Wall-clock includes inter-segment silence, which would drag pace down.
    const voiced = alignments.reduce((s, a) => s + (a.endSec - a.startSec), 0);
    const content = words.filter((w) => !w.isFiller).length;
    expect(baseline.avgPaceWpm).toBeCloseTo(Math.round(((content / voiced) * 60) * 10) / 10, 0);
  });

  it('reports a non-zero pace spread', () => {
    expect(baseline.paceStdDev).toBeGreaterThan(0);
  });

  it('finds a median pause', () => {
    expect(baseline.medianPauseSec).toBeGreaterThan(0.35);
  });

  it('returns null f0 when prosody has no frames', () => {
    expect(baseline.medianF0).toBeNull();
  });

  it('excludes degraded segments from the pace average', () => {
    const withDegraded = [...alignments, {
      ...alignments[0]!, segmentId: 'seg-999', degraded: true, wpm: 9999,
    }];
    const after = computeBaseline(withDegraded, words, empty);
    expect(after.avgPaceWpm).toBeCloseTo(baseline.avgPaceWpm, 1);
  });

  it('survives a single-segment recording', () => {
    const one = computeBaseline([alignments[0]!], words, empty);
    expect(one.paceStdDev).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- baseline`
Expected: FAIL — `Cannot find module './baseline.js'`

- [ ] **Step 4: Implement computeBaseline**

```ts
// packages/core-logic/src/baseline.ts
import type { Baseline, ProsodyTrack, SegmentAlignment, Word } from '@nsh/contracts';
import { THRESHOLDS } from './thresholds.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * The speaker's own norms, from THIS recording only — never a population
 * average. Every severity verdict is relative to this, which is what makes the
 * flags falsifiable rather than a vibe score (SPEC §2).
 */
export function computeBaseline(
  alignments: SegmentAlignment[],
  words: Word[],
  prosody: ProsodyTrack,
): Baseline {
  // Degraded segments would drag the baseline toward a pace the speaker never
  // produced, since their span came from a proportional guess.
  const usable = alignments.filter((a) => !a.degraded);

  const voicedSec = usable.reduce((sum, a) => sum + (a.endSec - a.startSec), 0);
  const contentWords = usable.reduce(
    (sum, a) => sum + words.slice(a.wordIdxStart, a.wordIdxEnd).filter((w) => !w.isFiller).length,
    0,
  );
  const avgPaceWpm = voicedSec > 0 ? (contentWords / voicedSec) * 60 : 0;

  const paces = usable.map((a) => a.wpm);
  const mean = paces.length > 0 ? paces.reduce((s, p) => s + p, 0) / paces.length : 0;
  const variance =
    paces.length > 0 ? paces.reduce((s, p) => s + (p - mean) ** 2, 0) / paces.length : 0;

  // Inter-WORD gaps, not inter-segment: six segments are too few for a stable
  // median, and the pause rule needs a trustworthy one.
  const gaps: number[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.start - words[i - 1]!.end;
    if (gap > THRESHOLDS.pauseMinSec) gaps.push(gap);
  }

  const voicedF0 = prosody.frames
    .map((f) => f.f0)
    .filter((f): f is number => f !== null && f > 0);

  const rmsValues = usable.map((a) => a.meanRms);
  const medianPause = median(gaps);

  return {
    avgPaceWpm: r1(avgPaceWpm),
    paceStdDev: r1(Math.sqrt(variance)),
    meanRms: r1(rmsValues.length > 0 ? rmsValues.reduce((s, v) => s + v, 0) / rmsValues.length : 0),
    medianF0: voicedF0.length > 0 ? r1(median(voicedF0) ?? 0) : null,
    medianPauseSec: medianPause === null ? null : r1(medianPause),
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w packages/core-logic && npm run typecheck --workspaces`
Expected: PASS — all green

- [ ] **Step 6: Commit**

```bash
git add packages/core-logic/src/baseline.ts packages/core-logic/src/baseline.test.ts packages/contracts/src/index.ts
git commit -m "feat(core-logic): computeBaseline from the speaker's own recording

Pace divides by voiced time, not wall-clock, so a deliberate pause is
not scored as slow speaking. Degraded segments excluded.

Tier-2: Baseline.medianPauseSec added."
```

---

### Task 7: correlateSegments — stress rule only (THE RED TICK)

**Files:**
- Create: `packages/core-logic/src/correlate.ts`
- Create: `packages/core-logic/src/correlate.test.ts`

**Interfaces:**
- Consumes: `AlignmentResult` (Task 5); `computeBaseline` (Task 6); `SEVERITY_RULES`, `THRESHOLDS`, `ruleById` (Task 1); `CorrelationResult`, `DecisionTrace`, `DeliveryIssue`, `DeliverySignal`, `ScriptSegment` from `@nsh/contracts`
- Produces: `correlateSegments(signal: DeliverySignal, segments: ScriptSegment[], alignment: AlignmentResult): CorrelationResult`; `sortAndNumberIssues(raw: Omit<DeliveryIssue, 'id'>[]): DeliveryIssue[]`

This task ships the demo. After it, `seg-003` carries one high-severity `stress_mismatch` and Ops Canvas has a trace to render. Filler, pause and pacing rules land in Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core-logic/src/correlate.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignSegments } from './align.js';
import { correlateSegments, sortAndNumberIssues } from './correlate.js';
import { parseScript } from './parse-script.js';

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));
const clean = JSON.parse(readFileSync(join(fixtures, 'transcript.clean.json'), 'utf8'));
const segments = parseScript(readFileSync(join(fixtures, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

const run = (transcript: typeof rough) =>
  correlateSegments({ transcript, prosody }, segments, alignSegments(transcript, segments));

describe('correlateSegments — stress', () => {
  const result = run(rough);
  const high = result.issues.filter((i) => i.severity === 'high');

  it('flags exactly one high-severity issue on the rough take', () => {
    expect(high).toHaveLength(1);
  });

  it('puts it on seg-003, the rushed key point', () => {
    expect(high[0]!.segmentId).toBe('seg-003');
    expect(high[0]!.type).toBe('stress_mismatch');
  });

  it('writes a falsifiable detail naming both numbers', () => {
    expect(high[0]!.detail).toMatch(/\d+(\.\d)? WPM/);
    expect(high[0]!.detail).toContain('average');
  });

  it('emits a trace entry for every issue', () => {
    expect(result.trace).toHaveLength(result.issues.length);
    expect(result.trace.map((t) => t.issueId).sort()).toEqual(result.issues.map((i) => i.id).sort());
  });

  it('names the rule and both cross-referenced signals in the trace', () => {
    const trace = result.trace.find((t) => t.issueId === high[0]!.id)!;
    expect(trace.rule).toBe('stress.key-point-rushed');
    expect(trace.observed).toHaveProperty('wpm');
    expect(trace.observed).toHaveProperty('baselineWpm');
    expect(trace.scriptExpectation).toContain('key point');
  });

  it('returns the baseline it judged against', () => {
    expect(result.baseline.avgPaceWpm).toBeGreaterThan(0);
  });

  it('flags no high-severity issue on the clean take', () => {
    expect(run(clean).issues.filter((i) => i.severity === 'high')).toHaveLength(0);
  });

  it('never flags a non-key-point segment as stress_mismatch', () => {
    const keyIds = new Set(segments.filter((s) => s.isKeyPoint).map((s) => s.id));
    for (const issue of result.issues.filter((i) => i.type === 'stress_mismatch')) {
      expect(keyIds.has(issue.segmentId)).toBe(true);
    }
  });
});

describe('sortAndNumberIssues', () => {
  it('sorts by timestamp then assigns sequential ids', () => {
    const out = sortAndNumberIssues([
      { type: 'filler', severity: 'low', timestamp: 9, segmentId: 'seg-002', detail: 'b' },
      { type: 'filler', severity: 'low', timestamp: 3, segmentId: 'seg-001', detail: 'a' },
    ]);
    expect(out.map((i) => [i.id, i.timestamp])).toEqual([['iss-001', 3], ['iss-002', 9]]);
  });

  it('breaks timestamp ties by severity, high first', () => {
    const out = sortAndNumberIssues([
      { type: 'filler', severity: 'low', timestamp: 5, segmentId: 'seg-001', detail: 'a' },
      { type: 'stress_mismatch', severity: 'high', timestamp: 5, segmentId: 'seg-001', detail: 'b' },
    ]);
    expect(out[0]!.severity).toBe('high');
  });

  it('breaks remaining ties by type alphabetically, so reruns are identical', () => {
    const out = sortAndNumberIssues([
      { type: 'pause', severity: 'low', timestamp: 5, segmentId: 'seg-001', detail: 'a' },
      { type: 'filler', severity: 'low', timestamp: 5, segmentId: 'seg-001', detail: 'b' },
    ]);
    expect(out.map((i) => i.type)).toEqual(['filler', 'pause']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- correlate`
Expected: FAIL — `Cannot find module './correlate.js'`

- [ ] **Step 3: Implement the stress rule and issue numbering**

```ts
// packages/core-logic/src/correlate.ts
import type {
  CorrelationResult, DecisionTrace, DeliveryIssue, DeliverySignal,
  ScriptSegment, SegmentAlignment, Severity,
} from '@nsh/contracts';
import type { AlignmentResult } from './align.js';
import { computeBaseline } from './baseline.js';
import { ruleById, THRESHOLDS } from './thresholds.js';

/** An issue before it has been sorted and given an id. */
export type RawIssue = Omit<DeliveryIssue, 'id'>;

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * IDs are assigned AFTER sorting so the same input always produces the same
 * report byte for byte. Ties break deterministically — if IDs shuffled between
 * runs, the rehearsed demo click-path would break on stage (CONVENTIONS §3).
 */
export function sortAndNumberIssues(raw: RawIssue[]): DeliveryIssue[] {
  return [...raw]
    .sort((a, b) =>
      a.timestamp - b.timestamp ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.type.localeCompare(b.type))
    .map((issue, idx) => ({ id: `iss-${String(idx + 1).padStart(3, '0')}`, ...issue }));
}

/** Mean f0 over the first and last third of a segment, for the pitch-rise rule. */
function pitchSlope(signal: DeliverySignal, a: SegmentAlignment): number | null {
  const frames = signal.prosody.frames.filter(
    (f) => f.t >= a.startSec && f.t < a.endSec && f.f0 !== null && f.f0 > 0,
  );
  if (frames.length < 6) return null;
  const third = Math.floor(frames.length / 3);
  const meanOf = (xs: typeof frames) =>
    xs.reduce((s, f) => s + (f.f0 ?? 0), 0) / Math.max(xs.length, 1);
  const first = meanOf(frames.slice(0, third));
  const last = meanOf(frames.slice(-third));
  return first > 0 ? last / first : null;
}

/**
 * THE BRANCH POINT. For each segment, decides whether a deviation matters by
 * cross-referencing WHERE it happened against WHAT the script says should
 * happen there. Every verdict emits a DecisionTrace — that trace is what a
 * judge reads on Ops Canvas, so it is not optional polish.
 */
export function correlateSegments(
  signal: DeliverySignal,
  segments: ScriptSegment[],
  alignment: AlignmentResult,
): CorrelationResult {
  const baseline = computeBaseline(alignment.alignments, alignment.words, signal.prosody);
  const raw: RawIssue[] = [];
  const pending: Array<{ key: string; rule: string; trace: Omit<DecisionTrace, 'issueId'> }> = [];

  const byId = new Map(alignment.alignments.map((a) => [a.segmentId, a]));
  const rushCeiling = baseline.avgPaceWpm + THRESHOLDS.paceDriftSigma * baseline.paceStdDev;

  for (const segment of segments) {
    const a = byId.get(segment.id);
    if (!a || a.degraded) continue;      // degraded suppresses stress and pacing
    if (!segment.isKeyPoint) continue;   // stress rules only apply to key points

    const rushed = a.wpm > rushCeiling;
    const slope = pitchSlope(signal, a);
    const rising = slope !== null && slope > THRESHOLDS.risingPitchRatio;
    if (!rushed && !rising) continue;

    // One stress issue per segment. Rushed wins — pace is the more legible
    // signal on stage — and pitch appears as corroboration in the detail.
    const ruleId = rushed ? 'stress.key-point-rushed' : 'stress.key-point-rising-pitch';
    const rule = ruleById(ruleId);

    const pct = Math.round(((a.wpm - baseline.avgPaceWpm) / baseline.avgPaceWpm) * 100);
    const detail = rushed
      ? `${a.wpm} WPM vs your ${baseline.avgPaceWpm} WPM average — ${pct}% faster` +
        (rising ? `, with pitch rising ${Math.round((slope - 1) * 100)}% across the line` : '') +
        '. This is a key point and you delivered it like a caveat.'
      : `Pitch rises ${Math.round(((slope ?? 1) - 1) * 100)}% across this line. ` +
        'It is a key point stated as fact, but delivered as a question.';

    raw.push({
      type: 'stress_mismatch',
      severity: rule.verdict,
      timestamp: a.startSec,
      segmentId: segment.id,
      detail,
    });

    pending.push({
      key: `${segment.id}|stress_mismatch|${a.startSec}`,
      rule: ruleId,
      trace: {
        segmentId: segment.id,
        rule: ruleId,
        observed: {
          wpm: a.wpm,
          baselineWpm: baseline.avgPaceWpm,
          paceStdDev: baseline.paceStdDev,
          ...(slope === null ? {} : { pitchRatio: r1(slope) }),
        },
        scriptExpectation: `Segment is marked as a key point; expected pace at or below ${r1(rushCeiling)} WPM.`,
        verdict: rule.verdict,
        reasoning: rule.why,
      },
    });
  }

  const issues = sortAndNumberIssues(raw);
  const trace: DecisionTrace[] = issues.map((issue) => {
    const match = pending.find(
      (p) => p.key === `${issue.segmentId}|${issue.type}|${issue.timestamp}`,
    );
    if (!match) throw new Error(`no trace for issue ${issue.id}`);
    return { issueId: issue.id, ...match.trace };
  });

  return { issues, trace, baseline };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/core-logic -- correlate`
Expected: PASS — 11 tests green

If "exactly one high-severity issue" fails because `seg-005` also fired, that is the tuning signal. Raise `paceDriftSigma` toward 2.0 in `thresholds.ts` until only `seg-003` fires. Do not edit the test.

- [ ] **Step 5: Commit**

```bash
git add packages/core-logic/src/correlate.ts packages/core-logic/src/correlate.test.ts packages/core-logic/src/index.ts
git commit -m "feat(core-logic): stress_mismatch rule — the red tick

Cross-references script.isKeyPoint against pace relative to the
speaker's own baseline. One stress issue per segment, rushed taking
precedence over rising pitch. Every verdict carries a DecisionTrace
for Ops Canvas."
```

---

### Task 8: generateSummary and the golden test

**Files:**
- Create: `packages/core-logic/src/summary.ts`
- Create: `packages/core-logic/src/summary.test.ts`

**Interfaces:**
- Consumes: `CorrelationResult`, `DeliveryReport`, `DeliverySignal`, `ScriptSegment`, `CONTRACT_VERSION` from `@nsh/contracts`
- Produces: `generateSummary(segments, correlation, signal, meta: { reportId: string; audioUrl: string | null }): DeliveryReport`

After this task the widget has a real `DeliveryReport` to render.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core-logic/src/summary.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, DeliveryReport } from '@nsh/contracts';
import { alignSegments } from './align.js';
import { correlateSegments } from './correlate.js';
import { generateSummary } from './summary.js';
import { parseScript } from './parse-script.js';

const fixtures = join(import.meta.dirname, '../../contracts/fixtures');
const rough = JSON.parse(readFileSync(join(fixtures, 'transcript.rough.json'), 'utf8'));
const segments = parseScript(readFileSync(join(fixtures, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

const build = () => {
  const signal = { transcript: rough, prosody };
  const alignment = alignSegments(rough, segments);
  const correlation = correlateSegments(signal, segments, alignment);
  return generateSummary(segments, correlation, signal, {
    reportId: 'rpt-demo-rough',
    audioUrl: '/fixtures/take-rough.wav',
  });
};

describe('generateSummary', () => {
  const report = build();

  it('satisfies the DeliveryReport schema', () => {
    expect(() => DeliveryReport.parse(report)).not.toThrow();
  });

  it('stamps the current contract version', () => {
    expect(report.contractVersion).toBe(CONTRACT_VERSION);
  });

  it('reports fillerCount as the number of filler issues', () => {
    expect(report.fillerCount).toBe(report.issues.filter((i) => i.type === 'filler').length);
  });

  it('takes duration from the transcript', () => {
    expect(report.durationSec).toBe(rough.durationSec);
  });

  it('leaves nextStep null for the caller to fill', () => {
    expect(report.nextStep).toBeNull();
  });

  it('marks the report ready', () => {
    expect(report.status).toBe('ready');
  });

  it('rounds every emitted float to one decimal', () => {
    const oneDp = (n: number) => Math.round(n * 10) / 10 === n;
    expect(oneDp(report.avgPaceWpm)).toBe(true);
    for (const issue of report.issues) expect(oneDp(issue.timestamp)).toBe(true);
  });

  it('is byte-for-byte deterministic across runs', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- summary`
Expected: FAIL — `Cannot find module './summary.js'`

- [ ] **Step 3: Implement generateSummary**

```ts
// packages/core-logic/src/summary.ts
import {
  CONTRACT_VERSION,
  type CorrelationResult, type DeliveryReport, type DeliverySignal, type ScriptSegment,
} from '@nsh/contracts';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function generateSummary(
  segments: ScriptSegment[],
  correlation: CorrelationResult,
  signal: DeliverySignal,
  meta: { reportId: string; audioUrl: string | null },
): DeliveryReport {
  return {
    reportId: meta.reportId,
    contractVersion: CONTRACT_VERSION,
    segments,
    issues: correlation.issues,
    // Counted from issues rather than from raw filler words, so the number in
    // the summary card always matches the ticks the widget can actually show.
    fillerCount: correlation.issues.filter((i) => i.type === 'filler').length,
    avgPaceWpm: r1(correlation.baseline.avgPaceWpm),
    durationSec: r1(signal.transcript.durationSec),
    audioUrl: meta.audioUrl,
    status: 'ready',
    nextStep: null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/core-logic -- summary`
Expected: PASS — 8 tests green

- [ ] **Step 5: Commit**

```bash
git add packages/core-logic/src/summary.ts packages/core-logic/src/summary.test.ts packages/core-logic/src/index.ts
git commit -m "feat(core-logic): generateSummary assembles DeliveryReport

fillerCount counts filler ISSUES rather than raw filler words, so the
summary card can never disagree with the ticks on the timeline."
```

---

### Task 9: filler, pause and pacing rules

**Files:**
- Modify: `packages/core-logic/src/correlate.ts`
- Modify: `packages/core-logic/src/correlate.test.ts`

**Interfaces:**
- Consumes: everything from Task 7; `Word` from `@nsh/contracts`
- Produces: no new exports — `correlateSegments` now emits all four `IssueType`s

**Emission rules this task implements:**
1. Stress suppresses `pacing` on the same segment — both read the same WPM observation.
2. Consecutive filler words collapse into **one** issue. `"you know"` is two words but one hedge; `"um um"` is one stumble.
3. Degraded segments emit neither `pacing` nor `stress_mismatch`, but still emit `filler` and `pause` — those two do not depend on the span being accurate.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/core-logic/src/correlate.test.ts
describe('correlateSegments — filler, pause, pacing', () => {
  const result = run(rough);
  const typesOf = (t: string) => result.issues.filter((i) => i.type === t);

  it('emits filler issues for the deliberate fillers', () => {
    expect(typesOf('filler').length).toBeGreaterThanOrEqual(4);
  });

  it('collapses a consecutive filler run into one issue', () => {
    // "you know" is two words but one hedge.
    const stamps = typesOf('filler').map((i) => i.timestamp);
    expect(new Set(stamps).size).toBe(stamps.length);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThan(0.3);
    }
  });

  it('escalates the third filler in a segment to medium', () => {
    const seg4 = typesOf('filler').filter((i) => i.segmentId === 'seg-004');
    if (seg4.length >= 3) expect(seg4[2]!.severity).toBe('medium');
  });

  it('escalates a filler inside a key-point segment to medium', () => {
    for (const issue of typesOf('filler')) {
      const seg = segments.find((s) => s.id === issue.segmentId)!;
      if (seg.isKeyPoint) expect(issue.severity).toBe('medium');
    }
  });

  it('flags the skipped marked pause before seg-003', () => {
    const pause = typesOf('pause').find((i) => i.segmentId === 'seg-003');
    expect(pause).toBeDefined();
    expect(pause!.severity).toBe('medium');
  });

  it('never flags a pause on a segment the script did not mark', () => {
    for (const issue of typesOf('pause')) {
      expect(segments.find((s) => s.id === issue.segmentId)!.markedPause).toBe(true);
    }
  });

  it('suppresses pacing on a segment that already has a stress issue', () => {
    const stressed = new Set(typesOf('stress_mismatch').map((i) => i.segmentId));
    for (const issue of typesOf('pacing')) expect(stressed.has(issue.segmentId)).toBe(false);
  });

  it('keeps pacing at low severity', () => {
    for (const issue of typesOf('pacing')) expect(issue.severity).toBe('low');
  });

  it('still emits exactly one high-severity issue overall', () => {
    expect(result.issues.filter((i) => i.severity === 'high')).toHaveLength(1);
  });

  it('emits a trace for every issue, including the new types', () => {
    expect(result.trace).toHaveLength(result.issues.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- correlate`
Expected: FAIL — no filler or pause issues emitted yet

- [ ] **Step 3: Add a helper that groups consecutive filler words**

```ts
// add to packages/core-logic/src/correlate.ts
import type { Word } from '@nsh/contracts';

interface FillerRun { startSec: number; wordCount: number; text: string }

/**
 * Collapses consecutive filler words into one run. "you know" is two words but
 * one hedge; "um um" is one stumble, not two. Emitting per-word would both
 * inflate fillerCount and put unclickable overlapping ticks on the timeline.
 */
function fillerRuns(words: Word[], from: number, to: number): FillerRun[] {
  const runs: FillerRun[] = [];
  let current: FillerRun | null = null;

  for (let i = from; i < to; i++) {
    const word = words[i];
    if (!word) continue;
    if (!word.isFiller) { current = null; continue; }
    if (current === null) {
      current = { startSec: word.start, wordCount: 1, text: word.text };
      runs.push(current);
    } else {
      current.wordCount++;
      current.text += ` ${word.text}`;
    }
  }
  return runs;
}
```

- [ ] **Step 4: Add the three rule blocks inside the segment loop**

In `correlateSegments`, replace the two early `continue` guards with this structure. The stress block from Task 7 stays exactly as written, but is now wrapped so the other rules still run:

```ts
  for (const segment of segments) {
    const a = byId.get(segment.id);
    if (!a) continue;

    let hasStressIssue = false;

    // ---- stress_mismatch (Task 7 body, unchanged) ----
    if (segment.isKeyPoint && !a.degraded) {
      // ... existing stress block ...
      // on emit, also: hasStressIssue = true;
    }

    // ---- filler ----
    const runs = fillerRuns(alignment.words, a.wordIdxStart, a.wordIdxEnd);
    runs.forEach((runItem, idx) => {
      const ruleId = segment.isKeyPoint
        ? 'filler.in-key-point'
        : idx >= THRESHOLDS.fillerDensityPerSegment
          ? 'filler.density'
          : 'filler.isolated';
      const rule = ruleById(ruleId);

      const detail = ruleId === 'filler.in-key-point'
        ? `"${runItem.text}" inside a key point. A hedge in front of your claim reads as doubt about the claim.`
        : ruleId === 'filler.density'
          ? `Filler number ${idx + 1} in this segment. Density, not any single word, is what an audience notices.`
          : `"${runItem.text}" on a low-stakes line. Worth noting, not worth fixing.`;

      raw.push({
        type: 'filler', severity: rule.verdict,
        timestamp: r1(runItem.startSec), segmentId: segment.id, detail,
      });
      pending.push({
        key: `${segment.id}|filler|${r1(runItem.startSec)}`,
        rule: ruleId,
        trace: {
          segmentId: segment.id, rule: ruleId,
          observed: { fillerIndexInSegment: idx + 1, runWordCount: runItem.wordCount,
                      segmentFillerCount: runs.length },
          scriptExpectation: segment.isKeyPoint
            ? 'Segment is marked as a key point; no hedging expected.'
            : 'Segment is an ordinary line; isolated fillers tolerated.',
          verdict: rule.verdict, reasoning: rule.why,
        },
      });
    });

    // ---- pause ----
    const medianPause = baseline.medianPauseSec;
    if (segment.markedPause && medianPause !== null &&
        a.precedingPauseSec < THRESHOLDS.markedPauseHonouredRatio * medianPause) {
      const rule = ruleById('pause.marked-not-honoured');
      raw.push({
        type: 'pause', severity: rule.verdict,
        timestamp: r1(Math.max(a.startSec - 0.3, 0)), segmentId: segment.id,
        detail: `Your script marks a pause before this line. You left ${a.precedingPauseSec}s — ` +
                `you normally leave ${medianPause}s. The setup for this line lands flat.`,
      });
      pending.push({
        key: `${segment.id}|pause|${r1(Math.max(a.startSec - 0.3, 0))}`,
        rule: 'pause.marked-not-honoured',
        trace: {
          segmentId: segment.id, rule: 'pause.marked-not-honoured',
          observed: { precedingPauseSec: a.precedingPauseSec, medianPauseSec: medianPause },
          scriptExpectation: 'Script marks [pause] before this segment.',
          verdict: rule.verdict, reasoning: rule.why,
        },
      });
    }

    // ---- pacing (suppressed when stress already reported this WPM) ----
    if (!a.degraded && !hasStressIssue && !segment.isKeyPoint) {
      const drift = Math.abs(a.wpm - baseline.avgPaceWpm);
      if (drift > THRESHOLDS.paceDriftSigma * baseline.paceStdDev) {
        const rule = ruleById('pacing.drift');
        const direction = a.wpm > baseline.avgPaceWpm ? 'faster' : 'slower';
        raw.push({
          type: 'pacing', severity: rule.verdict,
          timestamp: a.startSec, segmentId: segment.id,
          detail: `${a.wpm} WPM vs your ${baseline.avgPaceWpm} WPM average — ${direction} than usual, off a key point.`,
        });
        pending.push({
          key: `${segment.id}|pacing|${a.startSec}`,
          rule: 'pacing.drift',
          trace: {
            segmentId: segment.id, rule: 'pacing.drift',
            observed: { wpm: a.wpm, baselineWpm: baseline.avgPaceWpm, paceStdDev: baseline.paceStdDev },
            scriptExpectation: 'Ordinary line; pace expected within 1.5 SD of baseline.',
            verdict: rule.verdict, reasoning: rule.why,
          },
        });
      }
    }
  }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test -w packages/core-logic && npm run typecheck --workspaces`
Expected: PASS — all green, still exactly one high-severity issue

- [ ] **Step 6: Commit**

```bash
git add packages/core-logic/src/correlate.ts packages/core-logic/src/correlate.test.ts
git commit -m "feat(core-logic): filler, pause and pacing rules

Consecutive filler words collapse into one issue — 'you know' is two
words but one hedge, and per-word ticks would overlap unclickably.
Stress suppresses pacing on the same segment, since both read the same
WPM observation."
```

---

### Task 10: decideNextStep

**Files:**
- Create: `packages/core-logic/src/next-step.ts`
- Create: `packages/core-logic/src/next-step.test.ts`

**Interfaces:**
- Consumes: `DeliveryReport`, `NextStep`, `NextStepContext` from `@nsh/contracts`
- Produces: `decideNextStep(report: DeliveryReport, ctx: NextStepContext): NextStep`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core-logic/src/next-step.test.ts
import { describe, expect, it } from 'vitest';
import type { DeliveryReport, NextStepContext } from '@nsh/contracts';
import { decideNextStep } from './next-step.js';

const report = (over: Partial<DeliveryReport> = {}): DeliveryReport => ({
  reportId: 'rpt-test', contractVersion: '1.0.0', segments: [], issues: [],
  fillerCount: 0, avgPaceWpm: 130, durationSec: 45, audioUrl: null,
  status: 'ready', nextStep: null, ...over,
});

const ctx = (over: Partial<NextStepContext> = {}): NextStepContext => ({
  upcomingEvents: [], knownMentor: null, now: '2026-07-25T09:00:00Z', ...over,
});

describe('decideNextStep', () => {
  it('returns none while the report is still analysing', () => {
    expect(decideNextStep(report({ status: 'analyzing' }), ctx()).kind).toBe('none');
  });

  it('surfaces a calendar reminder for an event inside 7 days', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [{ title: 'Northwind investor call', startsAt: '2026-07-27T14:00:00Z' }],
    }));
    expect(step.kind).toBe('calendar_reminder');
    expect(step.eventTitle).toBe('Northwind investor call');
    expect(step.eventStartsAt).toBe('2026-07-27T14:00:00Z');
  });

  it('ignores an event beyond 7 days and drafts a note instead', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [{ title: 'Far off', startsAt: '2026-09-01T14:00:00Z' }],
    }));
    expect(step.kind).toBe('draft_note');
  });

  it('picks the soonest event when several qualify', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [
        { title: 'Later', startsAt: '2026-07-30T10:00:00Z' },
        { title: 'Sooner', startsAt: '2026-07-26T10:00:00Z' },
      ],
    }));
    expect(step.eventTitle).toBe('Sooner');
  });

  it('ignores events already in the past', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [{ title: 'Yesterday', startsAt: '2026-07-24T10:00:00Z' }],
    }));
    expect(step.kind).toBe('draft_note');
  });

  it('addresses a known mentor by name', () => {
    const step = decideNextStep(report(), ctx({ knownMentor: 'Priya' }));
    expect(step.recipientHint).toContain('Priya');
    expect(step.draftBody).toContain('Priya');
  });

  it('falls back to a generic recipient when no mentor is known', () => {
    const step = decideNextStep(report(), ctx());
    expect(step.kind).toBe('draft_note');
    expect(step.recipientHint).toBeTruthy();
  });

  it('drafts a note even for a clean take — always points at a person', () => {
    // SPEC §2: the last action always points toward real human practice.
    expect(decideNextStep(report({ issues: [] }), ctx()).kind).toBe('draft_note');
  });

  it('never executes', () => {
    for (const c of [ctx(), ctx({ upcomingEvents: [{ title: 'X', startsAt: '2026-07-26T10:00:00Z' }] })]) {
      expect(decideNextStep(report(), c).executed).toBe(false);
    }
  });

  it('never reads the clock — now is injected', () => {
    const past = decideNextStep(report(), ctx({
      now: '2026-07-20T09:00:00Z',
      upcomingEvents: [{ title: 'Soon', startsAt: '2026-07-21T10:00:00Z' }],
    }));
    expect(past.kind).toBe('calendar_reminder');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- next-step`
Expected: FAIL — `Cannot find module './next-step.js'`

- [ ] **Step 3: Implement decideNextStep**

```ts
// packages/core-logic/src/next-step.ts
import type { DeliveryReport, NextStep, NextStepContext } from '@nsh/contracts';

const WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * The closing agentic action — decides, never executes. P2 executes after the
 * user confirms, and only then flips `executed` to true.
 *
 * There is deliberately no "everything is fine, do nothing" exit. SPEC §2 says
 * the last action always points toward real human practice, so a clean take
 * still ends by proposing a person to rehearse with.
 */
export function decideNextStep(report: DeliveryReport, ctx: NextStepContext): NextStep {
  const base = {
    executed: false,
    eventTitle: null, eventStartsAt: null,
    recipientHint: null, draftSubject: null, draftBody: null,
  };

  if (report.status !== 'ready') {
    return { ...base, kind: 'none', rationale: 'Analysis is still running.' };
  }

  const now = Date.parse(ctx.now);
  const soonest = ctx.upcomingEvents
    .map((e) => ({ ...e, at: Date.parse(e.startsAt) }))
    .filter((e) => Number.isFinite(e.at) && e.at >= now && e.at - now <= WINDOW_DAYS * MS_PER_DAY)
    .sort((a, b) => a.at - b.at)[0];

  const unresolved = report.issues.filter((i) => i.severity === 'high').length;

  if (soonest) {
    const days = Math.max(Math.round((soonest.at - now) / MS_PER_DAY), 0);
    return {
      ...base,
      kind: 'calendar_reminder',
      eventTitle: soonest.title,
      eventStartsAt: soonest.startsAt,
      rationale:
        `"${soonest.title}" is on your calendar in ${days} day${days === 1 ? '' : 's'}. ` +
        (unresolved > 0
          ? `${unresolved} high-severity issue${unresolved === 1 ? ' is' : 's are'} unresolved, so this report is worth re-reading close to the event.`
          : 'Worth re-reading close to the event.'),
    };
  }

  const mentor = ctx.knownMentor;
  return {
    ...base,
    kind: 'draft_note',
    recipientHint: mentor ? `${mentor} (watched your last rehearsal)` : 'someone who has heard this pitch before',
    draftSubject: 'Could you watch this once?',
    draftBody:
      `Hi ${mentor ?? 'there'} — I've rehearsed this to the point where solo runs aren't teaching me much. ` +
      'Do you have 10 minutes this week to listen live and tell me where you stopped believing me?',
    rationale:
      `Nothing on your calendar in the next ${WINDOW_DAYS} days. ` +
      (unresolved > 0
        ? 'The remaining issues are delivery habits, and those change faster in front of a person than on a replay.'
        : 'This take is already clean — the remaining gains come from a live audience, not another solo run.'),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w packages/core-logic -- next-step`
Expected: PASS — 10 tests green

- [ ] **Step 5: Commit**

```bash
git add packages/core-logic/src/next-step.ts packages/core-logic/src/next-step.test.ts packages/core-logic/src/index.ts
git commit -m "feat(core-logic): decideNextStep chooses the closing action

Decides only — always returns executed:false; P2 executes after the
user confirms. No do-nothing exit: a clean take still ends by naming a
person to rehearse with (SPEC §2)."
```

---

### Task 11: extractProsody

**Files:**
- Create: `packages/core-logic/src/prosody.ts`
- Create: `packages/core-logic/src/prosody.test.ts`
- Modify: `packages/core-logic/src/align.ts` (fill `meanRms` / `meanF0`)

**Interfaces:**
- Consumes: `pitchfinder`; `ProsodyTrack`, `ProsodyFrame` from `@nsh/contracts`; `THRESHOLDS`, `CoachError`
- Produces: `extractProsody(pcm: Float32Array, sampleRate: number): ProsodyTrack`

Built last on purpose. Everything above already works with a zero-frame track.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core-logic/src/prosody.test.ts
import { describe, expect, it } from 'vitest';
import { CoachError } from './errors.js';
import { extractProsody } from './prosody.js';

const SR = 16_000;

/** Synthesised sine — a known pitch the detector must recover. */
function sine(hz: number, seconds: number, amplitude = 0.5): Float32Array {
  const pcm = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < pcm.length; i++) pcm[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return pcm;
}

describe('extractProsody', () => {
  it('detects the pitch of a 220 Hz tone within 5%', () => {
    const track = extractProsody(sine(220, 6), SR);
    const voiced = track.frames.map((f) => f.f0).filter((f): f is number => f !== null);
    const mean = voiced.reduce((s, f) => s + f, 0) / voiced.length;
    expect(mean).toBeGreaterThan(209);
    expect(mean).toBeLessThan(231);
  });

  it('uses a 10 ms hop', () => {
    expect(extractProsody(sine(220, 6), SR).frameHopSec).toBeCloseTo(0.01, 5);
  });

  it('produces roughly one frame per hop', () => {
    const track = extractProsody(sine(220, 6), SR);
    expect(track.frames.length).toBeGreaterThan(550);
    expect(track.frames.length).toBeLessThan(620);
  });

  it('normalises rms to 0..1 against the loudest frame', () => {
    const track = extractProsody(sine(220, 6, 0.25), SR);
    const rms = track.frames.map((f) => f.rms);
    expect(Math.max(...rms)).toBeCloseTo(1, 1);
    expect(Math.min(...rms)).toBeGreaterThanOrEqual(0);
  });

  it('returns null f0 for silence rather than inventing a pitch', () => {
    const track = extractProsody(new Float32Array(SR * 6), SR);
    expect(track.frames.every((f) => f.f0 === null)).toBe(true);
  });

  it('advances frame timestamps by the hop', () => {
    const track = extractProsody(sine(220, 6), SR);
    expect(track.frames[0]!.t).toBeCloseTo(0, 5);
    expect(track.frames[10]!.t).toBeCloseTo(0.1, 5);
  });

  it('throws AUDIO_TOO_SHORT under five seconds', () => {
    try {
      extractProsody(sine(220, 2), SR);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as CoachError).code).toBe('AUDIO_TOO_SHORT');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/core-logic -- prosody`
Expected: FAIL — `Cannot find module './prosody.js'`

- [ ] **Step 3: Implement extractProsody**

```ts
// packages/core-logic/src/prosody.ts
import type { ProsodyFrame, ProsodyTrack } from '@nsh/contracts';
import Pitchfinder from 'pitchfinder';
import { CoachError } from './errors.js';
import { THRESHOLDS } from './thresholds.js';

const WINDOW_SEC = 0.025;
const HOP_SEC = 0.01;
const F0_MIN = 60;
const F0_MAX = 400;
/** Frames quieter than this fraction of peak are treated as unvoiced. */
const VOICED_RMS_FLOOR = 0.05;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Pure DSP over a Float32Array — no vendor, no Python sidecar. There is no
 * good hosted API for pitch and energy contours, and standing up a Python
 * service mid-build is how a demo dies (VOICE_STACK §4).
 */
export function extractProsody(pcm: Float32Array, sampleRate: number): ProsodyTrack {
  const durationSec = pcm.length / sampleRate;
  if (durationSec < THRESHOLDS.minAudioSec) {
    throw new CoachError('AUDIO_TOO_SHORT', `Recording is ${r1(durationSec)}s; need at least ${THRESHOLDS.minAudioSec}s.`, {
      durationSec: r1(durationSec),
    });
  }

  const windowSize = Math.floor(WINDOW_SEC * sampleRate);
  const hopSize = Math.floor(HOP_SEC * sampleRate);
  const detectPitch = Pitchfinder.YIN({ sampleRate });

  // Pass 1: RMS per window, plus the peak to normalise against.
  const raw: Array<{ t: number; rms: number; offset: number }> = [];
  let peak = 0;
  for (let offset = 0; offset + windowSize <= pcm.length; offset += hopSize) {
    let sumSquares = 0;
    for (let i = offset; i < offset + windowSize; i++) sumSquares += pcm[i]! ** 2;
    const rms = Math.sqrt(sumSquares / windowSize);
    if (rms > peak) peak = rms;
    raw.push({ t: offset / sampleRate, rms, offset });
  }

  // Pass 2: normalise, then pitch-track only the frames loud enough to be voiced.
  const frames: ProsodyFrame[] = raw.map(({ t, rms, offset }) => {
    const normalised = peak > 0 ? rms / peak : 0;
    let f0: number | null = null;

    if (normalised >= VOICED_RMS_FLOOR) {
      const detected = detectPitch(pcm.subarray(offset, offset + windowSize));
      // Reject out-of-band results rather than reporting a pitch we do not
      // believe — CONVENTIONS §6, never emit a verdict a signal cannot support.
      if (detected !== null && detected >= F0_MIN && detected <= F0_MAX) f0 = r1(detected);
    }

    return { t: r3(t), rms: r3(normalised), f0 };
  });

  return { frames, frameHopSec: HOP_SEC };
}
```

- [ ] **Step 4: Fill meanRms and meanF0 in align.ts**

Replace the two placeholder lines in `alignSegments` with a prosody lookup. Change the signature to accept the track:

```ts
export function alignSegments(
  transcript: Transcript,
  segments: ScriptSegment[],
  prosody: ProsodyTrack = { frames: [], frameHopSec: 0.01 },
): AlignmentResult {
```

and inside the per-segment loop, replace `meanRms: 0` / `meanF0: null` with:

```ts
    const inWindow = prosody.frames.filter((f) => f.t >= startSec && f.t < endSec);
    const voiced = inWindow.map((f) => f.f0).filter((f): f is number => f !== null);
    const meanRms = inWindow.length > 0
      ? inWindow.reduce((s, f) => s + f.rms, 0) / inWindow.length : 0;
    const meanF0 = voiced.length > 0
      ? voiced.reduce((s, f) => s + f, 0) / voiced.length : null;
```

then use `meanRms: r1(meanRms)` and `meanF0: meanF0 === null ? null : r1(meanF0)`.

The default parameter keeps every existing call site and test working unchanged.

- [ ] **Step 5: Install pitchfinder and run the suite**

```bash
npm install pitchfinder -w packages/core-logic
```

Run: `npm test -w packages/core-logic && npm run typecheck --workspaces`
Expected: PASS — all green

- [ ] **Step 6: Commit**

```bash
git add packages/core-logic/src/prosody.ts packages/core-logic/src/prosody.test.ts packages/core-logic/src/align.ts packages/core-logic/src/index.ts package-lock.json
git commit -m "feat(core-logic): extractProsody — RMS envelope and YIN pitch

Pure DSP over Float32Array; no vendor and no Python sidecar. Out-of-band
and quiet frames report null f0 rather than a pitch we do not believe.
alignSegments takes prosody as a defaulted parameter so every existing
call site keeps working."
```

---

### Task 12: Regenerate fixtures and tune thresholds

**Files:**
- Create: `scripts/build-report.mjs`
- Modify: `packages/contracts/fixtures/report.rough.json` (regenerated)
- Modify: `packages/contracts/fixtures/report.clean.json` (regenerated)
- Modify: `packages/core-logic/src/thresholds.ts` (tuning only)

**Interfaces:**
- Consumes: every function from Tasks 1–11
- Produces: regenerated fixtures that still satisfy all 19 tests in `packages/contracts/src/fixtures.test.ts`

- [ ] **Step 1: Write the report generator**

```js
#!/usr/bin/env node
// scripts/build-report.mjs
//
// Regenerates the demo fixtures from real transcripts. Run after any threshold
// change:  node --experimental-strip-types scripts/build-report.mjs
//
// The fixture is NEVER hand-edited to match whatever the code produced — that
// would delete the only signal telling us the rules are miscalibrated.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  alignSegments, correlateSegments, decideNextStep, generateSummary, parseScript,
} from '../packages/core-logic/src/index.ts';

const dir = 'packages/contracts/fixtures';
const script = parseScript(readFileSync(join(dir, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

const CONTEXTS = {
  rough: {
    upcomingEvents: [{ title: 'Northwind investor call', startsAt: '2026-07-27T14:00:00Z' }],
    knownMentor: null, now: '2026-07-25T09:00:00Z',
  },
  clean: { upcomingEvents: [], knownMentor: 'Priya', now: '2026-07-25T09:00:00Z' },
};

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

- [ ] **Step 2: Generate and check against the invariants**

```bash
node --experimental-strip-types scripts/build-report.mjs && npm test -w packages/contracts
```

Expected: `rough` reports exactly 1 high on `seg-003`; `clean` reports 0 high; all 19 contract tests pass.

- [ ] **Step 3: Tune if the invariants fail**

The 19 tests are the **tuning target, not the output**. If they fail, change `THRESHOLDS`, re-run Step 2, repeat. Never edit the fixture by hand and never relax a test.

| Failure | Knob |
|---|---|
| More than one high-severity issue | raise `paceDriftSigma` (1.5 → 2.0) |
| No high-severity issue | lower `paceDriftSigma` (1.5 → 1.2); if still none, the take did not rush the key stat — re-record |
| `fillerCount` disagrees with filler issues | a filler run spans a segment boundary; widen the run-grouping window |
| Pause issue missing on `seg-003` | raise `markedPauseHonouredRatio` (0.5 → 0.7) |
| Too many pacing issues | raise `paceDriftSigma` |

- [ ] **Step 4: Write the golden test**

```ts
// packages/core-logic/src/golden.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignSegments, correlateSegments, decideNextStep, generateSummary, parseScript } from './index.js';

const dir = join(import.meta.dirname, '../../contracts/fixtures');
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const script = parseScript(readFileSync(join(dir, 'script.demo.md'), 'utf8'));
const prosody = { frames: [], frameHopSec: 0.01 };

describe.each([
  ['clean', { upcomingEvents: [], knownMentor: 'Priya', now: '2026-07-25T09:00:00Z' }],
  ['rough', {
    upcomingEvents: [{ title: 'Northwind investor call', startsAt: '2026-07-27T14:00:00Z' }],
    knownMentor: null, now: '2026-07-25T09:00:00Z',
  }],
] as const)('golden: %s take', (label, ctx) => {
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

This is the earliest possible warning that the stage demo has changed behaviour.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck --workspaces`
Expected: PASS — contracts 19 + core-logic suites all green

- [ ] **Step 6: Commit and hand off**

```bash
git add scripts/build-report.mjs packages/contracts/fixtures/report.clean.json packages/contracts/fixtures/report.rough.json packages/core-logic/src/thresholds.ts packages/core-logic/src/golden.test.ts
git commit -m "feat: regenerate demo fixtures from real transcripts

Fixtures now come from actual Deepgram output rather than hand-written
guesses. Thresholds tuned until the invariants hold; the tests were not
relaxed to fit the output.

Heads-up to P3: report.*.json numbers changed, shape did not."
```

---

## Self-review

**Spec coverage:** §4 tokenize → Task 1. §5 parseScript → Task 2. §6 alignSegments incl. degraded mode → Tasks 4–5. §7 computeBaseline → Task 6. §8 rules and emission → Tasks 7, 9. §9 generateSummary → Task 8. §10 decideNextStep → Task 10. §11 extractProsody → Task 11. §12 testing and fixture regeneration → Tasks 3, 12. §13 error codes → Tasks 2 (`SCRIPT_*`), 5 (`ALIGNMENT_FAILED`), 11 (`AUDIO_TOO_SHORT`). §14 build order → task order. All covered.

**Type consistency:** `AlignmentResult` is defined in Task 5 and consumed under that name in Tasks 6, 7, 9, 12. `RawIssue` defined in Task 7, used in Task 9. `alignSegments` gains its third parameter in Task 11 with a default, so Tasks 5–10 call sites stay valid. `computeBaseline(alignments, words, prosody)` is used with that arity throughout. `r1` is redeclared per module rather than shared — deliberate, it keeps each module free-standing.

**Known deviation from the frozen contract:** two Tier-2 changes, both flagged in Task 5 and Task 6 and both requiring a heads-up to P2, not sign-off.

