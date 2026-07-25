import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeliveryReport, isAllowedAudioUrl } from '@nsh/contracts';
import { loadConfig } from './config.js';
import { FIXTURE_DIR } from './takes.js';
import { bootstrap } from './main.js';

const NOW = '2026-07-25T09:00:00Z';
const AUDIO_BYTES = Buffer.from('pretend this is a container');

let base: string;
let close: () => Promise<void>;

const golden = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

/**
 * audioUrl is environment-dependent by construction: the committed fixture says
 * /fixtures/take-rough.wav, the server says /api/audio/rough. It is stripped
 * from BOTH sides here, and asserted on separately below.
 */
function withoutAudioUrl(report: DeliveryReport): Omit<DeliveryReport, 'audioUrl'> {
  const { audioUrl: _excluded, ...rest } = report;
  return rest;
}

beforeAll(async () => {
  // A temp audio dir with placeholder files: the recordings are gitignored, and
  // with the fixture STT client and prosody off their contents are never read.
  // They exist so /api/audio/:takeId has something to serve.
  const root = mkdtempSync(join(tmpdir(), 'nsh-integration-'));
  const audioDir = join(root, 'audio');
  const uploadDir = join(audioDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  for (const label of ['rough', 'clean']) {
    writeFileSync(join(audioDir, `take-${label}.m4a`), AUDIO_BYTES);
  }

  const booted = await bootstrap(
    // ENABLE_PROSODY=false: the goldens were generated with an empty
    // ProsodyTrack, so byte-equality requires the same input here.
    loadConfig({ PORT: '0', STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }),
    {
      audioDir,
      uploadDir,
      fixtureDir: FIXTURE_DIR,
      log: () => {},
      clock: () => {
        throw new Error('the clock must not be read when `now` is pinned');
      },
    },
  );
  base = `http://127.0.0.1:${booted.port}`;
  close = booted.close;
});

afterAll(async () => {
  await close();
});

async function analyzeOverHttp(takeId: string): Promise<DeliveryReport> {
  const res = await fetch(`${base}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ takeId, now: NOW }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as DeliveryReport;
}

describe.each(['rough', 'clean'])('POST /api/analyze — %s take', (label) => {
  it('deep-equals the committed golden report, modulo audioUrl', async () => {
    const actual = await analyzeOverHttp(label);
    expect(DeliveryReport.safeParse(actual).success).toBe(true);
    expect(withoutAudioUrl(actual)).toEqual(withoutAudioUrl(golden(label)));
  });

  it('produces an audioUrl the widget can actually load', async () => {
    const actual = await analyzeOverHttp(label);
    expect(actual.audioUrl).toBe(`/api/audio/${label}`);
    expect(isAllowedAudioUrl(actual.audioUrl!)).toBe(true);

    const audio = await fetch(`${base}${actual.audioUrl!}`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(AUDIO_BYTES);
  });

  it('differs from the golden on audioUrl, which is why the field is excluded', async () => {
    const actual = await analyzeOverHttp(label);
    expect(golden(label).audioUrl).toBe(`/fixtures/take-${label}.wav`);
    expect(actual.audioUrl).not.toBe(golden(label).audioUrl);
  });

  it('is byte-stable across repeated calls', async () => {
    const [first, second] = await Promise.all([analyzeOverHttp(label), analyzeOverHttp(label)]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('the numbers the demo turns on', () => {
  it('puts exactly one high-severity stress_mismatch on seg-005 of the rough take', async () => {
    const report = await analyzeOverHttp('rough');
    const high = report.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
    expect(high[0]!.type).toBe('stress_mismatch');
    expect(report.fillerCount).toBe(2);
    expect(report.nextStep!.kind).toBe('calendar_reminder');
    expect(report.nextStep!.executed).toBe(false);
  });

  it('keeps the clean take clean', async () => {
    const report = await analyzeOverHttp('clean');
    expect(report.issues).toHaveLength(2);
    expect(report.issues.every((i) => i.severity === 'low')).toBe(true);
    expect(report.fillerCount).toBe(0);
    expect(report.nextStep!.kind).toBe('draft_note');
    expect(report.nextStep!.executed).toBe(false);
  });
});
