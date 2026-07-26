import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { isValidTakeId, frozenTranscriptPath, uploadFilenameFor, resolveTakeAudio } from './takes.js';

const fixtureDir = join(process.cwd(), 'fixtures');

describe('take id validation (path-traversal guard)', () => {
  it('rejects traversal and separator characters', () => {
    for (const bad of ['../etc', 'a/b', 'a\\b', '..', '.hidden', 'UPPER', 'a.b']) {
      expect(isValidTakeId(bad)).toBe(false);
    }
  });
  it('accepts lowercase alnum + hyphen ids', () => {
    expect(isValidTakeId('rough')).toBe(true);
    expect(isValidTakeId('up-abc123')).toBe(true);
  });
});

describe('frozenTranscriptPath', () => {
  it('returns null for an invalid take id even if a file might exist', () => {
    expect(frozenTranscriptPath(fixtureDir, '../report.rough')).toBeNull();
  });
  it('resolves the committed transcript for a valid take', () => {
    expect(frozenTranscriptPath(fixtureDir, 'rough')).not.toBeNull();
  });
});

describe('uploadFilenameFor', () => {
  it('rejects an unsupported extension', () => {
    expect(uploadFilenameFor('up-abc', 'evil.exe')).toBeNull();
  });
  it('builds take-<id><ext> for an allowed extension', () => {
    expect(uploadFilenameFor('up-abc', 'clip.m4a')).toBe('take-up-abc.m4a');
  });
});

describe('resolveTakeAudio', () => {
  it('returns null when no matching audio file is present', () => {
    expect(resolveTakeAudio(fixtureDir, join(fixtureDir, 'audio', 'uploads'), 'rough')).toBeNull();
  });
});
