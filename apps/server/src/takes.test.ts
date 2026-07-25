import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_DIR,
  FIXTURE_DIR,
  UPLOAD_ID_PREFIX,
  frozenTranscriptPath,
  labelForTake,
  listTakes,
  mimeTypeForFile,
  resolveTakeAudio,
  takeIdFromFilename,
  uploadFilenameFor,
  uploadTakeId,
} from './takes.js';

function scratch(): { audioDir: string; uploadDir: string; fixtureDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'nsh-takes-'));
  const audioDir = join(root, 'audio');
  const uploadDir = join(audioDir, 'uploads');
  const fixtureDir = join(root, 'fixtures');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });
  return { audioDir, uploadDir, fixtureDir };
}

describe('takeIdFromFilename', () => {
  it('strips the take- prefix and the extension', () => {
    expect(takeIdFromFilename('take-rough.m4a')).toBe('rough');
    expect(takeIdFromFilename('take-clean.wav')).toBe('clean');
    expect(takeIdFromFilename('take-up-0123456789ab.mp3')).toBe('up-0123456789ab');
  });

  it('rejects anything that is not a prefixed audio file', () => {
    expect(takeIdFromFilename('notes.txt')).toBeNull();
    expect(takeIdFromFilename('rough.m4a')).toBeNull();
    expect(takeIdFromFilename('take-rough.txt')).toBeNull();
    expect(takeIdFromFilename('take-.m4a')).toBeNull();
    expect(takeIdFromFilename('uploads')).toBeNull();
  });
});

describe('mimeTypeForFile', () => {
  it('maps the supported containers and rejects the rest', () => {
    expect(mimeTypeForFile('x.m4a')).toBe('audio/mp4');
    expect(mimeTypeForFile('x.WAV')).toBe('audio/wav');
    expect(mimeTypeForFile('x.webm')).toBe('audio/webm');
    expect(mimeTypeForFile('x.aiff')).toBeNull();
  });
});

describe('labelForTake', () => {
  it('title-cases a staged id and marks an upload as one', () => {
    expect(labelForTake('rough')).toBe('Rough take');
    expect(labelForTake('clean')).toBe('Clean take');
    expect(labelForTake('up-0123456789ab')).toBe('Upload 0123456789ab');
  });
});

describe('uploadTakeId', () => {
  it('is deterministic, content-addressed, and cannot collide with a staged id', () => {
    const a = uploadTakeId(new Uint8Array([1, 2, 3]));
    const b = uploadTakeId(new Uint8Array([1, 2, 3]));
    const c = uploadTakeId(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith(UPLOAD_ID_PREFIX)).toBe(true);
    expect(a).toHaveLength(UPLOAD_ID_PREFIX.length + 12);
    expect(a).not.toBe('rough');
    expect(a).not.toBe('clean');
  });
});

describe('uploadFilenameFor', () => {
  it('keeps the original container extension and re-applies the take- prefix', () => {
    expect(uploadFilenameFor('up-abc123abc123', 'my recording.M4A')).toBe('take-up-abc123abc123.m4a');
    expect(uploadFilenameFor('up-abc123abc123', 'clip.webm')).toBe('take-up-abc123abc123.webm');
  });

  it('rejects an unsupported container', () => {
    expect(uploadFilenameFor('up-abc123abc123', 'clip.aiff')).toBeNull();
  });

  it('round-trips through takeIdFromFilename', () => {
    const id = uploadTakeId(new Uint8Array([9, 9, 9]));
    const filename = uploadFilenameFor(id, 'clip.mp3');
    expect(filename).not.toBeNull();
    expect(takeIdFromFilename(filename!)).toBe(id);
  });
});

describe('listTakes', () => {
  it('discovers staged audio, uploads, and transcript-only takes, sorted by id', () => {
    const { audioDir, uploadDir, fixtureDir } = scratch();
    writeFileSync(join(audioDir, 'take-rough.m4a'), 'x');
    writeFileSync(join(audioDir, 'README.md'), 'ignored');
    writeFileSync(join(uploadDir, 'take-up-0123456789ab.mp3'), 'x');
    writeFileSync(join(fixtureDir, 'transcript.rough.json'), '{}');
    writeFileSync(join(fixtureDir, 'transcript.clean.json'), '{}');

    const takes = listTakes(audioDir, uploadDir, fixtureDir);
    expect(takes.map((t) => t.id)).toEqual(['clean', 'rough', 'up-0123456789ab']);
    expect(takes.find((t) => t.id === 'rough')).toEqual({
      id: 'rough',
      label: 'Rough take',
      mimeType: 'audio/mp4',
      hasFrozenTranscript: true,
    });
    // clean has a frozen transcript but no audio file — still analysable.
    expect(takes.find((t) => t.id === 'clean')!.hasFrozenTranscript).toBe(true);
    expect(takes.find((t) => t.id === 'up-0123456789ab')!.hasFrozenTranscript).toBe(false);
  });

  it('returns an empty list rather than throwing when the directories are absent', () => {
    expect(listTakes('/nope/audio', '/nope/audio/uploads', '/nope/fixtures')).toEqual([]);
  });
});

describe('resolveTakeAudio', () => {
  it('finds staged and uploaded files and returns their mime type', () => {
    const { audioDir, uploadDir } = scratch();
    writeFileSync(join(audioDir, 'take-rough.m4a'), 'x');
    writeFileSync(join(uploadDir, 'take-up-0123456789ab.mp3'), 'x');

    expect(resolveTakeAudio(audioDir, uploadDir, 'rough')).toEqual({
      path: join(audioDir, 'take-rough.m4a'),
      mimeType: 'audio/mp4',
    });
    expect(resolveTakeAudio(audioDir, uploadDir, 'up-0123456789ab')).toEqual({
      path: join(uploadDir, 'take-up-0123456789ab.mp3'),
      mimeType: 'audio/mpeg',
    });
    expect(resolveTakeAudio(audioDir, uploadDir, 'missing')).toBeNull();
  });
});

describe('repo-relative constants', () => {
  it('point at the real directories the server serves from', () => {
    expect(AUDIO_DIR.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio$/);
    expect(FIXTURE_DIR.replace(/\\/g, '/')).toMatch(/\/packages\/contracts\/fixtures$/);
    // The committed transcripts must be reachable from FIXTURE_DIR — everything
    // downstream (fixture STT, golden comparison) depends on this resolving.
    expect(frozenTranscriptPath(FIXTURE_DIR, 'rough')).not.toBeNull();
    expect(frozenTranscriptPath(FIXTURE_DIR, 'clean')).not.toBeNull();
    expect(frozenTranscriptPath(FIXTURE_DIR, 'nope')).toBeNull();
  });
});
