import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CorrelationResult, type DeliverySignal, type ScriptSegment } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import { loadConfig } from '../config.js';
import { createDeps } from '../pipeline.js';
import { FIXTURE_DIR } from '../takes.js';
import { emptyProsody } from '../adapters/audio-decode.js';
import { parseScriptTool } from './parse-script.tool.js';
import { transcribeDeliveryTool } from './transcribe-delivery.tool.js';
import { correlateSegmentsTool } from './correlate-segments.tool.js';

const FIXTURE_ENV = { STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' };
const deps = createDeps(loadConfig(FIXTURE_ENV));
const segments: ScriptSegment[] = parseScriptTool({
  raw: readFileSync(join(FIXTURE_DIR, 'script.demo.md'), 'utf8'),
});

describe('correlateSegmentsTool', () => {
  it('reproduces the committed rough issue set', async () => {
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    const result = correlateSegmentsTool({ signal, segments });

    expect(CorrelationResult.safeParse(result).success).toBe(true);
    expect(result.issues).toHaveLength(6);
    const high = result.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
    expect(high[0]!.type).toBe('stress_mismatch');
    // Every issue carries a trace, and every alignment is passed through.
    expect(result.trace.map((t) => t.issueId)).toEqual(result.issues.map((i) => i.id));
    expect(result.alignments.map((a) => a.segmentId)).toEqual(segments.map((s) => s.id));
    expect(result.baseline.avgPaceWpm).toBeGreaterThan(0);
  });

  it('reproduces the committed clean issue set — two issues, both low', async () => {
    const signal = await transcribeDeliveryTool({ takeId: 'clean' }, deps);
    const result = correlateSegmentsTool({ signal, segments });
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i) => i.severity === 'low')).toBe(true);
  });

  it('raises ALIGNMENT_FAILED when the recording does not match the script', () => {
    const signal: DeliverySignal = {
      transcript: {
        provider: 'fixture',
        durationSec: 20,
        words: Array.from({ length: 40 }, (_, i) => ({
          text: 'qqq',
          start: i * 0.5,
          end: i * 0.5 + 0.4,
          confidence: 0.9,
          isFiller: false,
        })),
      },
      prosody: emptyProsody(),
    };

    let thrown: unknown;
    try {
      correlateSegmentsTool({ signal, segments });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('ALIGNMENT_FAILED');
  });
});
