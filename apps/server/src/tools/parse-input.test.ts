import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CoachError } from '@nsh/core-logic';
import { parseToolInput } from './parse-input.js';

const Schema = z.object({
  name: z.string().min(1),
  count: z.number().default(3),
  nested: z.object({ value: z.string() }),
});

describe('parseToolInput', () => {
  it('returns the parsed value, with schema defaults/coercions applied', () => {
    const result = parseToolInput(Schema, { name: 'abc', nested: { value: 'x' } }, 'someTool');
    expect(result).toEqual({ name: 'abc', count: 3, nested: { value: 'x' } });
  });

  it('throws a CoachError with code BAD_INPUT on invalid input', () => {
    let thrown: unknown;
    try {
      parseToolInput(Schema, { name: '', nested: { value: 'x' } }, 'someTool');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('BAD_INPUT');
  });

  // NOTE: the sentinel must be assigned to the FIELD THAT FAILS validation.
  // Zod's issue list only ever contains entries for failing fields, so a
  // sentinel on a passing field (e.g. `name`, which accepts any non-empty
  // string) can never appear in `issues` regardless of what parseToolInput
  // does with them — that would assert something true independent of the
  // implementation's safety. These two cases instead use Zod issue codes
  // (invalid_enum_value, invalid_literal) whose raw ZodIssue legitimately
  // embeds the received value — in `issue.received` AND inside Zod's own
  // `issue.message` — so the test can only pass if parseToolInput's summary
  // is built from `path`/`code` alone and never touches `issue.message`,
  // `issue.received`, or `issue.expected`.
  it('does not leak the failing value into the message, but keeps it in context (invalid_enum_value)', () => {
    const sentinel = 'SUPERSECRETVALUE';
    const EnumSchema = z.object({ mode: z.enum(['a', 'b', 'c']) });
    let thrown: unknown;
    try {
      parseToolInput(EnumSchema, { mode: sentinel }, 'myCoolTool');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    const err = thrown as CoachError;
    expect(err.code).toBe('BAD_INPUT');
    expect(err.message).toContain('myCoolTool');
    expect(err.message).toContain('mode');
    expect(err.message).toContain('invalid_enum_value');
    expect(err.message).not.toContain(sentinel);

    // Confirm the sentinel really is in Zod's raw issue (both `received` and
    // its own `message`) — otherwise this test would not be exercising the
    // leak scenario at all. context is logged, never returned to the client
    // (apps/server/src/errors.ts), so carrying it there is the correct place.
    const issues = err.context['issues'] as Array<{ received?: unknown; message?: string }>;
    expect(issues[0]!.received).toBe(sentinel);
    expect(issues[0]!.message).toContain(sentinel);
  });

  it('does not leak the failing value into the message for invalid_literal either', () => {
    const sentinel = 'SUPERSECRETVALUE';
    const LiteralSchema = z.object({ tag: z.literal('expected-tag') });
    let thrown: unknown;
    try {
      parseToolInput(LiteralSchema, { tag: sentinel }, 'myCoolTool');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    const err = thrown as CoachError;
    expect(err.code).toBe('BAD_INPUT');
    expect(err.message).toContain('myCoolTool');
    expect(err.message).toContain('tag');
    expect(err.message).toContain('invalid_literal');
    expect(err.message).not.toContain(sentinel);

    // Unlike invalid_enum_value, this Zod version's invalid_literal message
    // does not itself embed the raw value — only `received` does. Still
    // worth pinning: context legitimately carries it, the outward message
    // must not.
    const issues = err.context['issues'] as Array<{ received?: unknown }>;
    expect(issues[0]!.received).toBe(sentinel);
  });

  it('carries the full Zod issue list on context', () => {
    let thrown: unknown;
    try {
      parseToolInput(Schema, { name: 123, nested: { value: 'x' } }, 'someTool');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    const { context } = thrown as CoachError;
    expect(Array.isArray(context['issues'])).toBe(true);
    const issues = context['issues'] as Array<{ path: unknown[]; code: string }>;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.path).toEqual(['name']);
    expect(typeof issues[0]!.code).toBe('string');
  });

  it('rejects input missing a required nested field, reporting the nested path', () => {
    let thrown: unknown;
    try {
      parseToolInput(Schema, { name: 'ok' }, 'someTool');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).message).toContain('nested');
  });
});
