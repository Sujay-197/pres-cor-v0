import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { FixtureSttClient, DeepgramSttClient, DEEPGRAM_QUERY, createSttClient } from './stt-client.js';
import { loadConfig } from '../config/app-config.service.js';

const fixtureDir = join(process.cwd(), 'fixtures');

describe('FixtureSttClient', () => {
  it('replays the committed transcript for a known take', async () => {
    const c = new FixtureSttClient(fixtureDir, 'rough');
    const t = await c.transcribe(new Uint8Array(0), 'audio/mp4');
    expect(t.provider).toBe('fixture');
    expect(t.words.length).toBeGreaterThan(0);
  });

  it('throws STT_FAILED for an unknown take', async () => {
    const c = new FixtureSttClient(fixtureDir, 'does-not-exist');
    await expect(c.transcribe(new Uint8Array(0), 'audio/mp4')).rejects.toMatchObject({ code: 'STT_FAILED' });
  });
});

describe('DeepgramSttClient', () => {
  it('keeps smart_format and numerals off (spoken-number matching)', () => {
    expect(DEEPGRAM_QUERY.smart_format).toBe('false');
    expect(DEEPGRAM_QUERY.numerals).toBe('false');
    expect(DEEPGRAM_QUERY.filler_words).toBe('true');
  });

  it('maps a vendor response to seconds and isFiller:false', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({
        metadata: { duration: 1.5 },
        results: { channels: [{ alternatives: [{ words: [{ word: 'hello', start: 0.1, end: 0.4, confidence: 0.9 }] }] }] },
      }), { status: 200 })) as unknown as typeof fetch;
    const c = new DeepgramSttClient('key', fakeFetch);
    const t = await c.transcribe(new Uint8Array([1]), 'audio/mp4');
    expect(t.words[0]!.isFiller).toBe(false);
    expect(t.words[0]!.start).toBe(0.1);
    expect(t.durationSec).toBe(1.5);
  });

  it('never leaks vendor error text — maps non-200 to STT_FAILED', async () => {
    const fakeFetch = (async () => new Response('unauthorized detail', { status: 401 })) as unknown as typeof fetch;
    const c = new DeepgramSttClient('key', fakeFetch);
    await expect(c.transcribe(new Uint8Array([1]), 'audio/mp4')).rejects.toMatchObject({ code: 'STT_FAILED' });
  });
});

describe('createSttClient', () => {
  it('returns the fixture client by default', () => {
    const c = createSttClient(loadConfig({}), 'rough', fixtureDir);
    expect(c.provider).toBe('fixture');
  });
});
