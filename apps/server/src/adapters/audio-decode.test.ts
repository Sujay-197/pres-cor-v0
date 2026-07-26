import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachError, extractProsody } from '@nsh/core-logic';
import type { Logger } from '../audit.js';
import {
  PROSODY_HOP_SEC,
  PROSODY_SAMPLE_RATE,
  decodeWithFfmpeg,
  emptyProsody,
  prosodyForFile,
  type DecodeFn,
} from './audio-decode.js';

// decodeWithFfmpeg is exercised directly below with a mocked child_process,
// so this suite never shells out — no test depends on the ffmpeg binary
// actually existing on the runner.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/** A fake ChildProcess: stdout/stderr are their own emitters, the child itself
 * emits 'error' and 'close', matching what decodeWithFfmpeg listens for. */
function fakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

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

  it('propagates AUDIO_TOO_SHORT from extractProsody instead of swallowing it into an empty track', async () => {
    // 1s < THRESHOLDS.minAudioSec, so extractProsody throws AUDIO_TOO_SHORT.
    // decode() succeeds here — this is an analysis failure, not a decode
    // failure — so prosodyForFile's narrower try (decode() only) must let it
    // propagate as a real CoachError rather than degrading to an empty track,
    // which is what made the documented AUDIO_TOO_SHORT -> 422 mapping
    // unreachable before this split.
    const { log, lines } = recorder();
    const decode: DecodeFn = async () => tone(1);
    let thrown: unknown;
    try {
      await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode, log });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('AUDIO_TOO_SHORT');
    // Nothing was logged as degraded — this path never reaches the catch.
    expect(lines).toEqual([]);
  });

  it('still degrades to an empty track and logs when decode() itself fails (unchanged from before the split)', async () => {
    const { log, lines } = recorder();
    const decode: DecodeFn = async () => {
      throw new Error('ffmpeg-static binary missing for this platform');
    };
    const track = await prosodyForFile({ filePath: '/any/take.m4a', enabled: true, decode, log });
    expect(track).toEqual(emptyProsody());
    expect(lines[0]!['errorCode']).toBe('DECODE_FAILED');
  });

  it('never throws, whatever the decoder does', async () => {
    const decode: DecodeFn = async () => {
      throw 'not even an Error';
    };
    await expect(prosodyForFile({ filePath: '/x.m4a', enabled: true, decode })).resolves.toEqual(emptyProsody());
  });
});

describe('decodeWithFfmpeg', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  /** Four floats — 0, 1, -1, 0.5 — packed little-endian, 16 bytes total. */
  function knownSamples(): Buffer {
    const buf = Buffer.alloc(16);
    buf.writeFloatLE(0, 0);
    buf.writeFloatLE(1, 4);
    buf.writeFloatLE(-1, 8);
    buf.writeFloatLE(0.5, 12);
    return buf;
  }

  it('converts f32le stdout bytes into a Float32Array with the correct endianness', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = decodeWithFfmpeg('/any/take.m4a', '/fake/ffmpeg');
    child.stdout.emit('data', knownSamples());
    child.emit('close', 0);

    const pcm = await promise;
    expect(Array.from(pcm)).toEqual([0, 1, -1, 0.5]);
  });

  it('reassembles stdout chunks split mid-sample identically to a single chunk', async () => {
    const buf = knownSamples();
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = decodeWithFfmpeg('/any/take.m4a', '/fake/ffmpeg');
    // Split at byte 6 — inside the second float (bytes 4-8) — and again at 10,
    // the case most likely to break a naive per-chunk conversion.
    child.stdout.emit('data', buf.subarray(0, 6));
    child.stdout.emit('data', buf.subarray(6, 10));
    child.stdout.emit('data', buf.subarray(10, 16));
    child.emit('close', 0);

    const pcm = await promise;
    expect(Array.from(pcm)).toEqual([0, 1, -1, 0.5]);
  });

  it('truncates a trailing partial sample rather than producing a garbage final value', async () => {
    // 2 full floats (8 bytes) plus 2 trailing bytes that do not make a full sample.
    const buf = Buffer.alloc(10);
    buf.writeFloatLE(1, 0);
    buf.writeFloatLE(-1, 4);
    buf.writeUInt8(0xff, 8);
    buf.writeUInt8(0xff, 9);

    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = decodeWithFfmpeg('/any/take.m4a', '/fake/ffmpeg');
    child.stdout.emit('data', buf);
    child.emit('close', 0);

    const pcm = await promise;
    expect(pcm.length).toBe(2);
    expect(Array.from(pcm)).toEqual([1, -1]);
  });

  it('drains stderr and rejects with CoachError AUDIO_UNREADABLE on non-zero exit', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = decodeWithFfmpeg('/any/take.m4a', '/fake/ffmpeg');
    // Emitted in two pieces to prove the stderr listener actually drains
    // rather than being bypassed.
    child.stderr.emit('data', Buffer.from('unknown '));
    child.stderr.emit('data', Buffer.from('codec'));
    child.emit('close', 1);

    await expect(promise).rejects.toBeInstanceOf(CoachError);
    await expect(promise).rejects.toMatchObject({
      code: 'AUDIO_UNREADABLE',
      context: { stderr: 'unknown codec' },
    });
  });

  it('rejects with CoachError AUDIO_UNREADABLE when the child process itself errors', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = decodeWithFfmpeg('/any/take.m4a', '/fake/ffmpeg');
    child.emit('error', new Error('ENOENT: spawn /fake/ffmpeg'));

    await expect(promise).rejects.toBeInstanceOf(CoachError);
    await expect(promise).rejects.toMatchObject({ code: 'AUDIO_UNREADABLE' });
  });

  it('rejects with CoachError AUDIO_UNREADABLE when no binary is available for this platform', async () => {
    await expect(decodeWithFfmpeg('/any/take.m4a', null)).rejects.toMatchObject({
      code: 'AUDIO_UNREADABLE',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns ffmpeg with an argument array — not a shell string — requesting f32le mono at the target rate', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = decodeWithFfmpeg('/any/take.m4a', '/fake/ffmpeg');
    child.emit('close', 0);
    await promise;

    expect(spawn).toHaveBeenCalledTimes(1);
    const call = vi.mocked(spawn).mock.calls[0]!;
    const [binary, args, options] = call as [string, string[], Record<string, unknown>];

    expect(binary).toBe('/fake/ffmpeg');
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain('-i');
    expect(args).toContain('/any/take.m4a');
    expect(args).toContain('-ar');
    expect(args).toContain(String(PROSODY_SAMPLE_RATE));
    expect(args).toContain('-f');
    expect(args).toContain('f32le');
    expect(args).toContain('-ac');
    expect(args).toContain('1');
    expect(options).toMatchObject({ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  });
});
