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

  it('names the tool and the failing field path in the message, without the offending value', () => {
    const sentinel = 'SUPERSECRETVALUE';
    let thrown: unknown;
    try {
      parseToolInput(Schema, { name: sentinel, count: 'not-a-number', nested: { value: 'x' } }, 'myCoolTool');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    const message = (thrown as CoachError).message;
    expect(message).toContain('myCoolTool');
    expect(message).toContain('count');
    expect(message).not.toContain(sentinel);
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
