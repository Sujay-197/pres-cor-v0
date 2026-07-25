# P1 — Core Logic Design

Date: 2026-07-25
Owner: P1 (logic)
Status: approved
Scope: `packages/core-logic`

Implements the seven functions frozen as `CoreLogic` + `computeBaseline` in
[`packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts).
Read [`CONVENTIONS.md`](../../../CONVENTIONS.md) first — units, determinism and
ID rules stated there are assumed throughout and not repeated here.

## 1. Scope

**In:** every pure function that turns a script plus a transcript plus a prosody
track into a `DeliveryReport` and a `NextStep`.

**Out (explicitly not P1):**
- Calling Deepgram. P2 owns `SttClient`; P1 consumes the normalised `Transcript`.
- Decoding audio to PCM. P2 owns ffmpeg; `extractProsody` receives a
  `Float32Array` already at a known sample rate.
- Executing any connector action. `decideNextStep` chooses and always returns
  `executed: false`. P2 executes.
- Any `@Tool` decorator, DI wiring, or NitroStack import.

**Non-goals:** no LLM call anywhere in this package; no population baselines; no
persistence; no streaming or incremental analysis.

## 2. Module layout

One responsibility per file, so each is testable alone and small enough to edit
reliably.

    src/
      index.ts        public re-exports only
      errors.ts       CoachError                              (exists)
      thresholds.ts   THRESHOLDS + SEVERITY_RULES             (moved out of index.ts)
      tokenize.ts     shared normaliser — script AND transcript
      parse-script.ts parseScript
      align.ts        needlemanWunsch + alignSegments
      baseline.ts     computeBaseline
      correlate.ts    correlateSegments        ← the branch point
      summary.ts      generateSummary
      next-step.ts    decideNextStep
      prosody.ts      extractProsody

Moving `THRESHOLDS` and `SEVERITY_RULES` out of `index.ts` is deliberate: they
are tuned during rehearsal, and a tuning edit should not touch the file that
defines the public API.

## 3. Data flow

    script ──parseScript──────> ScriptSegment[] ─┐
                                                 │
    audio ──[P2 SttClient]────> Transcript ──────┼──> alignSegments ──> SegmentAlignment[]
    audio ──extractProsody────> ProsodyTrack     │                            │
                    └── together: DeliverySignal ┘                    computeBaseline
                                                                              │
    (signal, segments, alignments) ──correlateSegments──> CorrelationResult
                                                                              │
                                     ──generateSummary──> DeliveryReport ──decideNextStep──> NextStep

## 4. `tokenize.ts`

Both sides of the alignment must normalise identically or matching fails on
punctuation alone.

```
normalise(text) -> string[]
  lowercase
  strip hyphens          -> "ninety-eight" and "ninety eight" both become two tokens
  strip all punctuation
  collapse whitespace
  split on whitespace
```

Hyphen stripping is why `smart_format=false` and `numerals=false` are set on the
Deepgram request. With them on, "ninety-eight percent" in the script would face
"98%" in the transcript and never match. We want verbatim tokens on both sides.

No number-word mapping is needed once hyphens are stripped, and none is
implemented — it would be a second normalisation path that could disagree with
the first.

`isFillerToken(token)` tests membership of `FILLER_LEXICON` from contracts.
Multi-word entries ("you know", "i mean") are matched against the token stream as
bigrams before single-token matching.

## 5. `parseScript(raw): ScriptSegment[]`

Split `raw` on `SCRIPT_MARKUP.segmentDelimiter` (blank line). For each block:

- `isKeyPoint` — true if `**...**` appears anywhere in the block
- `markedPause` — true if `[pause]` appears anywhere in the block
- `text` — block with `**` and `[pause]` removed, whitespace collapsed, trimmed
- `id` — `seg-NNN`, 1-based, source order, zero-padded to 3

`[pause]` means **a pause before this segment**, matching its position at the
head of segment 3 in `script.demo.md` and the wording of the fixture detail
string. It is never interpreted as a mid-segment pause.

Errors: `SCRIPT_EMPTY` when `raw.trim()` is empty; `SCRIPT_NO_SEGMENTS` when
every block is empty after stripping markup.

## 6. `alignSegments(transcript, segments): SegmentAlignment[]`

### Algorithm

Needleman-Wunsch global alignment between the script token sequence and the
transcript token sequence.

**Fillers are excluded from the alignment input.** They exist in the transcript
and never in the script, so including them only feeds the gap path noise. They
are re-attributed by timestamp in the final step below.

Scoring: match `+2`, mismatch `-1`, gap `-1`. Matrix size is bounded by
`AUDIO_MAX_SECONDS` — at 180s and ~150 WPM that is ~450 × ~500 cells, which is
trivial to compute and needs no banding or optimisation.

### Deriving boundaries

For each segment, take its first and last script tokens that matched a
transcript word:

- `wordIdxStart` / `wordIdxEnd` — indices into the **full** `transcript.words`
  array (fillers included), inclusive start, exclusive end. So
  `wordIdxStart = firstMatchedIdx` and `wordIdxEnd = lastMatchedIdx + 1`.
- `startSec` = `words[wordIdxStart].start`, `endSec` = `words[wordIdxEnd - 1].end`
- `precedingPauseSec` = this `startSec` minus the previous segment's `endSec`;
  for `seg-001` it is `startSec` minus 0
- `fillerCount` = filler words whose `start` falls in `[startSec, endSec)`
- `wpm` = non-filler words in range / (`endSec` − `startSec`) × 60
- `meanRms` / `meanF0` = mean over prosody frames whose `t` falls in
  `[startSec, endSec)`; `meanF0` is null when no frame in range is voiced

WPM excludes fillers, per CONVENTIONS §4 — it measures the pace of content.

### Degraded mode

If overall match rate falls below 40%, the recording does not correspond to the
script. Two behaviours, and the distinction matters:

- **Below 40% overall** — throw `ALIGNMENT_FAILED`. This is the wrong audio for
  this script and there is no honest report to produce.
- **A single segment matched zero tokens** — fall back to a proportional span
  for that segment only, and mark it degraded. A degraded segment **suppresses
  its own `pacing` and `stress_mismatch` verdicts**.

The suppression is the important half. Proportional splitting assumes uniform
WPM in order to measure WPM deviation; if it ever fed the pacing rules it would
place every degraded segment exactly at baseline and report a clean delivery.
A fallback that fabricates a passing grade is worse than a visible failure.

Degradation is carried on `SegmentAlignment` via a `degraded: boolean` field —
a Tier-2 addition, no sign-off needed (CONVENTIONS §2).

## 7. `computeBaseline(alignments): Baseline`

The speaker's own norms, from this recording only.

- `avgPaceWpm` = total non-filler words / total voiced time × 60, where voiced
  time is the sum of segment durations, excluding inter-segment silence
- `paceStdDev` = population standard deviation of per-segment `wpm`
- `meanRms` = mean of per-segment `meanRms`
- `medianF0` = median of all voiced frame f0 values; null when none

Degraded segments are excluded from all four — they would drag the baseline
toward a number the speaker never actually produced.

`medianPauseSec`, used by the pause rule, is the median of all inter-word gaps
exceeding `THRESHOLDS.pauseMinSec` (0.35s). Inter-word rather than
inter-segment, because six segments give too few samples for a stable median.
It is a Tier-2 addition to `Baseline`.

## 8. `correlateSegments(...)` — the branch point

Returns `{ issues, trace, baseline }`. Every issue has a matching
`DecisionTrace` entry; the trace is the Ops Canvas payload and is not optional.

### Rules

Evaluated per segment, in this order. Each names the two signals it
cross-references — a rule reading one signal is a lint check, not a correlation,
and is `low` by construction.

| id | verdict | condition |
|---|---|---|
| `stress.key-point-rushed` | high | `isKeyPoint` && `wpm > avgPaceWpm + 1.5σ` |
| `stress.key-point-rising-pitch` | high | `isKeyPoint` && f0 available && mean f0 of last third / first third > 1.12 |
| `pause.marked-not-honoured` | medium | `markedPause` && `precedingPauseSec < 0.5 × medianPauseSec` |
| `filler.in-key-point` | medium | filler lands inside a key-point segment |
| `filler.density` | medium | 3rd or later filler within one segment |
| `filler.isolated` | low | any other filler |
| `pacing.drift` | low | `!isKeyPoint` && `|wpm − avgPaceWpm| > 1.5σ` |

Thresholds live in `THRESHOLDS`; the table above states their current values for
readability but the code reads the constants.

### Emission rules

**One stress issue per segment.** If both stress rules fire, emit one issue.
`stress.key-point-rushed` takes precedence — pace is the more legible signal on
stage — and the `detail` string mentions the pitch rise as corroboration. This
keeps "exactly one high-severity issue" reachable.

**Stress suppresses pacing on the same segment.** Both read the same WPM
observation; emitting both double-reports one fact and dilutes the red tick.

**One issue per filler word**, attributed by timestamp, severity from the three
filler rules in table order.

**Degraded segments** emit neither `pacing` nor `stress_mismatch`.

### ID assignment

Collect all issues, then sort by `timestamp` ascending, tie-broken by severity
(high → medium → low) then by `type` alphabetically. Assign `iss-NNN` **after**
sorting. Ties must break deterministically or the demo's click path shifts
between runs.

## 9. `generateSummary(...)` — `DeliveryReport`

- `segments`, `issues` — passed through
- `fillerCount` — count of issues with `type === 'filler'`, which keeps it
  consistent with what the widget can actually display
- `avgPaceWpm` — `baseline.avgPaceWpm`, rounded to 1 decimal
- `durationSec` — `signal.transcript.durationSec`
- `audioUrl`, `reportId` — from `meta`
- `contractVersion` — `CONTRACT_VERSION` from contracts
- `status` — `'ready'`
- `nextStep` — null; filled by the caller after `decideNextStep`

All emitted floats round to 1 decimal. Unrounded floats differ in the last bits
across platforms and would make the golden test fail on someone else's machine.

## 10. `decideNextStep(report, ctx): NextStep`

Branches in order:

1. `status !== 'ready'` → `kind: 'none'`
2. an event in `ctx.upcomingEvents` starts within 7 days of `ctx.now` →
   `calendar_reminder`, carrying that event's title and start time
3. otherwise → `draft_note`, addressed to `ctx.knownMentor` when present and to
   a generic hint when not

`executed` is always `false`. Deciding and executing are different jobs; P2
executes after the user confirms.

Branch 3 has no "everything is fine, do nothing" exit on purpose. The design
principle in SPEC §2 is that the last action always points toward real human
practice, so a clean take still ends by proposing a person to rehearse with.

`ctx.now` is injected, never read from the clock — the demo must be reproducible.

## 11. `extractProsody(pcm, sampleRate): ProsodyTrack`

25 ms analysis window, 10 ms hop.

- `rms` — root mean square per window, normalised 0..1 against the loudest
  window in the recording
- `f0` — YIN via `pitchfinder`, restricted to 60–400 Hz; null when the detector
  returns nothing or when window `rms` is below 5% of the maximum

Built last. `correlateSegments` accepts a `ProsodyTrack` with zero frames:
`meanF0` becomes null everywhere, `stress.key-point-rising-pitch` never fires,
and `stress.key-point-rushed` still produces the red tick from WPM alone. The
full demo therefore exists before any DSP is written, and cutting this section
costs half of one rule rather than a feature.

Errors: `AUDIO_TOO_SHORT` when the recording is under 5 seconds.

## 12. Testing

Vitest, one test file per module, colocated.

**Unit tests** per module, covering the stated edge cases: empty script,
markup-only blocks, zero-match segments, no voiced frames, single-segment
scripts, fillers at segment boundaries.

**Golden test** — the real transcript fixture plus `script.demo.md` in, the full
`DeliveryReport` asserted out.

**Fixture regeneration.** Once the real recording is transcribed,
`packages/contracts/fixtures/report.rough.json` is regenerated from actual
output. P3 is unaffected: the schema is unchanged and the 19 existing tests in
`packages/contracts/src/fixtures.test.ts` pin the demo invariants — exactly one
high-severity issue, of type `stress_mismatch`, on a key-point segment, plus
sorted timestamps and sequential IDs.

Those invariants are the **tuning target, not the output**. If the real rough
take does not naturally produce exactly one red tick, thresholds in
`THRESHOLDS` move until it does. The fixture is never hand-edited to match
whatever the code happened to produce — that would delete the only signal
telling us the rules are miscalibrated.

## 13. Error summary

| code | raised by | when |
|---|---|---|
| `SCRIPT_EMPTY` | `parseScript` | input blank |
| `SCRIPT_NO_SEGMENTS` | `parseScript` | every block empty after markup strip |
| `ALIGNMENT_FAILED` | `alignSegments` | overall match rate below 40% |
| `AUDIO_TOO_SHORT` | `extractProsody` | under 5 seconds |

`AUDIO_UNREADABLE` and `STT_FAILED` are declared in `errors.ts` but raised by
P2, not here.

## 14. Build order

1. `tokenize` + `parse-script` — no audio needed
2. `align` — the risk, against the real transcript
3. `baseline` + `correlate` with the stress rule only → **the red tick**
4. `summary` → a full `DeliveryReport` renders in P3's widget
5. remaining rules — filler, pause, pacing
6. `next-step`
7. `prosody`

Steps 1–2 do not depend on the recording and start immediately.

## 15. Coordination

- **To P2:** `SegmentAlignment.degraded` and `Baseline.medianPauseSec` are
  Tier-2 additions. `decideNextStep` never sets `executed: true` — that is
  yours, after user confirmation.
- **To P3:** `report.rough.json` numbers change once regenerated; shape does
  not. Build against the schema, not against specific values.
- **To P4:** thresholds are tuned to the recordings, so a re-record invalidates
  the tuning. Lock them early.
