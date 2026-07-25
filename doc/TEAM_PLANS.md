# TEAM_PLANS.md — per-person build plan

Roles are from ARCHITECTURE_BRIEF §5 (split by tool access, not by feature).
This file turns each role into an ordered task list with a definition of done.

**The hour-1 gate, for everyone.** Nobody starts building until three things are
agreed in chat, together, in one sitting — they take about twenty minutes and
they are what makes the h4-6 merge a copy-paste:

1. The four Tier-1 amendments in `contracts/src/index.ts` (`durationSec`,
   `audioUrl`, `nextStep`, `reportId`+`contractVersion`). Each has its rationale
   written next to it. Accept or reject, then freeze.
2. The `CoreLogic` interface — the six function signatures. This is the seam.
3. The script markup format: blank line = segment, `**bold**` = key point,
   `[pause]` = planned pause.

After that gate, the four workstreams do not block each other until h4.

---

## P1 — Logic owner (Claude Code)

Pure TypeScript in `packages/core-logic`. Zero NitroStack imports, zero network,
zero `Date.now()`. Everything ambient arrives as an argument.

**h1-2 — parse and align (no audio yet)**
- `parseScript(raw)` — split on blank lines, detect `**` and `[pause]`, strip
  markup from `text`, assign `seg-NNN`. Test against
  `fixtures/script.demo.md`: 6 segments, key points at seg-003 and seg-005,
  marked pause at seg-003.
- `alignSegments(transcript, segments)` — map each segment onto its word range.
  Normalised token match with a tolerance window; the transcript will not match
  the script exactly and must not need to. This is the part most likely to be
  fiddly — budget accordingly and keep a dumb proportional fallback.

**h2-4 — the branch tool**
- `SEVERITY_RULES` as an exported table (CONVENTIONS §5), each rule naming the
  two signals it cross-references.
- `correlateSegments(...)` returning `{ issues, trace, baseline }`. The `trace`
  is not optional polish — it is what the judge reads on Ops Canvas.
- Baseline computed from this recording only. Every verdict is versus the
  speaker's own norm.

The four rules to get right, in priority order:
1. `stress_mismatch` — key point + WPM > baseline + 1.5σ (or rising f0 across
   the line). **This is the red tick. It is the whole demo. Build it first.**
2. `pause` — `markedPause` true but preceding gap < half the speaker's median.
3. `filler` — low by default; medium when density > 2 per segment or when it
   lands inside a key-point segment.
4. `pacing` — drift versus baseline outside key points. Low severity by design.

**h4-5 — summary and next step**
- `generateSummary(...)` — assemble `DeliveryReport`, sort issues by timestamp,
  assign `iss-NNN` *after* sorting (determinism, CONVENTIONS §3).
- `decideNextStep(report, ctx)` — branches on `ctx.upcomingEvents`. Always
  returns `executed: false`; deciding and executing are different jobs and only
  P2 executes.

**h5-6 — prosody**
- `extractProsody(pcm, sampleRate)` — RMS envelope by hand, f0 via
  `pitchfinder` YIN. Test against a synthesised 220 Hz sine.
- Deliberately last: three of four issue types need no DSP at all (VOICE_STACK
  §4), so a fully working demo exists before this lands. If the clock runs out,
  `stress_mismatch` falls back to the WPM signal alone and still fires.

**Done when:** `npm test -w packages/core-logic` is green, and a golden test
turns `script.demo.md` + a fixture transcript into `report.rough.json` exactly.

---

## P2 — Scaffold + connectors owner (NitroStudio)

**h1-4 — shells, in parallel with P1, empty bodies**
- Scaffold five `@Tool`s via the CLI generator, Zod schemas imported from
  `@nsh/contracts` rather than retyped. Bodies `throw new Error('pending merge')`.
- `config.ts` — all env in one Zod-validated place (CONVENTIONS §9).
- Audit-logging interceptor on every call. ~20 minutes, and it is a scored line
  item on the differentiation checklist.
- Auth guard on `suggest_next_step` only — it is the one tool that touches the
  real world.

**h2-4 — the STT adapter (your critical path, parallel to the shells)**
- Implement `SttClient` for Deepgram: `model=nova-3&filler_words=true`, map the
  `words` array to our `Word` type, **convert ms to seconds at this boundary**
  and tag `isFiller` from `FILLER_LEXICON`. Nothing downstream sees vendor
  shapes or milliseconds.
- Implement `FixtureSttClient` reading a stored JSON transcript. This is the
  offline demo fallback — build it now, not at hour 22.
- ffmpeg normalise to 16 kHz mono PCM.

**h4-6 — merge point**
- Drop P1's functions into the shells. Each body should be roughly one call.
- Validate every tool in NitroStudio's tool inspector, not Postman — the thing
  being tested is a host model choosing when to call, which Postman cannot show.

**h8-16 — connectors**
- Compose Calendar + Gmail into `suggest_next_step`. `decideNextStep` picks the
  branch; you execute it and flip `executed` to true.
- **Never auto-send.** Draft, return `executed: false`, let the user confirm.
  A demo that sends an email unprompted reads as a bug to a judge, not a feature.

**Done when:** all five tools callable from the inspector, audit lines on every
call, and the Calendar branch creates a real event on our own account.

---

## P3 — Widget owner (NitroStudio)

You are never blocked. `packages/contracts/fixtures/report.clean.json` and
`report.rough.json` exist right now and are schema-exact. Build against them
from minute one and do not wait for a server.

**h1-6 — the timeline**
- Import the fixtures directly. Timeline scrubber, ticks positioned at
  `issue.timestamp / report.durationSec`, coloured from `SEVERITY_COLOR` in
  contracts (do not hand-pick hexes — they must match the deck).
- Script text below, segment highlighted as playback crosses it.
- Click a tick -> seek `<audio>` to that timestamp, show the script line plus
  `issue.detail`.

**h6-12 — summary card and states**
- Filler count, pace variance, top 3 issues (derive by sorting on severity then
  timestamp — this is *not* a schema field, do not ask for one).
- The `nextStep` card: `calendar_reminder` and `draft_note` render differently,
  and `executed: false` means a confirm button, `true` means a receipt. Both
  fixtures exist so you can build both branches today.
- `status: 'analyzing'` skeleton state.

**h12-16 — wire to the real server**, which by then returns the same shape.

**Done when:** both fixtures render correctly, tick clicks seek accurately, and
swapping fixture JSON for live tool output is a one-line change.

Watch for: ticks within ~0.5s of each other overlap and become unclickable.
`report.rough.json` has iss-003 at 13.9 and iss-004 at 14.2 deliberately, so you
hit this on day one rather than on stage.

---

## P4 — Deploy + demo owner (NitroStudio)

**h1-3 — pipeline before there is anything to deploy**
- NitroCloud deploy-on-push against `main` with a stub tool. Getting a URL live
  early is the single highest-payoff hour in the whole build.
- You own `main`. Red `main` is everyone's only job until it is green.

**h3-8 — the recordings, and this is the part people underestimate**
Record three takes of `fixtures/script.demo.md`, same voice, same room:
1. **Clean** — should produce ~2 low fillers, no high-severity issue.
2. **Rough** — deliberate: two fillers in segment 2, skip the marked pause
   before segment 3, and **rush segment 3, the key stat**. That one rushed line
   is the red tick the entire demo turns on.
3. **Spare** — a second rough take, because take 2 will drift.

Record early. The severity thresholds get tuned *to these files*, so P1 needs
them by h8 at the latest, and a re-record at hour 20 invalidates the tuning.

**h6-16 — integration and safety net**
- End-to-end test after every merge. You are the only person who runs the whole
  chain.
- Freeze a `FixtureSttClient` transcript from each recording. Demo runs offline
  on `STT_PROVIDER=fixture` if the venue wifi fails.

**h16-24 — the demo**
- Lock the recordings. After this point they do not change.
- Rehearse the 90-second script (SPEC §8) three times against the live URL.
- Record the fallback video against the live deploy.
- Assemble the deck (SPEC §10) from the working product, not from mockups.

**Done when:** live authed URL, deterministic demo path rehearsed 3x, fallback
video recorded, offline fixture mode proven.

---

## The five things that would sink this build

1. **The recordings arrive late.** Everything downstream is tuned to them.
   P4 starts recording at h3, not h12.
2. **Alignment is harder than it looks.** Transcript never matches script
   exactly. P1 keeps a dumb proportional fallback so the demo survives it.
3. **Milliseconds leak in from the vendor.** One conversion, in the STT adapter,
   at the boundary. CONVENTIONS §3.
4. **`main` goes red and stays red.** P4 owns it; nobody works around it.
5. **Nobody looks at Ops Canvas until hour 20.** The visible severity decision
   is scored item #1. P2 confirms the trace renders at h6, not at h20.
