import type { ProsodyFrame, ProsodyTrack } from '@nsh/contracts';
import Pitchfinder from 'pitchfinder';
import { CoachError } from './errors.js';
import { THRESHOLDS } from './thresholds.js';

const WINDOW_SEC = 0.025;
const HOP_SEC = 0.01;
const F0_MIN = 60;
const F0_MAX = 400;
/** Frames quieter than this fraction of peak are treated as unvoiced. */
const VOICED_RMS_FLOOR = 0.05;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Pure DSP over a Float32Array — no vendor, no Python sidecar. There is no
 * good hosted API for pitch and energy contours, and standing up a Python
 * service mid-build is how a demo dies (VOICE_STACK §4).
 */
export function extractProsody(pcm: Float32Array, sampleRate: number): ProsodyTrack {
  const durationSec = pcm.length / sampleRate;
  if (durationSec < THRESHOLDS.minAudioSec) {
    throw new CoachError('AUDIO_TOO_SHORT', `Recording is ${r1(durationSec)}s; need at least ${THRESHOLDS.minAudioSec}s.`, {
      durationSec: r1(durationSec),
    });
  }

  const windowSize = Math.floor(WINDOW_SEC * sampleRate);
  const hopSize = Math.floor(HOP_SEC * sampleRate);
  const detectPitch = Pitchfinder.YIN({ sampleRate });

  // Pass 1: RMS per window, plus the peak to normalise against.
  const raw: Array<{ t: number; rms: number; offset: number }> = [];
  let peak = 0;
  for (let offset = 0; offset + windowSize <= pcm.length; offset += hopSize) {
    let sumSquares = 0;
    for (let i = offset; i < offset + windowSize; i++) sumSquares += pcm[i]! ** 2;
    const rms = Math.sqrt(sumSquares / windowSize);
    if (rms > peak) peak = rms;
    raw.push({ t: offset / sampleRate, rms, offset });
  }

  // Pass 2: normalise, then pitch-track only the frames loud enough to be voiced.
  const frames: ProsodyFrame[] = raw.map(({ t, rms, offset }) => {
    const normalised = peak > 0 ? rms / peak : 0;
    let f0: number | null = null;

    if (normalised >= VOICED_RMS_FLOOR) {
      const detected = detectPitch(pcm.subarray(offset, offset + windowSize));
      // Reject out-of-band results rather than reporting a pitch we do not
      // believe — CONVENTIONS §6, never emit a verdict a signal cannot support.
      if (detected !== null && detected >= F0_MIN && detected <= F0_MAX) f0 = r1(detected);
    }

    return { t: r3(t), rms: r3(normalised), f0 };
  });

  return { frames, frameHopSec: HOP_SEC };
}
