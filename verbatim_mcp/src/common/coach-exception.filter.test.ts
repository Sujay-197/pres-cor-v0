import { describe, expect, it } from 'vitest';
import { CoachExceptionFilter, mapCoachError } from './coach-exception.filter.js';
import { CoachError } from '../domain/core-logic/index.js';

describe('mapCoachError', () => {
  it('preserves the CoachError code and message, never the context', () => {
    const mapped = mapCoachError(new CoachError('BAD_INPUT', 'bad field', { secret: 'x' }));
    expect(mapped.body.error.code).toBe('BAD_INPUT');
    expect(JSON.stringify(mapped.body)).not.toContain('secret');
  });
  it('maps an unknown error to a generic INTERNAL 500', () => {
    const mapped = mapCoachError(new Error('stack detail'));
    expect(mapped.body.error.code).toBe('INTERNAL');
    expect(mapped.body.error.message).not.toContain('stack detail');
  });
});

describe('CoachExceptionFilter', () => {
  it('returns the client-safe body for a thrown CoachError', () => {
    const filter = new CoachExceptionFilter();
    const out = filter.catch(new CoachError('ALIGNMENT_FAILED', 'no match', { matchRate: 12 }), {} as never);
    expect(out).toMatchObject({ error: { code: 'ALIGNMENT_FAILED' } });
  });
});
