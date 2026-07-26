# Delivery-Correction Speech Coach MCP Server

> A NitroStack Model Context Protocol (MCP) server that corrects delivery mechanics against your own script using speech feature extraction, alignment, and agentic next-step recommendations.

---

## Overview

The **Delivery-Correction Speech Coach** analyzes audio recordings of rehearsals against a written markdown script. It extracts prosody and STT timestamps, aligns the spoken delivery to script segments, computes baseline metrics (WPM, pitch, pauses, fillers), detects pacing drifts or key-point rushes, and renders an interactive timeline widget with recommended next steps.

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Development Server

Start the MCP server with NitroStack dev tools:

```bash
npm run dev
```

To run the Next.js widget development server concurrently:

```bash
npm --prefix src/widgets run dev
```

---

## Testing & Typechecking

Run the full Vitest suite (includes golden end-to-end lock tests):

```bash
npm test
```

Run TypeScript strict type checking:

```bash
npm run typecheck
```

---

## Environment Configuration

Configuration is managed via `AppConfigService` which reads `process.env` once at startup and validates with Zod.

| Environment Variable | Allowed Values | Default | Description |
|---|---|---|---|
| `STT_PROVIDER` | `fixture`, `deepgram`, `assemblyai` | `fixture` | Speech-to-Text provider engine (`assemblyai` is stubbed) |
| `DEEPGRAM_API_KEY` | string | *(empty)* | API key required when `STT_PROVIDER=deepgram` |
| `ENABLE_PROSODY` | `true`, `false`, `1`, `0` | `true` | Pitch and energy extraction via `ffmpeg-static` |
| `AUDIO_MAX_SECONDS` | positive number | `180` | Maximum allowed audio duration in seconds |
| `UPLOAD_MAX_BYTES` | positive integer | `26214400` | Maximum allowed upload size (25MB) |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` | Server log output level |
| `JWT_SECRET` | string | *(empty)* | Enables Bearer JWT authentication on `suggest_next_step` |

> Secrets should be set in environment variables and never committed to source control.

---

## The 90-Second Demo in NitroStudio

To run the rehearsed SPEC §8 demo in NitroStudio's tool-invocation pane:

1. **Clean Take (Green Baseline)**
   - Call `analyze_delivery` with input:
     ```json
     {
       "takeId": "clean",
       "now": "2026-07-25T09:00:00Z"
     }
     ```
   - **Result:** The `delivery-timeline` widget renders with green ticks, 0 filler words, and a draft note recommendation.

2. **Rough Take (Red Flag on Rushed Key Stat)**
   - Call `analyze_delivery` with input:
     ```json
     {
       "takeId": "rough",
       "now": "2026-07-25T09:00:00Z"
     }
     ```
   - **Result:** One **red** high-severity tick appears on segment `seg-005` (the rushed key stat). Clicking the tick highlights the WPM mismatch against the speaker's baseline.

3. **Ops Canvas Inspection**
   - Inspect the `correlate_segments` output. Each issue includes a `DecisionTrace` showing the exact rule, observed metrics, and reasoning that triggered the severity level.

4. **Connector Execution Seam**
   - In the widget's `NextStepCard`, click **Set reminder** (for rough take) or **Open draft** (for clean take).
   - **Result:** The widget issues a discrete call to `suggest_next_step` with `execute: true`, triggering the connector action and returning an optimistic receipt.

5. **Summary Review**
   - View the overall summary card showing fillers, average WPM, and pace variance.

---

## NitroStack Architecture Overview

- **`@McpApp` / `@Module`**: Structured dependency injection (`AppModule`, `CoachModule`, `ConfigModule`, `JWTModule`).
- **`@Tool` Decorators**: Five discrete tools (`parse_script`, `transcribe_delivery`, `correlate_segments`, `generate_summary`, `suggest_next_step`) plus the composed `analyze_delivery` pipeline.
- **`@Widget('delivery-timeline')`**: Next.js 14 interactive UI binding `@nitrostack/widgets` `useWidgetSDK` to the report output.
- **`CoachExceptionFilter`**: Translates `CoachError` taxonomy into structured, client-safe error payloads without leaking diagnostic context.
- **`AuditInterceptor`**: Emits metadata-only audit logs for tool invocation timing and outcomes.
- **`NextStepGuard`**: Protects connector-firing actions with JWT verification.

---

## Graceful Degradation Note

Prosody extraction relies on `ffmpeg-static` to decode PCM audio. If the ffmpeg binary is missing or incompatible in the build environment, prosody analysis degrades gracefully to an empty track, logging a warning while allowing speech alignment and word-timing checks to proceed normally.
