import { describe, expect, it } from 'vitest';
import { CoachError } from '@nsh/core-logic';
import { createLogger, withAudit, type Logger } from './audit.js';

function recorder(): { log: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const log: Logger = (level, message, meta) => {
    lines.push({ level, message, ...(meta ?? {}) });
  };
  return { log, lines };
}

describe('createLogger', () => {
  it('drops lines below the configured level and emits JSON above it', () => {
    const sunk: string[] = [];
    const log = createLogger('warn', (line) => sunk.push(line));
    log('info', 'ignored.me');
    log('error', 'kept.me', { tool: 'parse_script' });
    expect(sunk).toHaveLength(1);
    const parsed = JSON.parse(sunk[0]!) as Record<string, unknown>;
    expect(parsed['message']).toBe('kept.me');
    expect(parsed['level']).toBe('error');
    expect(parsed['tool']).toBe('parse_script');
    expect(typeof parsed['ts']).toBe('string');
  });
});

describe('withAudit', () => {
  it('emits one ok line carrying tool, takeId and a numeric duration, and returns the value', async () => {
    const { log, lines } = recorder();
    const out = await withAudit({ tool: 'parse_script', takeId: 'rough' }, log, () => 42);
    expect(out).toBe(42);
    expect(lines).toHaveLength(1);
    expect(lines[0]!['tool']).toBe('parse_script');
    expect(lines[0]!['takeId']).toBe('rough');
    expect(lines[0]!['outcome']).toBe('ok');
    expect(typeof lines[0]!['durationMs']).toBe('number');
    expect(lines[0]!['durationMs'] as number).toBeGreaterThanOrEqual(0);
  });

  it('emits an error line with the CoachError code, rethrows, and logs metadata only', async () => {
    const { log, lines } = recorder();
    const boom = new CoachError('STT_FAILED', 'transcript text: good morning I am Sujay', {
      script: 'Most retail teams still reconcile inventory by hand.',
    });

    await expect(withAudit({ tool: 'transcribe_delivery', takeId: 'rough' }, log, async () => {
      throw boom;
    })).rejects.toBe(boom);

    expect(lines).toHaveLength(1);
    expect(lines[0]!['outcome']).toBe('error');
    expect(lines[0]!['errorCode']).toBe('STT_FAILED');
    // Design §12: metadata only — never transcript text, never script content.
    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('good morning');
    expect(serialised).not.toContain('reconcile inventory');
  });

  it('reports UNKNOWN-shaped errors as INTERNAL without leaking the raw message', async () => {
    const { log, lines } = recorder();
    await expect(withAudit({ tool: 'generate_summary', takeId: null }, log, () => {
      throw new Error('vendor said ACME-1234');
    })).rejects.toThrow('vendor said ACME-1234');
    expect(lines[0]!['errorCode']).toBe('INTERNAL');
    expect(JSON.stringify(lines[0])).not.toContain('ACME-1234');
  });
});
