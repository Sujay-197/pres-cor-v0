// apps/server/src/adapters/audio-decode.ts
//
// ffmpeg-static decodes any input container to 16 kHz mono Float32Array. This
// exists solely to feed extractProsody, whose signature is
// (pcm: Float32Array, sampleRate: number).
//
// DECODE FAILURE IS NOT FATAL (design §5.2). If ffmpeg is missing or the
// container is unreadable we log it, substitute an empty ProsodyTrack, and the
// pipeline continues. Every rule that currently fires — stress, filler, pause,
// pacing — derives from word timings alone; prosody feeds only the untested
// stress.key-point-rising-pitch branch. A missing binary must never take down
// the demo.

import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { ProsodyTrack } from '@nsh/contracts';
import { CoachError, extractProsody } from '@nsh/core-logic';
import type { Logger } from '../audit.js';

export const PROSODY_SAMPLE_RATE = 16_000;

/** Matches core-logic's HOP_SEC and the track the golden fixtures were built from. */
export const PROSODY_HOP_SEC = 0.01;

export function emptyProsody(): ProsodyTrack {
  return { frames: [], frameHopSec: PROSODY_HOP_SEC };
}

export type DecodeFn = (filePath: string) => Promise<Float32Array>;

export function decodeWithFfmpeg(
  filePath: string,
  ffmpegBinary: string | null = ffmpegStatic,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    if (ffmpegBinary === null) {
      reject(new CoachError('AUDIO_UNREADABLE', 'ffmpeg-static provided no binary for this platform.'));
      return;
    }

    // f32le straight out of ffmpeg: no int16 conversion step to get wrong.
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', filePath,
      '-ac', '1',
      '-ar', String(PROSODY_SAMPLE_RATE),
      '-f', 'f32le',
      'pipe:1',
    ];

    // stdio: nothing is ever written to stdin, so keep it closed. windowsHide
    // stops the ffmpeg child from flashing a console window on Windows hosts.
    const child = spawn(ffmpegBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (cause) => {
      reject(new CoachError('AUDIO_UNREADABLE', 'ffmpeg failed to start.', { cause: cause.message }));
    });

    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new CoachError('AUDIO_UNREADABLE', `ffmpeg exited with code ${exitCode}.`, { stderr }));
        return;
      }
      const buf = Buffer.concat(chunks);
      // Buffer.concat gives no 4-byte alignment guarantee, so copy into a fresh
      // ArrayBuffer rather than viewing the pooled one.
      const usable = buf.byteLength - (buf.byteLength % 4);
      const ab = new ArrayBuffer(usable);
      new Uint8Array(ab).set(buf.subarray(0, usable));
      resolve(new Float32Array(ab));
    });
  });
}

export interface ProsodyRequest {
  filePath: string | null;
  enabled: boolean;
  decode?: DecodeFn;
  log?: Logger;
}

export async function prosodyForFile(req: ProsodyRequest): Promise<ProsodyTrack> {
  if (!req.enabled || req.filePath === null) return emptyProsody();

  const decode = req.decode ?? ((path: string) => decodeWithFfmpeg(path));
  try {
    const pcm = await decode(req.filePath);
    return extractProsody(pcm, PROSODY_SAMPLE_RATE);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const errorCode = err instanceof CoachError ? err.code : 'DECODE_FAILED';
    req.log?.('warn', 'prosody.degraded', { errorCode, reason });
    return emptyProsody();
  }
}
