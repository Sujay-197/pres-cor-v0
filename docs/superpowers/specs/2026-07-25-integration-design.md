# Integration Design — unifying P1, P2 and P3 into a running system

**Date:** 2026-07-25
**Status:** approved (design), pending implementation plan
**Scope:** make the three workstreams function end-to-end as one system, *before* NitroStack integration.

---

## 1. Goal

Turn three separately-correct pieces into one runnable demo: pick or upload a recording,
get a real `DeliveryReport` produced by the real pipeline, rendered by the real widget,
with audio you can scrub. NitroStack decorators come after this and replace only the
transport layer.

Success is a single command bringing up a server and a widget where selecting the rough
take renders the red tick on `seg-005` — produced live, not read from a fixture file.

## 2. Current state

| Part | Location | State |
|---|---|---|
| `@nsh/contracts` | this branch | Frozen Tier-1 + Tier-2. Unchanged by this work. |
| `@nsh/core-logic` | this branch | Complete. Seven pure functions, 104 tests, golden-locked against real audio. |
| `@nsh/widget` | this branch | Complete. Consumes one `DeliveryReport` prop. 3 tests. |
| P2 server | `origin/Sreechetana` only | **Shells.** Not in the workspace. |

P2's branch forked from the initial commit and was uploaded as loose `.ts` files in the
repository root. Three of its five tools (`parse_script`, `correlate_segments`,
`generate_summary`) contain only `throw new Error('pending merge')`. The other two have
partial bodies. All of them compile against a hand-written `contracts-stub.ts` that has
since diverged from the frozen contract in four material ways:

1. `NextStep.kind` omits `'none'` and the object uses `detail` where the contract uses `rationale`.
2. `Word` uses `startSec`/`endSec` where the contract uses `start`/`end`.
3. `SttClient.transcribe` takes `(Buffer, sampleRate)` where the contract takes `(Uint8Array, mimeType)`.
4. A second `FILLER_LEXICON` exists, containing `"so"`, which the contract's does not.

**Decision: P2's branch is reference material, not a merge source.** Its structure, its
`config.ts`, its connector interfaces, its audit-interceptor concept and its Deepgram
fetch are worth porting; each is rewritten against the real contract. The three stub
tools are written fresh. The branch stays in place as provenance and is never merged.

## 3. Architecture

One new workspace does all I/O. Nothing else changes responsibility.

```
@nsh/contracts    frozen types, zero runtime deps beyond zod
@nsh/core-logic   pure functions — no network, no fs, no clock
@nsh/widget       React; one DeliveryReport prop
apps/server       NEW — adapters, five tools, HTTP
```

`apps/*` is already in the root `workspaces` glob, so the new package registers with no
root change beyond dependencies.

**Layering rule (extends CONVENTIONS §1):** `apps/server` may import `@nsh/contracts` and
`@nsh/core-logic`. Neither may import `apps/server`. Core logic stays pure; every clock
read, file read and network call lives in `apps/server`.

## 4. Package layout

```
apps/server/
  package.json
  tsconfig.json
  src/
    main.ts                     boot: validate config, start listener
    http.ts                     routes and middleware
    config.ts                   the one process.env read, Zod-validated
    errors.ts                   CoachError -> HTTP status mapping
    takes.ts                    discover staged takes + uploads
    pipeline.ts                 composes the five tools in order
    audit.ts                    per-call audit log middleware
    adapters/
      stt-client.ts             DeepgramSttClient, FixtureSttClient, factory
      audio-decode.ts           container bytes -> Float32Array PCM
      connectors.ts             Calendar/Gmail interfaces + fixture impls
    tools/
      parse-script.tool.ts
      transcribe-delivery.tool.ts
      correlate-segments.tool.ts
      generate-summary.tool.ts
      suggest-next-step.tool.ts
```

Each tool file exports one function and its input/output Zod schemas. They are plain
functions, not classes: NitroStack's generator will supply its own class and decorator
shape, and a plain function is the smallest thing that survives that transition.

## 5. Adapters

### 5.1 `stt-client.ts`

Implements the frozen interface exactly:

```ts
interface SttClient {
  readonly provider: string;
  transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript>;
}
```

`DeepgramSttClient` posts the **raw container bytes** with the file's MIME type — no
decoding. This is the path already proven against real audio by `scripts/transcribe.mjs`,
and it lifts that script's query parameters unchanged:

```
model=nova-3  filler_words=true  punctuate=true  smart_format=false  numerals=false
```

`smart_format` and `numerals` must stay off. Both rewrite spoken numbers into digits
("ninety-eight percent" becomes "98%"), which destroys text matching against the script.

Deepgram returns seconds already; values are rounded to 3 decimal places at this boundary
and never converted again, per CONVENTIONS §3.

`FixtureSttClient` replays `packages/contracts/fixtures/transcript.{clean,rough}.json`
selected by take id. `createSttClient()` chooses between them on `STT_PROVIDER` and is the
only place that reads it.

**The adapter does not classify fillers.** It sets `isFiller: false` on every word and
leaves classification to `alignSegments`, which is the only component that can distinguish
a hedge from the same word used legitimately. P2's stub carried its own lexicon; that
lexicon is deleted, not ported.

### 5.2 `audio-decode.ts`

`ffmpeg-static` decodes any input container to 16 kHz mono `Float32Array`. This exists
solely to feed `extractProsody`, whose signature is `(pcm: Float32Array, sampleRate: number)`.

**Decode failure is not fatal.** If ffmpeg is missing or the container is unreadable, the
tool logs it, substitutes an empty `ProsodyTrack` (`{ frames: [], frameHopSec: 0.01 }`),
and the pipeline continues. Every rule that currently fires — stress, filler, pause,
pacing — derives from word timings alone; prosody feeds only the untested
`stress.key-point-rising-pitch` branch. A missing binary must never take down the demo.

### 5.3 `connectors.ts`

Three seams, split by what they actually do:

```ts
/** Reads ambient facts. Fixture impl reads the shared context fixture (§9). */
interface ContextProvider {
  nextStepContext(takeId: string, now: string): Promise<NextStepContext>;
}

/** Writes. Only suggest_next_step calls these, and only after decideNextStep. */
interface CalendarConnector {
  createReminder(title: string, startsAt: string): Promise<{ id: string }>;
}
interface GmailConnector {
  draft(subject: string, body: string, to: string | null): Promise<{ id: string }>;
}
```

`knownMentor` is not a calendar fact, so it does not belong on `CalendarConnector`.
`ContextProvider` owns assembling the whole `NextStepContext` — under real MCP composition
it fans out to a calendar server and a user profile; as a fixture it reads §9's JSON keyed
by take id.

The `takeId` parameter exists for the fixture implementation, which needs to know which
take's scripted context to return. Real implementations ignore it.

Fixture writers log and return a synthetic id. They perform no real action, which is what
makes `executed: true` honest at this stage: the action *was* performed against the
configured connector.

## 6. The five tools

Thin wrappers. Per CONVENTIONS §1, an `if` in a tool body belongs in core-logic instead.

| Tool | Input | Output | Wraps |
|---|---|---|---|
| `parse_script` | `{ raw: string }` | `ScriptSegment[]` | `parseScript` |
| `transcribe_delivery` | `{ takeId: string }` | `DeliverySignal` | `SttClient.transcribe` + `extractProsody` |
| `correlate_segments` | `{ signal, segments }` | `CorrelationResult` | `alignSegments` then `correlateSegments` |
| `generate_summary` | `{ segments, correlation, signal, meta: { reportId, audioUrl } }` | `DeliveryReport` | `generateSummary` |
| `suggest_next_step` | `{ report, takeId, now }` | `NextStep` | `ContextProvider` read, `decideNextStep`, connector write |

Notes that matter:

- `correlate_segments` calls `alignSegments(transcript, segments, prosody)` and then
  `correlateSegments(signal, segments, alignment)`. It does **not** call `computeBaseline`
  — `correlateSegments` computes the baseline internally and returns it on
  `CorrelationResult.baseline`.
- `suggest_next_step` is the only tool that mutates the outside world, and the only place
  `NextStep.executed` becomes `true`. `decideNextStep` always emits `false`; the tool
  performs the action through a connector and flips the flag on the returned copy. When
  `kind` is `'none'`, nothing is executed and the flag stays `false`.
- `transcribe_delivery` returns a `DeliverySignal` (`{ transcript, prosody }`) — exactly
  what `correlateSegments` consumes — rather than an ad-hoc pair.

## 7. HTTP surface

```
GET  /api/takes                 -> { takes: Array<{ id, label, mimeType, hasFrozenTranscript }> }
POST /api/uploads               -> { takeId }             multipart/form-data, one file field
GET  /api/audio/:takeId         -> audio stream, with Content-Type and range support
POST /api/analyze               -> DeliveryReport
POST /api/tools/:name           -> that tool's output
GET  /api/health                -> { ok, sttProvider, prosodyEnabled }
```

**Take ids.** A staged take's id is its filename with the `take-` prefix and the extension
removed: `fixtures/audio/take-rough.m4a` has id `rough`. This is what makes the fixture
report id (`rpt-demo-rough`, already committed) and the fixture transcript lookup
(`transcript.rough.json`) fall out of one identifier. Uploaded takes are stored under
`fixtures/audio/uploads/` and get a content-hash id, which cannot collide with `rough` or
`clean`.

`POST /api/analyze` accepts `{ takeId: string, script?: string, now?: string }`. `script`
defaults to `packages/contracts/fixtures/script.demo.md`; `now` defaults to the real clock
and exists so tests and the golden comparison can pin it.

`POST /api/tools/:name` is the NitroStack-shaped surface: one named tool, its own schema,
one call. Under NitroStack these become `@Tool` methods and this route disappears;
`/api/analyze` is replaced by the host model's own orchestration.

`GET /api/audio/:takeId` exists because `DeliveryReport.audioUrl` has to resolve to
something the widget's `<audio>` element can actually load. Reports produced by the server
set `audioUrl` to `/api/audio/:takeId`, a root-relative path, which
`isAllowedAudioUrl` already permits.

Range request support is required: without it the scrubber cannot seek in most browsers,
and seeking to a tick is the demo's core interaction.

## 8. Data flow

```
takeId
  |
  +-- read bytes ---------------------------> SttClient.transcribe(bytes, mime) --> Transcript
  |                                                                                    |
  +-- ffmpeg decode --> Float32Array PCM ---> extractProsody(pcm, 16000) --> ProsodyTrack
                                                                                       |
                              DeliverySignal { transcript, prosody } <------------------+
                                                     |
  script.demo.md --> parseScript --> ScriptSegment[] |
                                                     v
                                 alignSegments --> correlateSegments --> CorrelationResult
                                                     |
                                                     v
                                            generateSummary --> DeliveryReport
                                                     |
                                                     v
                              connector events --> decideNextStep --> execute --> NextStep
                                                     |
                                                     v
                                        report.nextStep = nextStep --> widget
```

## 9. Shared next-step context fixture

`scripts/build-report.mjs` currently hardcodes the `NextStepContext` used for each take.
The server needs the same values for its fixture connectors, and two copies would drift.

Extract them to `packages/contracts/fixtures/next-step-context.json`:

```json
{
  "rough": {
    "upcomingEvents": [{ "title": "Northwind investor call", "startsAt": "2026-07-27T14:00:00Z" }],
    "knownMentor": null,
    "now": "2026-07-25T09:00:00Z"
  },
  "clean": { "upcomingEvents": [], "knownMentor": "Priya", "now": "2026-07-25T09:00:00Z" }
}
```

`build-report.mjs` reads it instead of its inline constant; the fixture connectors read it
too. Regenerating the report fixtures after this change must produce a byte-identical
result — if it does not, the extraction was wrong.

## 10. Error handling

`CoachError.code` maps to HTTP status at the tool boundary. A raw `Error` never crosses it.

| Code | Status | Meaning |
|---|---|---|
| `BAD_INPUT` | 400 | Request or tool input failed schema validation |
| `SCRIPT_EMPTY` | 400 | Script text was blank |
| `SCRIPT_NO_SEGMENTS` | 400 | Script parsed to zero segments |
| `AUDIO_UNREADABLE` | 415 | Container could not be decoded |
| `AUDIO_TOO_SHORT` | 422 | Recording below the minimum analysable length |
| `STT_FAILED` | 502 | Upstream speech provider failed |
| `ALIGNMENT_FAILED` | 422 | Transcript matched too little of the script |
| `INTERNAL` | 500 | Invariant violation inside core-logic |

Response body: `{ error: { code, message } }`. The `context` field on `CoachError` is
logged but never returned — it can carry input fragments.

Anything that is not a `CoachError` becomes a 500 with a generic message, logged in full
server-side. Vendor error text is never forwarded to the client verbatim.

## 11. Configuration

One Zod-validated read of `process.env`, at boot, in `config.ts`. No `process.env` access
anywhere else in `apps/server` (CONVENTIONS §9).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP listener |
| `STT_PROVIDER` | `fixture` | `fixture` \| `deepgram` |
| `DEEPGRAM_API_KEY` | — | Required when `STT_PROVIDER=deepgram` |
| `ENABLE_PROSODY` | `true` | Set false to skip decode entirely |
| `AUDIO_MAX_SECONDS` | `180` | Upload guard |
| `UPLOAD_MAX_BYTES` | `26214400` | 25 MB upload guard |
| `LOG_LEVEL` | `info` | |

A cross-field check fails at boot when `STT_PROVIDER=deepgram` and no key is present, so
a misconfiguration surfaces at startup rather than on the first call during a demo.

`UPLOAD_MAX_BYTES` is enforced by the multipart parser before anything is written to disk.
`AUDIO_MAX_SECONDS` cannot be known until the audio has been read, so it is checked against
`Transcript.durationSec` immediately after transcription; exceeding it raises
`CoachError('AUDIO_UNREADABLE')` with a message naming the limit. Both guards exist to stop
an accidental hour-long upload from burning Deepgram credits mid-event.

The key is read once, held in memory, and never logged. Existing repository practice
holds: `.env` stays gitignored, and no code path prints the value — only whether it is set.

**`STT_PROVIDER` defaults to `fixture`** so a clean checkout runs offline and deterministic.
Live Deepgram is opt-in.

## 12. Observability

An audit middleware wraps every tool call and records
`{ tool, takeId, durationMs, outcome, errorCode? }` at info level. This is cheap, it is
what ARCHITECTURE_BRIEF §3 asks for, and it is the trace story until NitroStudio's Ops
Canvas takes over. It logs metadata only — never transcript text, never script content,
never the API key.

## 13. Widget changes

The change `App.tsx` already documents as a one-line swap:

- Fixture tabs become a take picker populated from `GET /api/takes`.
- A drop zone posts to `POST /api/uploads`, then analyses the returned `takeId`.
- Report data comes from `POST /api/analyze`.
- **The two fixture tabs remain as an offline fallback.** If the server is unreachable the
  widget still renders a report. This is deliberate: a demo that dies with the server is
  worse than one that degrades.
- Vite proxies `/api` to the server port, so there is no CORS configuration.

No component below `App.tsx` changes. `DeliveryTimelineWidget` still takes one
`DeliveryReport` prop. If any change is needed deeper than `App.tsx` plus the Vite config,
the contract failed and the fix belongs in the report shape, not the widget.

## 14. Testing

**Per-tool unit tests** run with `STT_PROVIDER=fixture` against the frozen transcripts.
Each asserts the tool's schema contract and its error mapping.

**Adapter tests** cover the Deepgram response mapping (against a recorded response body,
not a live call), the fixture client, decode failure degrading to an empty prosody track,
and the connector fixtures.

**The integration test that proves the wiring:** boot the server in-process, `POST
/api/analyze` with `{ takeId: 'rough', now: '2026-07-25T09:00:00Z' }`, and assert the
response deep-equals `packages/contracts/fixtures/report.rough.json` — with `audioUrl`
excluded from the comparison on both sides, since it is environment-dependent by
construction (the fixture says `/fixtures/take-rough.wav`, the server says
`/api/audio/rough`). A second assertion checks `audioUrl` is a valid, servable path.

This reuses the golden lock already covering core-logic to cover the whole assembled
system. It is the single most valuable test in this work: it fails if any adapter, any
tool wrapper, or any wiring step corrupts the pipeline.

The same test runs for the clean take.

**Existing suites must stay green:** 18 contracts, 104 core-logic, 3 widget.

## 15. Dependencies added

| Package | Where | Why |
|---|---|---|
| `express` | `apps/server` | HTTP routing; ubiquitous, and NitroStack is NestJS-shaped so Express is the same underlying model |
| `multer` | `apps/server` | Multipart upload parsing |
| `ffmpeg-static` | `apps/server` | Audio decode for prosody; already the choice in VOICE_STACK.md |

`zod` and `@nsh/*` come from the workspace. No new dependency reaches the widget or
core-logic.

## 16. Explicitly deferred

- **NitroStack decorators and NitroCloud deploy.** This work's whole shape exists to make
  that step mechanical.
- **OAuth 2.1 / JWT guard** on `suggest_next_step`. A localhost demo has no auth surface.
  The interface seam goes in; enforcement lands with the deployed build.
- **Real Gmail and Calendar MCP composition.** Fixture connectors now, behind interfaces
  designed for the swap.
- **Ops Canvas.** NitroStudio provides it; `DecisionTrace` already feeds it.
- **AssemblyAI.** Deepgram is primary; the factory has the branch, and it throws.

## 17. Risks

**Upload latency on stage.** An uploaded recording goes to live Deepgram and takes seconds.
The staged takes with frozen transcripts stay the demo path; upload is a capability shown
after the scripted run, not during it.

**ffmpeg-static on Windows.** Roughly 80 MB and platform-specific. The graceful degradation
in §5.2 is what makes this a non-blocker; `ENABLE_PROSODY=false` skips it entirely.

**Report id determinism.** Staged takes use `rpt-demo-{takeId}` so the golden comparison
holds. Uploads derive an id from a content hash, which keeps the pipeline pure of
`Math.random()` while still being unique per file.
