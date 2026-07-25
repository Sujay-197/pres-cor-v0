import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { GENERIC_MESSAGE } from './errors.js';
import { FIXTURE_DIR } from './takes.js';
import { bootstrap } from './main.js';

const AUDIO_BYTES = Buffer.from('0123456789abcdef');

let base: string;
let close: () => Promise<void>;
let audioDir: string;
let uploadDir: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'nsh-http-'));
  audioDir = join(root, 'audio');
  uploadDir = join(audioDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(join(audioDir, 'take-rough.m4a'), AUDIO_BYTES);

  const booted = await bootstrap(
    loadConfig({ PORT: '0', STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false', UPLOAD_MAX_BYTES: '64' }),
    { audioDir, uploadDir, fixtureDir: FIXTURE_DIR, log: () => {} },
  );
  base = `http://127.0.0.1:${booted.port}`;
  close = booted.close;
});

afterAll(async () => {
  await close();
});

const postJson = (path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/health', () => {
  it('reports readiness and the effective adapter selection, never the key', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, sttProvider: 'fixture', prosodyEnabled: false, deepgramKeyPresent: false });
  });
});

describe('GET /api/takes', () => {
  it('lists the staged takes with their frozen-transcript flag', async () => {
    const res = await fetch(`${base}/api/takes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { takes: Array<{ id: string; hasFrozenTranscript: boolean }> };
    expect(body.takes.map((t) => t.id)).toContain('rough');
    expect(body.takes.map((t) => t.id)).toContain('clean');
    expect(body.takes.find((t) => t.id === 'rough')!.hasFrozenTranscript).toBe(true);
  });
});

describe('GET /api/audio/:takeId', () => {
  it('serves the whole file with a mime type and advertises range support', async () => {
    const res = await fetch(`${base}/api/audio/rough`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(AUDIO_BYTES);
  });

  it('honours a byte range so the scrubber can seek', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=4-7' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 4-7/${AUDIO_BYTES.length}`);
    expect(res.headers.get('content-length')).toBe('4');
    expect(await res.text()).toBe('4567');
  });

  it('honours an open-ended range', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=12-' } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('cdef');
  });

  it('honours a suffix range', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=-3' } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('def');
  });

  it('rejects an unsatisfiable range with 416', async () => {
    const res = await fetch(`${base}/api/audio/rough`, { headers: { Range: 'bytes=999-1000' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${AUDIO_BYTES.length}`);
  });

  it('404s a take with no audio on disk', async () => {
    const res = await fetch(`${base}/api/audio/clean`);
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'NOT_FOUND', message: 'No audio for take "clean".' },
    });
  });
});

describe('POST /api/analyze', () => {
  it('returns a live report for a staged take', async () => {
    const res = await postJson('/api/analyze', { takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { reportId: string; audioUrl: string; issues: unknown[] };
    expect(report.reportId).toBe('rpt-demo-rough');
    expect(report.audioUrl).toBe('/api/audio/rough');
    expect(report.issues).toHaveLength(6);
  });

  it('404s an unknown take', async () => {
    const res = await postJson('/api/analyze', { takeId: 'nope' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('400s a malformed body without leaking internals', async () => {
    const res = await postJson('/api/analyze', { takeId: 42 });
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid request body.' },
    });
  });

  it('maps SCRIPT_EMPTY to 400 with the CoachError message', async () => {
    const res = await postJson('/api/analyze', { takeId: 'rough', script: '   ' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SCRIPT_EMPTY');
    expect(body.error.message).not.toBe(GENERIC_MESSAGE);
  });
});

describe('POST /api/tools/:name', () => {
  it('runs a single named tool', async () => {
    const res = await postJson('/api/tools/parse_script', { raw: 'One line.\n\nAnother line.' });
    expect(res.status).toBe(200);
    const segments = (await res.json()) as Array<{ id: string }>;
    expect(segments.map((s) => s.id)).toEqual(['seg-001', 'seg-002']);
  });

  it('runs transcribe_delivery and returns a DeliverySignal', async () => {
    const res = await postJson('/api/tools/transcribe_delivery', { takeId: 'rough' });
    expect(res.status).toBe(200);
    const signal = (await res.json()) as { transcript: { words: unknown[] }; prosody: { frames: unknown[] } };
    expect(signal.transcript.words).toHaveLength(91);
    expect(signal.prosody.frames).toEqual([]);
  });

  it('404s an unknown tool name', async () => {
    const res = await postJson('/api/tools/definitely_not_a_tool', {});
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('400s a body the tool schema rejects', async () => {
    const res = await postJson('/api/tools/transcribe_delivery', { takeId: '' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('502s an STT failure', async () => {
    const res = await postJson('/api/tools/transcribe_delivery', { takeId: 'up-000000000000' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STT_FAILED');
  });
});

describe('POST /api/uploads', () => {
  it('stores the file under a content-hash take id and makes it discoverable', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('tiny fake audio')], { type: 'audio/mpeg' }), 'clip.mp3');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const { takeId } = (await res.json()) as { takeId: string };
    expect(takeId.startsWith('up-')).toBe(true);

    const takes = (await (await fetch(`${base}/api/takes`)).json()) as { takes: Array<{ id: string }> };
    expect(takes.takes.map((t) => t.id)).toContain(takeId);

    const audio = await fetch(`${base}/api/audio/${takeId}`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('413s a file over UPLOAD_MAX_BYTES before writing anything to disk', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(200, 7)], { type: 'audio/mpeg' }), 'big.mp3');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPLOAD_TOO_LARGE');
  });

  it('415s an unsupported container', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('nope')], { type: 'audio/aiff' }), 'clip.aiff');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    expect(res.status).toBe(415);
  });

  it('400s a request with no file field', async () => {
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });
});
