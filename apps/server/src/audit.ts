// apps/server/src/audit.ts
//
// Design §12: one audit line per tool call — { tool, takeId, durationMs,
// outcome, errorCode? } — at info level. METADATA ONLY. Never transcript text,
// never script content, never the API key.

import { mapError } from './errors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(
  minLevel: LogLevel,
  sink: (line: string) => void = (line) => console.log(line),
): Logger {
  return (level, message, meta) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, message, ...(meta ?? {}) }));
  };
}

export interface AuditMeta {
  tool: string;
  takeId: string | null;
}

export async function withAudit<T>(
  meta: AuditMeta,
  log: Logger,
  fn: () => Promise<T> | T,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const out = await fn();
    log('info', 'tool.call', {
      tool: meta.tool,
      takeId: meta.takeId,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });
    return out;
  } catch (err) {
    // mapError gives us the stable code without touching the message, so the
    // audit line stays free of user content.
    log('error', 'tool.call', {
      tool: meta.tool,
      takeId: meta.takeId,
      durationMs: Date.now() - startedAt,
      outcome: 'error',
      errorCode: mapError(err).body.error.code,
    });
    throw err;
  }
}
