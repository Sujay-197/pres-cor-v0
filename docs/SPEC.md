# SPEC.md — Delivery-Correction Speech Coach Agent

The locked build. Every team member + every AI agent reads this before opening
an editor. Pair with ARCHITECTURE_BRIEF.md for framework-level stack decisions.

Event: NitroStack × MCP To The Moon — 24h buildathon.
Judged by NitroStack engineers on live deployment + repo architecture.

## 1. What we're building (one breath)

Give it your script/notes + a recording of you delivering it. The agent
correlates what you SAID against what you PLANNED to say, flags filler words,
stress/intonation mismatches, and pacing drift against your own script's
emphasis points, and returns a structured, timestamped summary.

Pitch one-liner: "It doesn't score your confidence — it corrects your delivery
mechanics against your own script: fillers, pacing, and where your stress points
land versus where they should."

## 2. Why this framing (not confidence-coaching)

Confidence is built by talking to real people, not bots — a "confidence score"
from an agent is an overclaim we can't back up and shouldn't market. Delivery
mechanics are different: filler count, pacing drift, and stress/emphasis
mismatch against a script are FALSIFIABLE, checkable facts. The agent never
claims to build a soft skill. It corrects concrete, correctable mechanics.

Design principle carried from earlier discussion: the agent's last action
should always point TOWARD real human practice, never substitute for it. Baked
into this spec as an explicit closing action (see Tool 5 / connectors below),
not just a caveat.

## 3. Why it needs an agent (not a transcript diff)

Per segment of the delivery, the agent DECIDES whether a deviation matters —
this requires cross-referencing two signals (script + delivery), not a
single-pass transcript diff:

- Filler word in a low-stakes transition -> note it, low priority.
- Rushed pacing + rising pitch on your KEY claim/data point (per the script's
  marked emphasis) -> flag high-priority: this is where you undermine your own
  point.
- Long pause before a line -> check: intentional (script marks a pause) vs
  uncertain (no marker) -> different verdicts.

Branch point (the whole game): for each flagged deviation, the agent decides
severity by correlating WHERE it happened against WHAT the script says should
happen there. Tools are deterministic (speech features, alignment); the
decision of what matters is the agentic part.

## 4. Tool chain

1. parse_script — script/notes -> structured segments with emphasis markers
   (what's the key point per section, any marked pauses). Pure-logic.
2. transcribe_delivery — audio -> timestamped transcript + prosody features
   (pitch, pace/WPM, pauses, volume). Wraps a speech-to-text + prosody model
   inside the @Tool.
3. correlate_segments — THE BRANCH TOOL: aligns delivery timestamps to script
   segments, flags filler density, pacing drift, stress-point mismatches ->
   decides severity per issue (low / medium / high).
4. generate_summary — structured report: timestamped issues grouped by type
   (fillers / pacing / stress-mismatch), each with the specific script line.
5. suggest_next_step — the closing agentic action. Decides: if a calendar event
   (interview/presentation) is coming up, surface this report timed before it;
   otherwise offer to draft a note to a mentor/friend asking them to watch the
   next attempt. This is the explicit "push toward real human practice" step.

## 5. Frozen schemas — LOCK AT HOUR 1

The contract. Freeze before anyone codes. Schema changes = only thing needing
full-team sign-off.

    type IssueType = 'filler' | 'pacing' | 'stress_mismatch' | 'pause';
    type Severity = 'low' | 'medium' | 'high';

    interface ScriptSegment {
      id: string;
      text: string;
      isKeyPoint: boolean;
      markedPause: boolean;
    }

    interface DeliveryIssue {
      id: string;
      type: IssueType;
      severity: Severity;
      timestamp: number;       // seconds into the recording
      segmentId: string;       // links back to ScriptSegment
      detail: string;          // e.g. "180 WPM vs your 130 WPM average"
    }

    interface DeliveryReport {
      segments: ScriptSegment[];
      issues: DeliveryIssue[];
      fillerCount: number;
      avgPaceWpm: number;
      status: 'analyzing' | 'ready';
    }

## 6. Hero widget — the delivery timeline

Timeline scrubber of the recording, script text below it, issues marked as
colored ticks on the timeline:
  - green tick = clean segment
  - amber tick = medium severity (filler/pacing drift)
  - red tick = high severity (stress-point mismatch on a key claim)

Click a tick -> jumps to that moment, shows the script line + what happened
(e.g. "rushed - 180 WPM vs your 130 WPM average, right on your key stat").

Ends in a summary card: filler count, pacing variance, top 3 moments to fix,
and the suggest_next_step action (calendar-timed surfacing or draft-a-note
button).

Built with @nitrostack/widgets (React), against the frozen schema above.
Whoever owns the widget builds it against mock JSON matching this shape from
hour 0 — never blocked on the server being real.

## 7. Architecture

    Host (Claude / NitroChat)        <- orchestrates the loop (the brain)
          |  MCP
    NitroStack server                <- our capability layer (the hands)
       parse_script                    (pure-logic)
       transcribe_delivery             (speech/prosody model in @Tool)
       correlate_segments              (the branch tool - severity decisions)
       generate_summary
       suggest_next_step ---+
                             |  + audit-logging interceptor on every call
       (compose Calendar/Gmail connectors for the closing action)
          |
       Speech-to-text + prosody model (inside transcribe_delivery only)
       + our correlation/severity logic (deterministic)
       -> Delivery Timeline widget in host
       -> Deployed on NitroCloud, tested in NitroStudio (Ops Canvas = agent trace)

Model lives mostly in the host; only transcribe_delivery calls a speech model
internally (keep the client swappable via env var). Every other tool is
deterministic - no LLM calls in the reasoning-heavy correlate_segments step,
which keeps that decision auditable and explainable.

NitroStack surfaces we deliberately use (judge-alignment):
@Tool + Zod on every tool - audit-logging interceptor on every call (esp.
suggest_next_step, since it triggers real connector actions) - widgets (the
timeline) - compose Calendar/Gmail connectors for the closing action - NitroCloud
deploy-on-push - Ops Canvas as the visible agent trace (this is where the judge
watches it decide severity per issue).

## 8. Demo script (90 seconds)

1. Load a short script + play a clean rehearsed take -> mostly green ticks,
   low filler count. "Solid baseline."
2. Load the SAME script + a rougher take (some fillers, one rushed key-claim
   moment) -> ticks populate live, one goes red exactly on the key stat.
   Click it -> shows script line + the WPM mismatch.
3. Flip to Ops Canvas: show correlate_segments deciding severity per issue -
   most fillers get low priority, the one on the key claim gets flagged high.
   That's the agentic decision, visible.
4. Show suggest_next_step: an upcoming calendar event detected -> report
   surfaced with timing, OR a drafted note to a mentor asking them to watch
   the next attempt. "It points you back to a real person, not itself."
5. Land on the summary card.

HARD RULE: prepare 2-3 known recordings in advance (one clean, one with
deliberate rough spots on a specific line) so ticks fire deterministically on
stage. Rehearse the exact clips 3x. Record a fallback video.

## 9. Data readiness - excellent

You supply your own script + record your own delivery. Fully rehearsable, zero
live external dependency for the core loop. Speech-to-text + prosody extraction
(pitch/pace/pause) are well-trodden and wrappable from an existing API. Same
build shape as a confidence-gated extraction pipeline (parse -> analyze ->
correlate -> decide -> summarize) - a pattern this team has already validated,
just pointed at a new domain.

## 10. Pitch deck (<=6 slides, <=8 words/slide)

1 Title + one-liner
2 Problem + why-agentic ("corrects mechanics against YOUR script, not a vibe score")
3 * LIVE DEMO (placeholder slide - the demo is the content)
4 Architecture diagram (names the NitroStack surfaces)
5 What's real: live URL, authed, severity-decision trace, connector closing action
6 Team + ask (internship pipeline)

Two visuals only: static architecture (system) + live Ops Canvas (runtime,
the severity decision). Visually rich, verbally lean.

## 11. Confirm at kickoff

- [ ] Which provider the frontier-AI credits are for (speech/prosody model)
- [ ] Which host judges demo in - NitroChat vs Claude/ChatGPT
- [ ] Using our own Calendar/Gmail connectors for the demo is fine (yes -
      we control the accounts)
- [ ] Public showcase gallery? (only then does a landing page matter)

## Why this framing is the right one

It replaces an unfalsifiable claim (confidence) with checkable facts (fillers,
pacing, stress-mismatch), which makes it both more honest and easier to demo
convincingly - a judge can verify the flags against the script themselves.
The closing action (suggest_next_step) turns the "always point back to real
human practice" design principle into an actual product feature instead of a
caveat, and gives us our real connector-driven agentic proof point.
