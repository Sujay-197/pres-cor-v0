import { describe, expect, it, vi } from 'vitest';
import { prosodyForFile, emptyProsody } from './audio-decode.js';

describe('prosodyForFile', () => {
  it('returns an empty track when prosody is disabled', async () => {
    const t = await prosodyForFile({ filePath: '/whatever.wav', enabled: false });
    expect(t).toEqual(emptyProsody());
  });

  it('DEGRADES to an empty track when decode throws (missing ffmpeg / bad container)', async () => {
    const logs: Array<[string, string, unknown]> = [];
    const t = await prosodyForFile({
      filePath: '/broken.wav',
      enabled: true,
      decode: async () => { throw new Error('ffmpeg missing'); },
      log: (level, msg, meta) => logs.push([level, msg, meta]),
    });
    expect(t).toEqual(emptyProsody());
    expect(logs.some(([lvl, msg]) => lvl === 'warn' && msg === 'prosody.degraded')).toBe(true);
  });

  it('PROPAGATES AUDIO_TOO_SHORT from extractProsody (not a decode hiccup)', async () => {
    // A 0.5s decode result: extractProsody throws AUDIO_TOO_SHORT, which must
    // NOT be swallowed into an empty track. Would fail if the try wrapped
    // extractProsody instead of just decode().
    const halfSecond = new Float32Array(16_000 * 0.5);
    await expect(
      prosodyForFile({ filePath: '/short.wav', enabled: true, decode: async () => halfSecond }),
    ).rejects.toMatchObject({ code: 'AUDIO_TOO_SHORT' });
  });

  it('returns real frames for a valid long decode', async () => {
    const twoSecOfTone = new Float32Array(16_000 * 6);
    for (let i = 0; i < twoSecOfTone.length; i++) twoSecOfTone[i] = Math.sin(i * 0.1) * 0.5;
    const t = await prosodyForFile({ filePath: '/ok.wav', enabled: true, decode: async () => twoSecOfTone });
    expect(t.frames.length).toBeGreaterThan(0);
    expect(t.frameHopSec).toBeCloseTo(0.01);
  });
});
