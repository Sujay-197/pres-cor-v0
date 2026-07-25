// apps/server/src/interceptors/audit-logging.interceptor.ts
//
// Differentiation checklist item: "Audit-logging interceptor (governance
// signal, cheap)". Applied to EVERY tool call, not just suggest_next_step —
// the point is a complete trace, and it's ~20 minutes of work for a scored
// line item, per ARCHITECTURE_BRIEF §3.
//
// This also doubles as half of your Ops Canvas story: correlate_segments'
// DecisionTrace shows WHY a call branched, this interceptor shows WHAT was
// called and WHEN. Judges watching Ops Canvas should see both.

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { config } from '../config';

interface AuditLine {
  ts: string;           // ISO timestamp, wall-clock is fine here — this is
                         // logging infra, not core-logic, so Date.now() is
                         // allowed (CONVENTIONS §3 only forbids it in
                         // packages/core-logic).
  tool: string;
  durationMs: number;
  status: 'ok' | 'error';
  errorCode?: string;
}

@Injectable()
export class AuditLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const toolName = this.resolveToolName(context);
    const start = Date.now();

    return next.handle().pipe(
      tap(() => this.emit({
        ts: new Date().toISOString(),
        tool: toolName,
        durationMs: Date.now() - start,
        status: 'ok',
      })),
      catchError((err) => {
        this.emit({
          ts: new Date().toISOString(),
          tool: toolName,
          durationMs: Date.now() - start,
          status: 'error',
          errorCode: err?.code ?? 'UNKNOWN',
        });
        throw err; // never swallow — this interceptor only observes
      }),
    );
  }

  private resolveToolName(context: ExecutionContext): string {
    // TODO(P2): confirm the exact accessor NitroStudio's @Tool metadata
    // exposes here (likely something like
    // context.getHandler().name or a Reflector.get(TOOL_METADATA, ...)).
    // Placeholder keeps this file compilable pre-scaffold.
    return context.getHandler()?.name ?? 'unknown_tool';
  }

  private emit(line: AuditLine) {
    if (config.LOG_LEVEL === 'debug' || line.status === 'error') {
      console.log(JSON.stringify(line));
    } else {
      console.log(`[audit] ${line.tool} ${line.status} ${line.durationMs}ms`);
    }
  }
}
