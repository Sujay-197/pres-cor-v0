// apps/server/src/http.ts
//
// Design §7. /api/tools/:name is the NitroStack-shaped surface: one named tool,
// its own schema, one call. Under NitroStack these become @Tool methods and
// this route disappears; /api/analyze is replaced by the host model's own
// orchestration.

import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { describeConfig } from './config.js';
import { withAudit } from './audit.js';
import { mapError } from './errors.js';
import {
  listTakes,
  resolveTakeAudio,
  uploadFilenameFor,
  uploadTakeId,
} from './takes.js';
import { AnalyzeInput, analyze, type ServerDeps } from './pipeline.js';
import { ParseScriptInput, parseScriptTool } from './tools/parse-script.tool.js';
import { TranscribeDeliveryInput, transcribeDeliveryTool } from './tools/transcribe-delivery.tool.js';
import { CorrelateSegmentsInput, correlateSegmentsTool } from './tools/correlate-segments.tool.js';
import { GenerateSummaryInput, generateSummaryTool } from './tools/generate-summary.tool.js';
import { SuggestNextStepInput, suggestNextStepTool } from './tools/suggest-next-step.tool.js';

type ToolHandler = (body: unknown, deps: ServerDeps) => Promise<unknown>;

const TOOLS: Record<string, { takeIdOf: (body: unknown) => string | null; run: ToolHandler }> = {
  parse_script: {
    takeIdOf: () => null,
    run: async (body) => parseScriptTool(ParseScriptInput.parse(body)),
  },
  transcribe_delivery: {
    takeIdOf: (body) => TranscribeDeliveryInput.parse(body).takeId,
    run: (body, deps) => transcribeDeliveryTool(TranscribeDeliveryInput.parse(body), deps),
  },
  correlate_segments: {
    takeIdOf: () => null,
    run: async (body) => correlateSegmentsTool(CorrelateSegmentsInput.parse(body)),
  },
  generate_summary: {
    takeIdOf: () => null,
    run: async (body) => generateSummaryTool(GenerateSummaryInput.parse(body)),
  },
  suggest_next_step: {
    takeIdOf: (body) => SuggestNextStepInput.parse(body).takeId,
    run: (body, deps) => suggestNextStepTool(SuggestNextStepInput.parse(body), deps),
  },
};

export const TOOL_NAMES: readonly string[] = Object.keys(TOOLS);

/**
 * `TOOLS` is a plain object literal, so it inherits from Object.prototype:
 * `TOOLS['constructor']`, `TOOLS['__proto__']`, `TOOLS['toString']` etc. all
 * resolve to something other than `undefined` via bracket access even though
 * none of them is an own, registered tool. `Object.hasOwn` makes the allow-list
 * explicit instead of relying on "happens to be undefined" as the guard.
 */
function lookupTool(name: string): (typeof TOOLS)[string] | undefined {
  return Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
}

function sendNotFound(res: Response, message: string): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message } });
}

/**
 * A schema rejection is an HTTP concern, not a CoachError, so it is handled
 * here and mapError stays exactly the design §10 table.
 */
function sendError(res: Response, err: unknown, deps: ServerDeps): void {
  if (err instanceof z.ZodError) {
    deps.log('warn', 'request.invalid', { fields: err.issues.map((i) => i.path.join('.')) });
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } });
    return;
  }
  const mapped = mapError(err);
  // Design §10: the full detail and the CoachError context are logged here and
  // never returned. This is the request log, not the metadata-only audit line.
  deps.log('error', 'request.failed', {
    status: mapped.status,
    code: mapped.body.error.code,
    detail: mapped.logMessage,
    context: mapped.logContext,
  });
  res.status(mapped.status).json(mapped.body);
}

/**
 * express.json() (body-parser) throws BEFORE any route's try/catch can see
 * it, so a malformed or oversized request body would otherwise reach
 * Express's default error handler — which, in the default 'development' env,
 * echoes `err.stack` (vendor/internal detail, absolute node_modules paths)
 * straight into the HTTP response. Recognised here so the terminal error
 * middleware in createApp can answer with the mandated envelope instead.
 */
function bodyParserErrorStatus(err: unknown): 400 | 413 | null {
  if (typeof err !== 'object' || err === null) return null;
  const type = (err as { type?: unknown }).type;
  if (type === 'entity.too.large') return 413;
  if (type === 'entity.parse.failed') return 400;
  if (err instanceof SyntaxError && 'body' in err) return 400;
  return null;
}

/**
 * `.pipe()` only attaches its error handler to the DESTINATION; a read-stream
 * error (file removed after statSync, EACCES, EMFILE from too many concurrent
 * seeks) has no listener on the source and throws as an uncaught exception,
 * which the surrounding route try/catch cannot see because it only wraps the
 * synchronous call that kicks the stream off. `pipeline` also destroys both
 * ends the moment either side closes early — which is exactly what happens on
 * every scrubber seek that aborts an in-flight range request — so a burst of
 * seeks cannot leak a file descriptor per abort.
 */
function pipeAudio(source: NodeJS.ReadableStream, res: Response, deps: ServerDeps): void {
  pipeline(source, res, (err) => {
    if (err !== null && err !== undefined) {
      deps.log('warn', 'audio.stream_error', {
        code: (err as NodeJS.ErrnoException).code ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function serveAudio(req: Request, res: Response, deps: ServerDeps): void {
  const takeId = req.params['takeId'] ?? '';
  const found = resolveTakeAudio(deps.audioDir, deps.uploadDir, takeId);
  if (found === null) {
    sendNotFound(res, `No audio for take "${takeId}".`);
    return;
  }

  const size = statSync(found.path).size;
  res.setHeader('Content-Type', found.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range === undefined) {
    res.setHeader('Content-Length', String(size));
    pipeAudio(createReadStream(found.path), res, deps);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const startRaw = match?.[1] ?? '';
  const endRaw = match?.[2] ?? '';

  let start: number;
  let end: number;
  if (match === null || (startRaw === '' && endRaw === '')) {
    start = NaN;
    end = NaN;
  } else if (startRaw === '') {
    const suffix = Number(endRaw);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(end - start + 1));
  pipeAudio(createReadStream(found.path, { start, end }), res, deps);
}

export function createApp(deps: ServerDeps): Express {
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  // memoryStorage plus a fileSize limit: multer aborts at the limit and nothing
  // reaches the disk until the handler explicitly writes it (design §11).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.config.uploadMaxBytes, files: 1 },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ...describeConfig(deps.config) });
  });

  app.get('/api/takes', (_req, res) => {
    res.json({ takes: listTakes(deps.audioDir, deps.uploadDir, deps.fixtureDir) });
  });

  app.get('/api/audio/:takeId', (req, res) => {
    try {
      serveAudio(req, res, deps);
    } catch (err) {
      sendError(res, err, deps);
    }
  });

  app.post('/api/uploads', (req, res) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: {
            code: 'UPLOAD_TOO_LARGE',
            message: `Upload exceeds the ${deps.config.uploadMaxBytes} byte limit.`,
          },
        });
        return;
      }
      if (err !== null && err !== undefined) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Upload could not be parsed.' } });
        return;
      }

      const file = req.file;
      if (file === undefined) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Expected one file field named "file".' } });
        return;
      }

      const takeId = uploadTakeId(file.buffer);
      const filename = uploadFilenameFor(takeId, file.originalname);
      if (filename === null) {
        res.status(415).json({ error: { code: 'AUDIO_UNREADABLE', message: 'Unsupported audio container.' } });
        return;
      }

      mkdirSync(deps.uploadDir, { recursive: true });
      writeFileSync(join(deps.uploadDir, filename), file.buffer);
      deps.log('info', 'upload.stored', { takeId, bytes: file.buffer.byteLength });
      res.json({ takeId });
    });
  });

  app.post('/api/analyze', async (req, res) => {
    try {
      const input = AnalyzeInput.parse(req.body);
      const known = listTakes(deps.audioDir, deps.uploadDir, deps.fixtureDir).some((t) => t.id === input.takeId);
      if (!known) {
        sendNotFound(res, `Unknown take "${input.takeId}".`);
        return;
      }
      res.json(await analyze(input, deps));
    } catch (err) {
      sendError(res, err, deps);
    }
  });

  app.post('/api/tools/:name', async (req, res) => {
    const name = req.params['name'] ?? '';
    const tool = lookupTool(name);
    if (tool === undefined) {
      sendNotFound(res, `Unknown tool "${name}".`);
      return;
    }
    try {
      const takeId = tool.takeIdOf(req.body);
      const out = await withAudit({ tool: name, takeId }, deps.log, () => tool.run(req.body, deps));
      res.json(out);
    } catch (err) {
      sendError(res, err, deps);
    }
  });

  // Catch-all: any path/method that didn't match a route above gets the
  // mandated envelope instead of Express's default HTML "Cannot GET /x" page.
  app.use((req, res) => {
    sendNotFound(res, `No route for ${req.method} ${req.path}.`);
  });

  // Terminal error handler. Must be registered last and keep all four
  // parameters (Express dispatches by handler arity) so a body-parser
  // SyntaxError/entity.too.large — or anything else thrown before a route's
  // own try/catch could see it — lands here instead of Express's default
  // handler, which in the default 'development' env echoes `err.stack`
  // straight into the response body (design §10: internal detail never
  // crosses the boundary).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const bodyParserStatus = bodyParserErrorStatus(err);
    if (bodyParserStatus !== null) {
      deps.log('warn', 'request.invalid', { status: bodyParserStatus, source: 'body-parser' });
      if (bodyParserStatus === 413) {
        res
          .status(413)
          .json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'Request body exceeds the allowed size.' } });
      } else {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } });
      }
      return;
    }
    sendError(res, err, deps);
  });

  return app;
}
