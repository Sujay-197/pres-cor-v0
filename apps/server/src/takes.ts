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
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/server/src -> apps/server -> apps -> repo root. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const AUDIO_DIR = join(REPO_ROOT, 'fixtures', 'audio');
export const UPLOAD_DIR = join(AUDIO_DIR, 'uploads');
export const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'contracts', 'fixtures');

/**
 * Lifted verbatim from scripts/transcribe.mjs so both agree on what we accept.
 *
 * Both `mimeTypeForFile`'s bracket lookup and `uploadFilenameFor`'s `in` check
 * below index this plain object literal with the result of `extname()`, which
 * always returns either `''` or a string starting with `.` — never a bare
 * prototype key like `constructor` or `__proto__` — so neither lookup can
 * resolve an inherited Object.prototype member. This invariant is what makes
 * the unguarded lookups safe; an `Object.hasOwn` guard is not needed here, but
 * a future refactor that lets an extension reach this table unprocessed by
 * `extname()` would need one.
 */
export const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
};

export const UPLOAD_ID_PREFIX = 'up-';

/** Take IDs must be alphanumeric (lowercase) and hyphens only — rejects `.`, `/`, `\` and
 * path traversal attempts. Multi-dot filenames are not addressable to prevent confusion
 * with path separators; takeIdFromFilename may extract ids with dots from filenames like
 * `take-my.old.name.m4a`, but listTakes filters them out. */
export const TAKE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidTakeId(id: string): boolean {
  return TAKE_ID_PATTERN.test(id);
}

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
  if (!isValidTakeId(takeId)) return null;
  const path = join(fixtureDir, `transcript.${takeId}.json`);
  // Defense in depth: confirm the resolved path is still within fixtureDir.
  const resolvedPath = resolve(path);
  const resolvedFixtureDir = resolve(fixtureDir);
  if (!resolvedPath.startsWith(resolvedFixtureDir + sep)) return null;
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
      if (id === null || mimeType === null || !isValidTakeId(id) || seen.has(id)) continue;
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
    if (id === undefined || !isValidTakeId(id) || seen.has(id)) continue;
    seen.add(id);
    // Placeholder mime type for transcript-only takes; not a real content-type claim.
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
  if (!isValidTakeId(takeId)) return null;
  const ext = extname(originalName).toLowerCase();
  if (!(ext in AUDIO_MIME_BY_EXT)) return null;
  return `${TAKE_PREFIX}${takeId}${ext}`;
}
