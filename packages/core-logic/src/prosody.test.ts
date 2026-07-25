import { describe, expect, it } from 'vitest';
import { CoachError } from './errors.js';
import { extractProsody } from './prosody.js';

const SR = 16_000;

/** Synthesised sine — a known pitch the detector must recover. */
function sine(hz: number, seconds: number, amplitude = 0.5): Float32Array {
  const pcm = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < pcm.length; i++) pcm[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return pcm;
}

describe('extractProsody', () => {
  it('detects the pitch of a 220 Hz tone within 5%', () => {
    const track = extractProsody(sine(220, 6), SR);
    const voiced = track.frames.map((f) => f.f0).filter((f): f is number => f !== null);
    const mean = voiced.reduce((s, f) => s + f, 0) / voiced.length;
    expect(mean).toBeGreaterThan(209);
    expect(mean).toBeLessThan(231);
  });

  it('uses a 10 ms hop', () => {
    expect(extractProsody(sine(220, 6), SR).frameHopSec).toBeCloseTo(0.01, 5);
  });

  it('produces roughly one frame per hop', () => {
    const track = extractProsody(sine(220, 6), SR);
    expect(track.frames.length).toBeGreaterThan(550);
    expect(track.frames.length).toBeLessThan(620);
  });

  it('normalises rms to 0..1 against the loudest frame', () => {
    const track = extractProsody(sine(220, 6, 0.25), SR);
    const rms = track.frames.map((f) => f.rms);
    expect(Math.max(...rms)).toBeCloseTo(1, 1);
    expect(Math.min(...rms)).toBeGreaterThanOrEqual(0);
  });

  it('returns null f0 for silence rather than inventing a pitch', () => {
    const track = extractProsody(new Float32Array(SR * 6), SR);
    expect(track.frames.every((f) => f.f0 === null)).toBe(true);
  });

  it('advances frame timestamps by the hop', () => {
    const track = extractProsody(sine(220, 6), SR);
    expect(track.frames[0]!.t).toBeCloseTo(0, 5);
    expect(track.frames[10]!.t).toBeCloseTo(0.1, 5);
  });

  it('throws AUDIO_TOO_SHORT under five seconds', () => {
    try {
      extractProsody(sine(220, 2), SR);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as CoachError).code).toBe('AUDIO_TOO_SHORT');
    }
  });
});
