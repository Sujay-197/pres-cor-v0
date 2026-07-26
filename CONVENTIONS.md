# CONVENTIONS.md — the common structure

Four people, four different toolchains, 24 hours, one merge point. These rules
exist so the merge at h4-6 is a copy-paste and not a rebuild. Read once at
kickoff. Everything here is cheap to follow and expensive to discover late.

Read order for a new teammate: `ARCHITECTURE_BRIEF.md` -> `SPEC.md` -> this file
-> `packages/contracts/src/index.ts`.

## 1. Repo layout and who owns what

    nsh/
      docs/                        ARCHITECTURE_BRIEF, SPEC, VOICE_STACK, TEAM_PLANS
      packages/
        contracts/                 THE SEAM — shared by all four. Nobody edits alone.
          src/index.ts             types + Zod + frozen function signatures
          fixtures/                mock reports + demo script (P3 builds against these)
        core-logic/                P1. Pure TypeScript. Zero NitroStack imports.
        widget/                    P3. React + @nitrostack/widgets.
      apps/
        server/                    P2. NitroStack MCP server. Thin @Tool shells.
      fixtures/audio/              P4. The 2-3 curated demo recordings.
      scripts/                     shared tooling

One rule with teeth: **`packages/core-logic` must never import from
`apps/server`, and `apps/server` must never contain logic worth unit-testing.**
If you catch yourself writing an `if` inside a `@Tool` body, it belongs in
core-logic.

## 2. The contract, and how to change it

`packages/contracts/src/index.ts` is the only file all four of us depend on.

**Tier 1** (`DeliveryReport`, `DeliveryIssue`, `ScriptSegment`, `NextStep`,
`IssueType`, `Severity`) is frozen at hour 1. It crosses into the widget and the
host. To change it:

1. Post the diff in chat. Say which of the four workstreams it breaks.
2. All four react. No silent merges — a Tier 1 change while P3 is mid-render
   costs more than the change is worth.
3. Bump `CONTRACT_VERSION`.

**Tier 2** (`Transcript`, `ProsodyTrack`, `SegmentAlignment`, `Baseline`,
`DecisionTrace`, `CorrelationResult`, `NextStepContext`) is the P1<->P2 seam and
never leaves the server. Change it with a heads-up in chat. No ceremony.

If NitroStudio's generators fight the workspace and you cannot resolve
`@nsh/contracts`, run `npm run sync:contracts` — it copies the file in verbatim
so you are never blocked. The copy is generated; edit the original.

## 3. Units, IDs, and determinism

These three cause every integration bug in a project this shape.

- **Time is always seconds, as a float.** Never milliseconds, anywhere, at any
  layer. Vendors return ms — the STT adapter converts at the boundary and
  nothing downstream ever sees ms again.
- **IDs are deterministic, never random.** `seg-001` in source order. `iss-001`
  in ascending timestamp order, assigned after sorting. Same input must produce
  the same report, byte for byte. The demo depends on this: if IDs shuffle
  between runs, the rehearsed click-path breaks on stage.
- **Core logic is pure.** No `Date.now()`, no `Math.random()`, no `fs`, no
  network. Anything ambient arrives as an argument — that is why
  `NextStepContext` carries `now` instead of reading the clock.

## 4. Definitions that need to be settled once

Ambiguity here shows up as two people computing different numbers from the same
audio and neither being wrong.

- **WPM excludes filler words.** It measures the pace of *content*, so
  `avgPaceWpm` and per-segment `wpm` both count only non-filler words. Fillers
  get counted separately in `fillerCount`.
- **WPM divides by voiced time, not wall-clock.** Sum of segment durations,
  excluding inter-segment silence. Otherwise a long thoughtful pause reads as
  "slow speaking" and we flag the wrong thing.
- **A pause is a gap > 0.35s between consecutive words.** Below that it is
  articulation, not a pause.
- **Baseline is the speaker's own, computed from this recording.** Never a
  population average. This is the whole honesty argument in SPEC section 2 —
  every verdict is "versus your own norm", which the judge can verify.
- **`isFiller` is set by our adapter, not the vendor.** Deepgram returns "uh"
  and "um"; `FILLER_LEXICON` in contracts covers the rest, identically across
  providers.

## 5. Severity is data, not control flow

Severity verdicts live in one exported `SEVERITY_RULES` table in core-logic, not
as `if` statements scattered through `correlateSegments`. Two reasons, both
scoring reasons:

- Every issue can name the rule that produced it (`DecisionTrace.rule`), so the
  Ops Canvas trace shows *why*, not just *what*. That is differentiation
  checklist item #1.
- Tuning thresholds during rehearsal means editing a number, not re-reading the
  function at hour 21.

Each rule states the two signals it cross-references. A rule that reads only one
signal is a lint check, not a correlation — it belongs at `low` severity by
construction.

## 6. Errors

Never throw a raw `Error` across a tool boundary. Core logic throws
`CoachError` with a stable `code`; the `@Tool` wrapper maps it to an MCP error.
Codes we know we need: `SCRIPT_EMPTY`, `SCRIPT_NO_SEGMENTS`, `AUDIO_UNREADABLE`,
`AUDIO_TOO_SHORT`, `STT_FAILED`, `ALIGNMENT_FAILED`. `BAD_INPUT` (-> HTTP 400)
covers the general case: request or tool input failed schema validation.

Degrade rather than fail where it is honest to do so: no pitch track (silent or
unvoiced audio) means we skip `stress_mismatch` checks and say so in the report,
rather than inventing an f0. Never emit a verdict a signal cannot support.

## 7. Git

- Branches: `p1/...`, `p2/...`, `p3/...`, `p4/...`. P4 owns `main` and merges.
- Small commits, push often. A branch nobody can see is a branch nobody can
  integrate at h4.
- `main` must stay deployable from hour 6. If `main` is red, that is the only
  thing anyone works on.

## 8. Tests

Vitest, colocated as `*.test.ts`. P1's core-logic is the only part with a real
coverage expectation — it is pure, so it is cheap to test, and it holds the
entire severity argument.

The one test that matters most: **golden-file tests against
`packages/contracts/fixtures/`.** Feed the demo script and a fixture transcript
in, assert the exact `DeliveryReport` out. That test failing is the earliest
possible warning that the stage demo has changed behaviour.

## 9. Environment

Every secret is read in exactly one place (`apps/server/src/config.ts`),
validated with Zod at boot, and injected. No `process.env` reads scattered
through tools.

    STT_PROVIDER=deepgram        # deepgram | assemblyai | fixture
    DEEPGRAM_API_KEY=
    ASSEMBLYAI_API_KEY=
    AUDIO_MAX_SECONDS=180
    LOG_LEVEL=info

`STT_PROVIDER=fixture` replays a stored transcript from disk. It costs nothing,
runs offline, and is the fallback if the venue wifi dies during the demo — which
is the reason it exists, so build it early, not at hour 22.
