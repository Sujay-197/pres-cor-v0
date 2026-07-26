import { describe, expect, it, vi } from 'vitest';
import { AuditInterceptor } from './audit.interceptor.js';

function ctx(toolName: string) {
  const logs: unknown[] = [];
  return {
    context: { toolName, logger: { info: (m: string, meta?: unknown) => logs.push(['info', m, meta]), error: (m: string, meta?: unknown) => logs.push(['error', m, meta]) } } as never,
    logs,
  };
}

describe('AuditInterceptor', () => {
  it('logs one ok line with tool + durationMs on success', async () => {
    const { context, logs } = ctx('parse_script');
    const out = await new AuditInterceptor().intercept(context, async () => ({ ok: true }));
    expect(out).toEqual({ ok: true });
    expect(logs.some(([lvl, m]) => lvl === 'info' && m === 'tool.call')).toBe(true);
  });
  it('logs an error line and rethrows on failure', async () => {
    const { context, logs } = ctx('suggest_next_step');
    await expect(new AuditInterceptor().intercept(context, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(logs.some(([lvl, m]) => lvl === 'error' && m === 'tool.call')).toBe(true);
  });
});
