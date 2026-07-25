import { describe, expect, it } from 'vitest';
import { CoachError, type CoachErrorCode } from '@nsh/core-logic';
import { ERROR_STATUS, GENERIC_MESSAGE, mapError } from './errors.js';

const CASES: Array<[CoachErrorCode, number]> = [
  ['BAD_INPUT', 400],
  ['SCRIPT_EMPTY', 400],
  ['SCRIPT_NO_SEGMENTS', 400],
  ['AUDIO_UNREADABLE', 415],
  ['AUDIO_TOO_SHORT', 422],
  ['STT_FAILED', 502],
  ['ALIGNMENT_FAILED', 422],
  ['INTERNAL', 500],
];

describe('mapError', () => {
  it.each(CASES)('maps %s to HTTP %i and echoes the CoachError message', (code, status) => {
    const mapped = mapError(new CoachError(code, `message for ${code}`, { secretish: 'input-fragment' }));
    expect(mapped.status).toBe(status);
    expect(mapped.body).toEqual({ error: { code, message: `message for ${code}` } });
  });

  it('covers every CoachErrorCode in the table with no extras', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual(CASES.map(([code]) => code).sort());
  });

  it('never returns CoachError.context to the client, but does surface it for logging', () => {
    const mapped = mapError(new CoachError('ALIGNMENT_FAILED', 'Recording does not match this script.', { matchRate: 12.5 }));
    expect(JSON.stringify(mapped.body)).not.toContain('matchRate');
    expect(mapped.logContext).toEqual({ matchRate: 12.5 });
  });

  it('turns a raw Error into a 500 with a generic message and never forwards vendor text', () => {
    const mapped = mapError(new Error('deepgram said: quota exceeded for account ACME-1234'));
    expect(mapped.status).toBe(500);
    expect(mapped.body).toEqual({ error: { code: 'INTERNAL', message: GENERIC_MESSAGE } });
    expect(JSON.stringify(mapped.body)).not.toContain('ACME-1234');
    expect(mapped.logMessage).toContain('ACME-1234');
  });

  it('maps a BAD_INPUT CoachError to 400 with the code and message in the body', () => {
    const mapped = mapError(new CoachError('BAD_INPUT', 'parseScriptTool: invalid input at "raw" (invalid_type).', { issues: [{ path: ['raw'], code: 'invalid_type' }] }));
    expect(mapped.status).toBe(400);
    expect(mapped.body).toEqual({
      error: { code: 'BAD_INPUT', message: 'parseScriptTool: invalid input at "raw" (invalid_type).' },
    });
  });

  it('turns a thrown non-Error into a 500 with a generic message', () => {
    const mapped = mapError('kaboom');
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.message).toBe(GENERIC_MESSAGE);
    expect(mapped.logMessage).toBe('kaboom');
  });
});
