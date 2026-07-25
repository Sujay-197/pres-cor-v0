// apps/server/src/adapters/audio-normalize.ts
//
// Whatever format the recording comes in as (mp3, m4a, whatever the phone
// spits out), Deepgram (and our fixture files) expect 16kHz mono PCM.
// This is a thin wrapper around the system ffmpeg binary — nothing clever,
// just get the format right before it hits the STT client.

import { spawn } from 'child_process';

const TARGET_SAMPLE_RATE = 16000;

export function normalizeToPcm(inputPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-ac', '1',                          // mono
      '-ar', String(TARGET_SAMPLE_RATE),   // 16kHz
      '-f', 's16le',                       // raw PCM, 16-bit signed little-endian
      'pipe:1',                            // write to stdout instead of a file
    ];

    const ff = spawn('ffmpeg', args);
    const chunks: Buffer[] = [];
    let stderr = '';

    ff.stdout.on('data', (chunk) => chunks.push(chunk));
    ff.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    ff.on('error', (err) => {
      // ffmpeg not installed / not on PATH — fails loud and early rather
      // than silently producing garbage audio.
      reject(Object.assign(new Error('ffmpeg failed to start'), { code: 'AUDIO_UNREADABLE', cause: err }));
    });

    ff.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(Object.assign(new Error(`ffmpeg exited ${exitCode}: ${stderr}`), { code: 'AUDIO_UNREADABLE' }));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export const SAMPLE_RATE = TARGET_SAMPLE_RATE;
