# Delivery-Correction Speech Coach Agent

NitroStack × MCP To The Moon — 24h buildathon.

Give it your script and a recording of you delivering it. The agent correlates
what you **said** against what you **planned** to say, and returns timestamped,
falsifiable corrections: filler words, pacing drift, and whether your stress
points landed where the script says they should.

It does not score your confidence. It corrects delivery mechanics against your
own script — and its closing action points you back toward a real human to
rehearse with, rather than toward itself.

## Read in this order

1. [`docs/ARCHITECTURE_BRIEF.md`](docs/ARCHITECTURE_BRIEF.md) — what NitroStack
   is, and the agentic-vs-automation rule the whole build turns on.
2. [`docs/SPEC.md`](docs/SPEC.md) — the locked build: tool chain, schema, demo.
3. [`CONVENTIONS.md`](CONVENTIONS.md) — the common structure. Units, IDs,
   determinism, error handling, how to change the contract.
4. [`packages/contracts/src/index.ts`](packages/contracts/src/index.ts) — the
   contract itself. The one file all four workstreams share.

Then your own plan in [`docs/TEAM_PLANS.md`](docs/TEAM_PLANS.md), and
[`docs/VOICE_STACK.md`](docs/VOICE_STACK.md) for the audio decisions.

## Layout

    packages/contracts     THE SEAM — types, Zod, frozen signatures, fixtures
    packages/core-logic    P1 · pure TypeScript, zero NitroStack
    packages/widget        P3 · delivery timeline
    apps/server            P2 · NitroStack MCP server, thin @Tool shells
    fixtures/audio         P4 · curated demo recordings
    scripts/               shared tooling

The rule that holds it together: **`core-logic` never imports the server, and
the server never contains logic worth unit-testing.**

## Getting started

```bash
npm install
```

Then confirm the contract typechecks:

```bash
npm run typecheck
```

P3 needs neither — the fixtures in `packages/contracts/fixtures/` are
schema-exact and can be imported directly from hour zero.

## Status

Hour 0 — scaffolding. The contract is drafted and awaiting the hour-1 freeze
(see the gate at the top of [`docs/TEAM_PLANS.md`](docs/TEAM_PLANS.md)).
