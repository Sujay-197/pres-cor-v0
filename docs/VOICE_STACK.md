# VOICE_STACK.md — what we actually integrate for audio

"Voice" is not one integration. It is five layers, and only **one** of them is a
vendor decision. Naming them separately is what stops us from shopping for a
magic API that does prosody analysis (there isn't one) or from paying a vendor
for something a word-timestamp array already gives us for free.

| # | Layer | What it produces | Decision |
|---|-------|------------------|----------|
| 1 | Capture / upload | an audio file | Browser `MediaRecorder` + file upload. No dependency. |
| 2 | Decode / normalise | 16 kHz mono PCM | `ffmpeg-static` + `fluent-ffmpeg`. |
| 3 | Speech-to-text | words + timestamps + fillers | **Deepgram Nova-3.** The one vendor. |
| 4 | Prosody | pitch, energy, pauses, WPM | **We build it.** Pure TS, P1 owns it. |
| 5 | Playback | the timeline scrubber | HTML5 `<audio>`. No dependency. |

## Layer 3 — Deepgram Nova-3 is the pick

Two features decide this, and both map straight onto our schema:

**Word-level timestamps are returned by default.** Deepgram's `words` array
carries `start`, `end`, and `confidence` per word with no special parameter.
That array alone gives us three of our four issue types for free — pauses are
gaps between `end[i]` and `start[i+1]`, WPM is a word count over a time window,
and segment alignment is a text match over the word sequence. No DSP required
for any of it.

**`filler_words=true` returns fillers as real tokens.** By default Deepgram
strips "uh" and "um" to make transcripts readable; set the flag and they come
back in-line with their own timestamps. Supported on Nova, Nova-2 and Nova-3
general models. `filler` is one of our four `IssueType`s — this is a query
parameter doing a feature's work.

    curl -X POST \
      -H 'Authorization: Token $DEEPGRAM_API_KEY' \
      -H 'Content-Type: audio/wav' \
      --data-binary @take.wav \
      'https://api.deepgram.com/v1/listen?model=nova-3&filler_words=true&utterances=true'

Cost is not a factor at our volume — batch Nova-3 runs about $0.0043/min, so
every rehearsal we will do across the whole 24 hours costs well under a dollar,
and there is a sizeable free credit on signup.

### Why not the obvious alternatives

**Whisper (OpenAI or Groq) is actively wrong for this build.** Whisper is
trained to produce clean, readable transcripts, which means it *removes*
disfluencies by design. Our entire filler-detection feature is a thing Whisper
is built to delete. Word-level timestamps also need
`timestamp_granularities: ["word"]` and are less precise than Deepgram's. Do not
use it as primary, however familiar it is.

**AssemblyAI is the backup, and it is a good one.** It has word-level timestamps
as standard and a `disfluencies` option covering the same ground. Universal-2
async is ~$0.15/hr. The reason it is second and not first is only that Deepgram's
filler handling is a documented first-class feature rather than a transcription
option. Because `SttClient` normalises both to the same `Transcript` type,
swapping is an env var, so the cost of being wrong here is near zero — which is
exactly why we should not spend kickoff arguing about it.

**ElevenLabs Scribe** is strong on word timings and audio events but we do not
need audio events, and it is a heavier lift for no gain here.

## Layer 4 — prosody: we build this, and that's the right call

There is no good hosted API for "give me pitch and energy contours". The serious
options are Python (`librosa`, `praat-parselmouth`), and standing up a Python
sidecar next to a TypeScript MCP server at hour 3 of 24 is how a demo dies.

We do not need one. Split prosody by what it actually requires:

**Free from the word timestamps — no signal processing at all:**
- pauses (gap between consecutive words, threshold 0.35s per CONVENTIONS §4)
- WPM, per segment and overall
- pace drift versus the speaker's own baseline

That is `pause`, `pacing`, and `filler` — three of our four issue types, with
zero DSP and zero vendor beyond Deepgram.

**Needs real DSP — only for `stress_mismatch`:**
- RMS energy envelope: sum of squares over a 25 ms window, 10 ms hop. About
  fifteen lines of TypeScript over a `Float32Array`.
- Fundamental frequency (f0): the `pitchfinder` npm package ships YIN and AMDF.
  Feed it the same frames, take the median of voiced frames per segment.

Both are pure functions over a `Float32Array`, which means prosody lands in
`packages/core-logic` as `extractProsody()` — unit-testable against a synthesised
sine wave, no network, no vendor, no Python. This is a genuine advantage rather
than a compromise: the reasoning-heavy part of our system stays deterministic and
auditable, which is precisely the claim ARCHITECTURE_BRIEF §2 makes about why
this build is agentic rather than automated.

**Degrade honestly.** If a segment has no voiced frames, `meanF0` is null and we
skip `stress_mismatch` for it rather than inventing a number. CONVENTIONS §6.

## What to integrate, in order

1. `ffmpeg-static` + `fluent-ffmpeg` — decode anything to 16 kHz mono PCM.
2. `@deepgram/sdk` — layer 3, behind the `SttClient` interface.
3. `pitchfinder` — layer 4 pitch only. Everything else is hand-written.
4. Nothing else. No wavesurfer, no Python, no audio framework.

## Accounts and keys needed at kickoff

- **Deepgram API key** — free credit is enough for the whole build. Get this in
  the first ten minutes; it is the only blocking signup.
- **AssemblyAI key** — optional, 5 minutes, only if we want the swap proven live.
- **Google Calendar + Gmail** connector auth on our own accounts, for
  `suggest_next_step` (SPEC §11 already confirms using our own accounts is fine).

Open item from SPEC §11 that this doc does *not* settle: if the hackathon's
frontier-AI credits are with a provider that includes speech (e.g. an OpenAI
credit), we should still not use Whisper as primary for the filler reason above.
Take the credits, spend them on the host model, keep Deepgram for STT.

---

Sources:
- [Deepgram — Filler Words](https://developers.deepgram.com/docs/filler-words)
- [Deepgram — Pre-recorded feature overview](https://developers.deepgram.com/docs/stt-pre-recorded-feature-overview)
- [Deepgram — Working with timestamps and utterances](https://deepgram.com/learn/working-with-timestamps-utterances-and-speaker-diarization-in-deepgram)
- [Deepgram Nova-3 pricing breakdown](https://convertaudiototext.com/blog/deepgram-nova-3-explained)
- [AssemblyAI pricing](https://www.assemblyai.com/pricing)
- [Speech-to-text API comparison, 2026](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/)
