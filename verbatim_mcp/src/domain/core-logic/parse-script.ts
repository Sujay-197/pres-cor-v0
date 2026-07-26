// packages/core-logic/src/parse-script.ts
import { SCRIPT_MARKUP, type ScriptSegment } from '../contracts/index.js';
import { CoachError } from './errors.js';

/**
 * `[pause]` means a pause BEFORE this segment, matching its position at the
 * head of segment 3 in script.demo.md. It is never a mid-segment pause.
 */
export function parseScript(raw: string): ScriptSegment[] {
  if (raw.trim().length === 0) {
    throw new CoachError('SCRIPT_EMPTY', 'Script is empty.');
  }

  const segments: ScriptSegment[] = [];

  for (const block of raw.split(SCRIPT_MARKUP.segmentDelimiter)) {
    const isKeyPoint = new RegExp(SCRIPT_MARKUP.keyPoint.source, 'g').test(block);
    const markedPause = new RegExp(SCRIPT_MARKUP.pause.source, 'gi').test(block);

    const text = block
      .replace(new RegExp(SCRIPT_MARKUP.pause.source, 'gi'), ' ')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length === 0) continue;

    segments.push({
      id: `seg-${String(segments.length + 1).padStart(3, '0')}`,
      text,
      isKeyPoint,
      markedPause,
    });
  }

  if (segments.length === 0) {
    throw new CoachError('SCRIPT_NO_SEGMENTS', 'Script contained no text outside markup.');
  }

  return segments;
}
