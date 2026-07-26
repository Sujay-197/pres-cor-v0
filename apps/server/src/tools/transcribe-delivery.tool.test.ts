import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeliverySignal, type Transcript } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import { loadConfig } from '../config.js';
import { PROSODY_SAMPLE_RATE, emptyProsody } from '../adapters/audio-decode.js';
import { createDeps, type ServerDeps } from '../pipeline.js';
import { transcribeDeliveryTool } from './transcribe-delivery.tool.js';

const FIXTURE_ENV = { STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' };

function audioScratch(): { audioDir: string; uploadDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'nsh-transcribe-'));
  const audioDir = join(root, 'audio');
  const uploadDir = join(audioDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(join(audioDir, 'take-rough.m4a'), 'not really audio');
  return { audioDir, uploadDir };
}

function tone(seconds: number): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * PROSODY_SAMPLE_RATE));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / PROSODY_SAMPLE_RATE);
  }
  return pcm;
}

describe('transcribeDeliveryTool', () => {
  it('returns the frozen rough signal without touching the filesystem for audio', async () => {
    // audioDir deliberately does not exist: with the fixture client and prosody
    // off, a fresh clone with no recordings on disk must still analyse.
    const deps = createDeps(loadConfig(FIXTURE_ENV), {
      audioDir: '/definitely/not/here',
      uploadDir: '/definitely/not/here/uploads',
    });
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);

    expect(signal.transcript.words).toHaveLength(91);
    expect(signal.transcript.durationSec).toBe(38.72);
    expect(signal.prosody).toEqual(emptyProsody());
    expect(DeliverySignal.safeParse(signal).success).toBe(true);
  });

  it('returns the frozen clean signal', async () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV));
    const signal = await transcribeDeliveryTool({ takeId: 'clean' }, deps);
    expect(signal.transcript.words).toHaveLength(86);
    expect(signal.transcript.durationSec).toBe(40.853);
  });

  it('decodes prosody when enabled and an audio file exists', async () => {
    const { audioDir, uploadDir } = audioScratch();
    const deps = createDeps(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'true' }), {
      audioDir,
      uploadDir,
      decode: async () => tone(6),
    });
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    expect(signal.prosody.frames.length).toBeGreaterThan(0);
    expect(signal.prosody.frameHopSec).toBe(emptyProsody().frameHopSec);
  });

  it('degrades to an empty prosody track when decoding fails, and still returns the transcript', async () => {
    const { audioDir, uploadDir } = audioScratch();
    const deps = createDeps(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'true' }), {
      audioDir,
      uploadDir,
      decode: async () => {
        throw new Error('ffmpeg unavailable');
      },
    });
    const signal = await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    expect(signal.prosody).toEqual(emptyProsody());
    expect(signal.transcript.words).toHaveLength(91);
  });

  it('raises AUDIO_UNREADABLE naming the limit when the recording is too long', async () => {
    const deps = createDeps(loadConfig({ ...FIXTURE_ENV, AUDIO_MAX_SECONDS: '10' }));
    let thrown: unknown;
    try {
      await transcribeDeliveryTool({ takeId: 'rough' }, deps);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('AUDIO_UNREADABLE');
    expect((thrown as CoachError).message).toContain('10');
  });

  it('raises STT_FAILED for a take with no frozen transcript', async () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV));
    await expect(transcribeDeliveryTool({ takeId: 'up-0123456789ab' }, deps)).rejects.toMatchObject({
      name: 'CoachError',
      code: 'STT_FAILED',
    });
  });

  it('raises a CoachError with code BAD_INPUT for malformed input, not a raw ZodError', async () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV));
    await expect(
      // @ts-expect-error - deliberately malformed to exercise input validation
      transcribeDeliveryTool({ takeId: 42 }, deps),
    ).rejects.toMatchObject({ name: 'CoachError', code: 'BAD_INPUT' });
  });

  it('raises AUDIO_UNREADABLE for a real provider when no audio file is on disk', async () => {
    const stubTranscript: Transcript = { provider: 'deepgram', durationSec: 1, words: [] };
    const overrides: Partial<ServerDeps> = {
      audioDir: '/definitely/not/here',
      uploadDir: '/definitely/not/here/uploads',
      createStt: () => ({ provider: 'deepgram', transcribe: async () => stubTranscript }),
    };
    const deps = createDeps(
      loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'dummy-not-a-real-key', ENABLE_PROSODY: 'false' }),
      overrides,
    );
    await expect(transcribeDeliveryTool({ takeId: 'rough' }, deps)).rejects.toMatchObject({
      name: 'CoachError',
      code: 'AUDIO_UNREADABLE',
    });
  });
});

describe('createDeps', () => {
  it('defaults to the repo directories, the fixture connectors and an ISO clock', () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV));
    expect(deps.fixtureDir.replace(/\\/g, '/')).toMatch(/\/packages\/contracts\/fixtures$/);
    expect(deps.audioDir.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio$/);
    expect(deps.uploadDir.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio\/uploads$/);
    expect(deps.clock()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(typeof deps.context.nextStepContext).toBe('function');
    expect(typeof deps.calendar.createReminder).toBe('function');
    expect(typeof deps.gmail.draft).toBe('function');
  });

  it('lets a caller override any single dependency', () => {
    const deps = createDeps(loadConfig(FIXTURE_ENV), { clock: () => '2026-07-25T09:00:00Z' });
    expect(deps.clock()).toBe('2026-07-25T09:00:00Z');
    expect(deps.audioDir.replace(/\\/g, '/')).toMatch(/\/fixtures\/audio$/);
  });
});
