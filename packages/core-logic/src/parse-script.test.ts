// packages/core-logic/src/parse-script.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoachError } from './errors.js';
import { parseScript } from './parse-script.js';

const demo = readFileSync(
  join(import.meta.dirname, '../../contracts/fixtures/script.demo.md'),
  'utf8',
);

describe('parseScript', () => {
  it('splits the demo script into six segments', () => {
    expect(parseScript(demo)).toHaveLength(6);
  });

  it('assigns zero-padded ids in source order', () => {
    expect(parseScript(demo).map((s) => s.id)).toEqual([
      'seg-001', 'seg-002', 'seg-003', 'seg-004', 'seg-005', 'seg-006',
    ]);
  });

  it('marks bolded segments as key points', () => {
    const keys = parseScript(demo).filter((s) => s.isKeyPoint).map((s) => s.id);
    expect(keys).toEqual(['seg-003', 'seg-005']);
  });

  it('marks [pause] segments and strips the token from text', () => {
    const seg = parseScript(demo).find((s) => s.id === 'seg-003')!;
    expect(seg.markedPause).toBe(true);
    expect(seg.text).not.toContain('[pause]');
    expect(seg.text.startsWith('We cut that to')).toBe(true);
  });

  it('strips bold markers from text but keeps the words', () => {
    const seg = parseScript(demo).find((s) => s.id === 'seg-003')!;
    expect(seg.text).not.toContain('*');
    expect(seg.text).toContain('under six minutes');
  });

  it('leaves non-key non-pause segments unflagged', () => {
    const seg = parseScript(demo).find((s) => s.id === 'seg-001')!;
    expect(seg.isKeyPoint).toBe(false);
    expect(seg.markedPause).toBe(false);
  });

  it('collapses internal whitespace and trims', () => {
    const [seg] = parseScript('The   quick\n  brown fox');
    expect(seg!.text).toBe('The quick brown fox');
  });

  it('ignores blank blocks from extra newlines', () => {
    expect(parseScript('One line\n\n\n\nTwo line')).toHaveLength(2);
  });

  it('throws SCRIPT_EMPTY on blank input', () => {
    expect(() => parseScript('   \n  ')).toThrow(CoachError);
    try { parseScript(''); } catch (e) { expect((e as CoachError).code).toBe('SCRIPT_EMPTY'); }
  });

  it('throws SCRIPT_NO_SEGMENTS when only markup remains', () => {
    try { parseScript('[pause]\n\n[pause]'); }
    catch (e) { expect((e as CoachError).code).toBe('SCRIPT_NO_SEGMENTS'); }
  });
});
