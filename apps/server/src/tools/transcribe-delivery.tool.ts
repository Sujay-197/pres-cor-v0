// apps/server/src/tools/transcribe-delivery.tool.ts
//
// Returns a DeliverySignal ({ transcript, prosody }) — exactly what
// correlateSegments consumes — rather than an ad-hoc pair.

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { DeliverySignal } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import { prosodyForFile } from '../adapters/audio-decode.js';
import type { ServerDeps } from '../pipeline.js';
import { resolveTakeAudio } from '../takes.js';

export const TranscribeDeliveryInput = z.object({ takeId: z.string().min(1) });
export type TranscribeDeliveryInput = z.infer<typeof TranscribeDeliveryInput>;

export const TranscribeDeliveryOutput = DeliverySignal;

export async function transcribeDeliveryTool(
  input: TranscribeDeliveryInput,
  deps: ServerDeps,
): Promise<DeliverySignal> {
  const { takeId } = TranscribeDeliveryInput.parse(input);
  const client = deps.createStt(deps.config, takeId, deps.fixtureDir);

  // Transport wiring, not domain logic: the fixture client replays a committed
  // transcript, so with prosody off there is nothing on disk to read — which is
  // what lets a fresh clone (gitignored recordings) analyse the staged takes.
  const needsBytes = deps.config.sttProvider !== 'fixture' || deps.config.enableProsody;
  const audio = needsBytes ? resolveTakeAudio(deps.audioDir, deps.uploadDir, takeId) : null;

  if (deps.config.sttProvider !== 'fixture' && audio === null) {
    throw new CoachError('AUDIO_UNREADABLE', `No audio file on disk for take "${takeId}".`, { takeId });
  }

  const bytes = audio === null ? new Uint8Array(0) : new Uint8Array(await readFile(audio.path));
  const transcript = await client.transcribe(bytes, audio?.mimeType ?? 'application/octet-stream');

  // AUDIO_MAX_SECONDS cannot be known until the audio has been read, so it is
  // checked here rather than at upload time (design §11).
  if (transcript.durationSec > deps.config.audioMaxSeconds) {
    throw new CoachError(
      'AUDIO_UNREADABLE',
      `Recording is ${transcript.durationSec}s; the limit is ${deps.config.audioMaxSeconds}s.`,
      { takeId, durationSec: transcript.durationSec },
    );
  }

  const prosody = await prosodyForFile({
    filePath: audio?.path ?? null,
    enabled: deps.config.enableProsody,
    decode: deps.decode,
    log: deps.log,
  });

  return { transcript, prosody };
}
