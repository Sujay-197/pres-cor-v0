// apps/server/src/takes.ts
//
// Design §7. A staged take's id is its filename with the `take-` prefix and the
// extension removed: fixtures/audio/take-rough.m4a -> "rough". That single
// identifier is what makes rpt-demo-rough and transcript.rough.json line up.
//
// Uploads are written as take-<uploadId><ext> under fixtures/audio/uploads/, so
// the same filename rule covers both and the `up-` prefix on the id makes a
// collision with "rough" or "clean" structurally impossible.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/server/src -> apps/server -> apps -> repo root. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const AUDIO_DIR = join(REPO_ROOT, 'fixtures', 'audio');
export const UPLOAD_DIR = join(AUDIO_DIR, 'uploads');
export const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'contracts', 'fixtures');

/** Lifted verbatim from scripts/transcribe.mjs so both agree on what we accept. */
export const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
};

export const UPLOAD_ID_PREFIX = 'up-';

const TAKE_PREFIX = 'take-';

export interface TakeInfo {
  id: string;
  label: string;
  mimeType: string;
  hasFrozenTranscript: boolean;
}

export function mimeTypeForFile(filename: string): string | null {
  return AUDIO_MIME_BY_EXT[extname(filename).toLowerCase()] ?? null;
}

export function takeIdFromFilename(filename: string): string | null {
  if (!filename.startsWith(TAKE_PREFIX)) return null;
  if (mimeTypeForFile(filename) === null) return null;
  const id = filename.slice(TAKE_PREFIX.length, filename.length - extname(filename).length);
  return id.length === 0 ? null : id;
}

export function labelForTake(takeId: string): string {
  if (takeId.startsWith(UPLOAD_ID_PREFIX)) {
    return `Upload ${takeId.slice(UPLOAD_ID_PREFIX.length)}`;
  }
  const head = takeId.slice(0, 1).toUpperCase();
  return `${head}${takeId.slice(1)} take`;
}

export function frozenTranscriptPath(fixtureDir: string, takeId: string): string | null {
  const path = join(fixtureDir, `transcript.${takeId}.json`);
  return existsSync(path) ? path : null;
}

function entriesOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

export function listTakes(audioDir: string, uploadDir: string, fixtureDir: string): TakeInfo[] {
  const out: TakeInfo[] = [];
  const seen = new Set<string>();

  for (const dir of [audioDir, uploadDir]) {
    for (const entry of entriesOf(dir)) {
      const id = takeIdFromFilename(entry);
      const mimeType = mimeTypeForFile(entry);
      if (id === null || mimeType === null || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: labelForTake(id),
        mimeType,
        hasFrozenTranscript: frozenTranscriptPath(fixtureDir, id) !== null,
      });
    }
  }

  // fixtures/audio/*.m4a is gitignored, so on a fresh clone the recordings are
  // absent while the frozen transcripts are committed. With STT_PROVIDER=fixture
  // those takes analyse perfectly well, so they must appear in the picker.
  for (const entry of entriesOf(fixtureDir)) {
    const match = /^transcript\.(.+)\.json$/.exec(entry);
    const id = match?.[1];
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: labelForTake(id), mimeType: 'audio/mp4', hasFrozenTranscript: true });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveTakeAudio(
  audioDir: string,
  uploadDir: string,
  takeId: string,
): { path: string; mimeType: string } | null {
  for (const dir of [audioDir, uploadDir]) {
    for (const entry of entriesOf(dir)) {
      if (takeIdFromFilename(entry) !== takeId) continue;
      const mimeType = mimeTypeForFile(entry);
      if (mimeType === null) continue;
      return { path: join(dir, entry), mimeType };
    }
  }
  return null;
}

/** Content-addressed and deterministic — design §17 keeps Math.random() out. */
export function uploadTakeId(bytes: Uint8Array): string {
  return UPLOAD_ID_PREFIX + createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

export function uploadFilenameFor(takeId: string, originalName: string): string | null {
  const ext = extname(originalName).toLowerCase();
  if (!(ext in AUDIO_MIME_BY_EXT)) return null;
  return `${TAKE_PREFIX}${takeId}${ext}`;
}
