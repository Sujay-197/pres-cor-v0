# ARCHITECTURE_BRIEF.md — NitroStack Buildathon Context

Read this before SPEC.md. This is the framework-level, tool-access-aware
context every teammate needs regardless of which of you touches which part.
Project-specific build (tool chain, schema, demo script) lives in SPEC.md.

Event: NitroStack x MCP To The Moon - 24h build sprint. Judged by NitroStack
engineers on live deployment + repo architecture.

## 1. What NitroStack is

A full-stack TypeScript framework for building, testing, and deploying
production MCP (Model Context Protocol) servers. NestJS-inspired: decorators,
DI, middleware, Zod validation.

It is NOT an agent framework and NOT a model provider. It's the CAPABILITY
LAYER - the standardized, typed, authenticated interface that exposes your
tools/data to any MCP-aware AI host (Claude, ChatGPT, NitroChat).

    Orchestration layer (the BRAIN)   ->  the AI host
          |  MCP protocol                 decides WHAT to call, WHEN, based on results
    Capability layer (the HANDS)      ->  our NitroStack server
          |                               tools / resources / widgets + auth
    External APIs / DB / models

The host supplies agency. NitroStack is how we build the capabilities it
reasons over. This is why most of our tools should contain ZERO LLM calls -
the host is the model; our tools do deterministic work.

## 2. The core design rule: agentic, not automation

Agency lives in the ORCHESTRATION, not in the tools.
  Deterministic tools + model-driven control flow = AGENTIC
  Deterministic tools + hardcoded control flow    = AUTOMATION

Our tools are deterministic. What makes the system agentic is that the host
model DECIDES which tool to call next based on each result - and, in our
specific build, one tool (correlate_segments) makes its own severity
DECISIONS by cross-referencing two signals. See SPEC.md section 3 for the
exact branch point.

Every idea we build must have:
  1. Composable tools (one tool's output feeds another's input)
  2. An open-ended task (the path depends on intermediate results)
  3. A REAL branch point (visible on Ops Canvas)
  4. Real connector actions as the closing step (proves it's agentic, not a
     single tool call - this is what judges are explicitly checking for)

## 3. The stack, layer by layer

BACKEND: NitroStack MCP server, TypeScript. Tools via @Tool, data via
@Resource. Wire with DI + modules - this is what earns the repo-architecture
score. Keep tools single-responsibility.

LLM/MODELS: NitroStack ships no models - fully model-agnostic. Models come
from (a) the host running the orchestration, (b) hackathon frontier-AI
credits, (c) our own key only inside a tool doing internal reasoning (in our
build: the speech/prosody model inside transcribe_delivery). Keep any model
client swappable via env var. Don't put an LLM call where the host can reason
instead.

AUTH & VALIDATION: Zod schemas on every tool - non-negotiable, cheap, and how
the host understands our tools. Auth guard (OAuth 2.1 / JWT) on any tool that
triggers a real-world action (our suggest_next_step, since it can send a
message or touch a calendar). Audit-logging interceptor on every call - cheap,
~20 min, reads as production-real to the judges (who wrote this framework).

FRONTEND: The judged surface is the WIDGET rendered inside the conversation,
not a landing page. One hero widget only (our delivery timeline). No
marketing site needed - submission is repo + live deploy.

TOOL SOURCING - three buckets:
  - Wrap: thin @Tool around a vendor SDK (our speech-to-text/prosody model).
    ~20-30 min each.
  - Compose: connect an EXISTING MCP server instead of rebuilding (Gmail,
    Calendar - this is our connector proof for "agentic, not a tool call").
  - Pure logic: parse_script, correlate_segments, generate_summary - no
    external dependency, fastest to build and test.

DEPLOY: NitroCloud, deploy-on-push. Get a thin slice live early - low effort,
big payoff (works on the judge's machine when half the room's demo breaks).

## 4. Build process - matched to our actual tool access

We are not evenly equipped, so we split by TOOL, not by generic role:

  - One teammate has Claude Code. Claude Code is fast and reliable for plain,
    framework-agnostic TypeScript - it has thin knowledge of NitroStack's
    exact decorator/DI syntax (niche framework, sparse training data), so
    don't use it to write NitroStack-specific code directly.
  - Three teammates have NitroStudio credits. NitroStudio is where NitroStack
    code actually gets scaffolded, tested, and validated - CLI generators,
    tool inspector, Ops Canvas.

The resulting rule: DETERMINISTIC LOGIC gets written as plain, portable TS
functions (Claude Code, fast iteration, unit-testable, e.g.
parseScript(), correlateSegments(), scoreSeverity()). NITROSTACK GLUE - the
thin @Tool/@Resource wrapper, auth guards, interceptors - gets scaffolded via
NitroStudio's CLI generators, not hand-typed from scratch or vibe-coded blind.
TOOL-CALLING itself gets validated in NitroStudio's tool inspector (not
Postman - Postman can hit an HTTP endpoint, it can't simulate a host model
choosing when and why to call a tool, which is the layer that actually
matters for MCP).

The seam between these two halves is the function signature, not just the
data schema - freeze both together at hour 1 (see SPEC.md section 5, and the
signature list in section 5 below).

## 5. Team split

Split by TOOL ACCESS + INTERFACE BOUNDARY, not generic feature ownership.

  P1 (Claude Code) - Logic owner. Writes parse_script, transcribe_delivery's
  processing logic, correlate_segments (the branch/severity logic),
  generate_summary as plain TS functions against the frozen schema (SPEC.md
  section 5) and frozen function signatures (agree these at hour 1 alongside
  the schema, e.g. correlateSegments(transcript, script): DeliveryIssue[]).
  Output is a portable library, testable in isolation, zero NitroStack
  dependency.

  P2 (NitroStudio) - Scaffold + connectors owner. Uses CLI generators to
  scaffold @Tool/@Resource shells matching P1's planned signatures, wires the
  speech/prosody model wrap inside transcribe_delivery, sets up auth guard +
  audit interceptor, and composes the Calendar/Gmail connectors for
  suggest_next_step.

  P3 (NitroStudio) - Widget owner. Builds the delivery timeline widget against
  MOCK JSON matching the frozen DeliveryReport schema. Never blocked on P1 or
  P2 - starts hour 0.

  P4 (NitroStudio) - Deploy/demo owner. NitroCloud pipeline from hour 1,
  integration testing once P1's logic lands in P2's shells (~hour 4-6 merge
  point), prepares the 2-3 curated demo recordings (SPEC.md section 8), owns
  the live rehearsal and fallback video, and owns main merges.

MERGE POINT (~hour 4-6): P1's finished functions drop into P2's @Tool shells -
a copy-paste-shaped integration, not a rebuild, because signatures were frozen
at hour 1.

## 6. Timeline (24h)

    h0-1    Freeze DeliveryReport/Issue schema + function signatures together.
            P3 starts widget against mock JSON immediately.
    h1-4    P1 builds core logic functions + tests. P2 scaffolds @Tool shells
            + connector wiring in parallel (empty bodies matching signatures).
            P4 sets up NitroCloud pipeline.
    h4-6    MERGE POINT: P1's functions drop into P2's shells. Validate
            tool-calling in NitroStudio's tool inspector.
    h6-8    Thin end-to-end slice DEPLOYED live on NitroCloud, authed.
    h8-16   Full tool chain incl. suggest_next_step connector actions. Wire
            widget to real tool output. Audit interceptor confirmed on every call.
    h16-20  Polish timeline widget, curate + lock the 2-3 demo recordings,
            harden the demo path. Assemble deck from the working product.
    h20-24  Rehearse the live demo 3x. Record fallback video. Buffer for breakage.

Scope test: if the core loop isn't buildable-and-deployable in ~6 focused
hours, cut something. Working-but-shallow beats ambitious-but-broken.

## 7. Differentiation checklist (what judges are actually scoring)

  [ ] Visible branch point on Ops Canvas (correlate_segments deciding severity)
  [ ] Real connector action as closing step (Calendar/Gmail via
      suggest_next_step) - THE explicit proof this is agentic, not a tool call
  [ ] One hero widget (delivery timeline, color-coded)
  [ ] Live authed deploy on NitroCloud
  [ ] Audit-logging interceptor (governance signal, cheap)
  [ ] Architecture diagram naming the NitroStack surfaces used (repo score)

Confirm at kickoff: credits provider for the speech/prosody model; which host
judges demo in (NitroChat vs Claude/ChatGPT); using our own Calendar/Gmail
accounts for the demo is fine; whether a public showcase gallery exists (only
then does a landing page matter).
