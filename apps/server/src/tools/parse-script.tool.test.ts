import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptSegment } from '@nsh/contracts';
import { CoachError, parseScript } from '@nsh/core-logic';
import { FIXTURE_DIR } from '../takes.js';
import { ParseScriptOutput, parseScriptTool } from './parse-script.tool.js';

const demoScript = readFileSync(join(FIXTURE_DIR, 'script.demo.md'), 'utf8');

describe('parseScriptTool', () => {
  it('is a pure wrapper over parseScript', () => {
    expect(parseScriptTool({ raw: demoScript })).toEqual(parseScript(demoScript));
  });

  it('produces contract-valid, source-ordered segments for the demo script', () => {
    const segments = parseScriptTool({ raw: demoScript });
    expect(segments).toHaveLength(6);
    expect(segments.map((s) => s.id)).toEqual(
      segments.map((_, i) => `seg-${String(i + 1).padStart(3, '0')}`),
    );
    expect(ScriptSegment.array().safeParse(segments).success).toBe(true);
    expect(ParseScriptOutput.safeParse(segments).success).toBe(true);
    // The demo script marks both a pause and key points; the tool must not eat them.
    expect(segments.some((s) => s.markedPause)).toBe(true);
    expect(segments.filter((s) => s.isKeyPoint)).toHaveLength(2);
  });

  it('raises SCRIPT_EMPTY for blank input', () => {
    let thrown: unknown;
    try {
      parseScriptTool({ raw: '   \n\t ' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('SCRIPT_EMPTY');
  });

  it('raises SCRIPT_NO_SEGMENTS when the script is markup only', () => {
    let thrown: unknown;
    try {
      parseScriptTool({ raw: '[pause]\n\n****\n\n[pause]' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('SCRIPT_NO_SEGMENTS');
  });

  it('raises a CoachError with code BAD_INPUT for malformed input, not a raw ZodError', () => {
    let thrown: unknown;
    try {
      // @ts-expect-error - deliberately malformed to exercise input validation
      parseScriptTool({ raw: 123 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('BAD_INPUT');
  });
});
