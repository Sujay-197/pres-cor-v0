import { describe, expect, it } from 'vitest';
import { CoachError } from '@nsh/core-logic';
import { FILLER_LEXICON, Transcript } from '@nsh/contracts';
import { loadConfig } from '../config.js';
import { FIXTURE_DIR } from '../takes.js';
import { DeepgramSttClient, FixtureSttClient, createSttClient } from './stt-client.js';

const TEST_KEY = 'dummy-not-a-real-key';

/**
 * A recorded Deepgram response body. Never a live call — design §14. The values
 * are chosen to exercise the 3dp rounding at this boundary.
 */
const RECORDED_BODY = {
  metadata: { duration: 12.3456 },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'good morning um',
            words: [
              { word: 'good', start: 0.0799999, end: 0.5200001, confidence: 0.9994999 },
              { word: 'morning', start: 0.5200001, end: 1.0004999, confidence: 0.87654 },
              { word: 'um', start: 1.2345678, end: 1.4999999, confidence: 0.5 },
            ],
          },
        ],
      },
    ],
  },
};

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(response: Response, captured: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
}

describe('FixtureSttClient', () => {
  it('replays the frozen rough transcript exactly', async () => {
    const client = new FixtureSttClient(FIXTURE_DIR, 'rough');
    const transcript = await client.transcribe(new Uint8Array(0), 'audio/mp4');
    expect(client.provider).toBe('fixture');
    expect(transcript.words).toHaveLength(91);
    expect(transcript.durationSec).toBe(38.72);
    // The file records who actually produced it; the CLIENT is the fixture.
    expect(transcript.provider).toBe('deepgram');
    expect(Transcript.safeParse(transcript).success).toBe(true);
  });

  it('replays the frozen clean transcript exactly', async () => {
    const transcript = await new FixtureSttClient(FIXTURE_DIR, 'clean').transcribe(new Uint8Array(0), 'audio/mp4');
    expect(transcript.words).toHaveLength(86);
    expect(transcript.durationSec).toBe(40.853);
  });

  it('raises STT_FAILED when no frozen transcript exists for the take', async () => {
    const client = new FixtureSttClient(FIXTURE_DIR, 'no-such-take');
    await expect(client.transcribe(new Uint8Array(0), 'audio/mp4')).rejects.toMatchObject({
      name: 'CoachError',
      code: 'STT_FAILED',
    });
  });
});

describe('DeepgramSttClient', () => {
  it('posts raw container bytes with the file mime type and the frozen query params', async () => {
    const captured: Captured[] = [];
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(RECORDED_BODY), { status: 200 }), captured),
    );
    const bytes = new Uint8Array([0, 1, 2, 3]);
    await client.transcribe(bytes, 'audio/mp4');

    expect(captured).toHaveLength(1);
    const url = new URL(captured[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/listen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: 'nova-3',
      filler_words: 'true',
      punctuate: 'true',
      smart_format: 'false',
      numerals: 'false',
    });

    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(captured[0]!.init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('audio/mp4');
    expect(headers['Authorization']!.startsWith('Token ')).toBe(true);
    // The key belongs in the header and nowhere else.
    expect(captured[0]!.url).not.toContain(TEST_KEY);
    expect(captured[0]!.init.body).toBe(bytes);
  });

  it('rounds every vendor number to 3dp at this boundary and never converts again', async () => {
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(RECORDED_BODY), { status: 200 }), []),
    );
    const transcript = await client.transcribe(new Uint8Array([0]), 'audio/mp4');

    expect(transcript.provider).toBe('deepgram');
    expect(transcript.durationSec).toBe(12.346);
    expect(transcript.words).toEqual([
      { text: 'good', start: 0.08, end: 0.52, confidence: 0.999, isFiller: false },
      { text: 'morning', start: 0.52, end: 1, confidence: 0.877, isFiller: false },
      { text: 'um', start: 1.235, end: 1.5, confidence: 0.5, isFiller: false },
    ]);
    expect(Transcript.safeParse(transcript).success).toBe(true);
  });

  it('leaves filler classification to alignSegments', async () => {
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(RECORDED_BODY), { status: 200 }), []),
    );
    const transcript = await client.transcribe(new Uint8Array([0]), 'audio/mp4');
    const um = transcript.words.find((w) => w.text === 'um');
    // "um" IS in the contract's lexicon; the adapter must still not tag it.
    expect(FILLER_LEXICON).toContain('um');
    expect(um!.isFiller).toBe(false);
    expect(transcript.words.every((w) => w.isFiller === false)).toBe(true);
  });

  it('maps a non-ok response to STT_FAILED without forwarding vendor text', async () => {
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response('quota exceeded for account ACME-1234', { status: 503 }), []),
    );
    let thrown: unknown;
    try {
      await client.transcribe(new Uint8Array([0]), 'audio/mp4');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('STT_FAILED');
    expect((thrown as CoachError).message).toContain('503');
    expect((thrown as CoachError).message).not.toContain('ACME-1234');
  });

  it('maps a transport failure to STT_FAILED', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new DeepgramSttClient(TEST_KEY, failing).transcribe(new Uint8Array([0]), 'audio/mp4'),
    ).rejects.toMatchObject({ name: 'CoachError', code: 'STT_FAILED' });
  });

  it('maps an empty word list to STT_FAILED', async () => {
    const empty = { metadata: { duration: 3 }, results: { channels: [{ alternatives: [{ words: [] }] }] } };
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(empty), { status: 200 }), []),
    );
    await expect(client.transcribe(new Uint8Array([0]), 'audio/mp4')).rejects.toMatchObject({
      name: 'CoachError',
      code: 'STT_FAILED',
    });
  });

  it('falls back to the last word end when metadata.duration is absent', async () => {
    const noDuration = {
      results: { channels: [{ alternatives: [{ words: [{ word: 'hi', start: 0, end: 7.7777 }] }] }] },
    };
    const client = new DeepgramSttClient(
      TEST_KEY,
      stubFetch(new Response(JSON.stringify(noDuration), { status: 200 }), []),
    );
    const transcript = await client.transcribe(new Uint8Array([0]), 'audio/mp4');
    expect(transcript.durationSec).toBe(7.778);
    expect(transcript.words[0]!.confidence).toBe(0);
  });
});

describe('createSttClient', () => {
  it('returns the fixture client under the default configuration', () => {
    const client = createSttClient(loadConfig({}), 'rough', FIXTURE_DIR);
    expect(client).toBeInstanceOf(FixtureSttClient);
    expect(client.provider).toBe('fixture');
  });

  it('returns the deepgram client when configured with a key', () => {
    const cfg = loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: TEST_KEY });
    const client = createSttClient(cfg, 'rough', FIXTURE_DIR);
    expect(client).toBeInstanceOf(DeepgramSttClient);
    expect(client.provider).toBe('deepgram');
  });

  it('raises INTERNAL rather than constructing a keyless deepgram client', () => {
    // loadConfig blocks this, so reach past it to prove the factory guards too.
    const cfg = { ...loadConfig({}), sttProvider: 'deepgram' as const, deepgramApiKey: undefined };
    expect(() => createSttClient(cfg, 'rough', FIXTURE_DIR)).toThrow(CoachError);
  });

  it('raises INTERNAL for the unimplemented assemblyai branch', () => {
    const cfg = { ...loadConfig({}), sttProvider: 'assemblyai' as const };
    let thrown: unknown;
    try {
      createSttClient(cfg, 'rough', FIXTURE_DIR);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('INTERNAL');
  });
});
