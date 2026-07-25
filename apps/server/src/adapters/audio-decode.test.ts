import { describe, expect, it } from 'vitest';
import { extractProsody } from '@nsh/core-logic';
import type { Logger } from '../audit.js';
import {
  PROSODY_HOP_SEC,
  PROSODY_SAMPLE_RATE,
  emptyProsody,
  prosodyForFile,
  type DecodeFn,
} from './audio-decode.js';

/** 6s of a 200 Hz tone at 16 kHz — comfortably over THRESHOLDS.minAudioSec (5). */
function tone(seconds: number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * PROSODY_SAMPLE_RATE));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / PROSODY_SAMPLE_RATE);
  }
  return pcm;
}

function recorder(): { log: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const log: Logger = (level, message, meta) => lines.push({ level, message, ...(meta ?? {}) });
  return { log, lines };
}

describe('emptyProsody', () => {
  it('is the exact track the golden fixtures were generated from', () => {
    expect(emptyProsody()).toEqual({ frames: [], frameHopSec: PROSODY_HOP_SEC });
    expect(PROSODY_HOP_SEC).toBe(0.01);
  });

  it('returns a fresh object each call so concurrent requests cannot alias', () => {
    expect(emptyProsody()).not.toBe(emptyProsody());
  });
});

describe('prosodyForFile', () => {
  it('produces a real track from decoded PCM, identical to calling extractProsody directly', async () => {
    const pcm = tone(6);
    const decode: DecodeFn = async () => pcm;
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode });

    expect(track.frames.length).toBeGreaterThan(0);
    expect(track.frameHopSec).toBe(PROSODY_HOP_SEC);
    expect(track.frames.some((f) => f.f0 !== null)).toBe(true);
    // The adapter adds nothing of its own — it is extractProsody plus I/O.
    expect(track).toEqual(extractProsody(pcm, PROSODY_SAMPLE_RATE));
  });

  it('skips decoding entirely when prosody is disabled', async () => {
    let calls = 0;
    const decode: DecodeFn = async () => {
      calls += 1;
      return tone(6);
    };
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: false, decode });
    expect(calls).toBe(0);
    expect(track).toEqual(emptyProsody());
  });

  it('returns an empty track when there is no audio file to decode', async () => {
    let calls = 0;
    const decode: DecodeFn = async () => {
      calls += 1;
      return tone(6);
    };
    const track = await prosodyForFile({ filePath: null, enabled: true, decode });
    expect(calls).toBe(0);
    expect(track).toEqual(emptyProsody());
  });

  it('degrades to an empty track and logs when the decoder fails', async () => {
    const { log, lines } = recorder();
    const decode: DecodeFn = async () => {
      throw new Error('ffmpeg-static binary missing for this platform');
    };
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode, log });

    expect(track).toEqual(emptyProsody());
    expect(lines).toHaveLength(1);
    expect(lines[0]!['level']).toBe('warn');
    expect(lines[0]!['message']).toBe('prosody.degraded');
    expect(String(lines[0]!['reason'])).toContain('ffmpeg-static');
  });

  it('degrades to an empty track when the recording is too short for extractProsody', async () => {
    const { log, lines } = recorder();
    // 1s < THRESHOLDS.minAudioSec, so extractProsody throws AUDIO_TOO_SHORT.
    const decode: DecodeFn = async () => tone(1);
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode, log });
    expect(track).toEqual(emptyProsody());
    expect(lines[0]!['errorCode']).toBe('AUDIO_TOO_SHORT');
  });

  it('never throws, whatever the decoder does', async () => {
    const decode: DecodeFn = async () => {
      throw 'not even an Error';
    };
    await expect(prosodyForFile({ filePath: '/x.m4a', enabled: true, decode })).resolves.toEqual(emptyProsody());
  });
});
