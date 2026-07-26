import { InterceptorInterface, ExecutionContext, Injectable } from '@nitrostack/core';
import { mapCoachError } from './coach-exception.filter.js';

/** One metadata-only audit line per tool call. Never transcript text or keys. */
@Injectable()
export class AuditInterceptor implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
    const startedAt = Date.now();
    const tool = context?.toolName ?? 'unknown';
    try {
      const out = await next();
      context?.logger?.info?.('tool.call', { tool, durationMs: Date.now() - startedAt, outcome: 'ok' });
      return out;
    } catch (err) {
      context?.logger?.error?.('tool.call', {
        tool, durationMs: Date.now() - startedAt, outcome: 'error',
        errorCode: mapCoachError(err).body.error.code,
      });
      throw err;
    }
  }
}
