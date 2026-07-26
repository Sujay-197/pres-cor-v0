// apps/server/src/adapters/stt-client.ts
//
// Implements the frozen SttClient interface from @nsh/contracts exactly.
//
// DeepgramSttClient posts the RAW CONTAINER BYTES with the file's mime type —
// no decoding. That is the path already proven against real audio by
// scripts/transcribe.mjs, and the query params below are lifted from it
// unchanged. smart_format and numerals must stay off: both rewrite spoken
// numbers into digits, which destroys text matching against the script.
//
// This adapter does NOT classify fillers. It sets isFiller:false on every word
// and leaves classification to alignSegments, the only component that can tell
// a hedge from the same word used legitimately (design §5.1). There is exactly
// one FILLER_LEXICON in this repo and it lives in @nsh/contracts.

import { readFile } from 'node:fs/promises';
import { Transcript, type SttClient, type Word } from '../domain/contracts/index.js';
import { CoachError } from '../domain/core-logic/index.js';
import type { AppConfig } from '../config/app-config.service.js';
import { frozenTranscriptPath } from './takes.js';

export const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

/** Verbatim from scripts/transcribe.mjs. Do not "modernise" these. */
export const DEEPGRAM_QUERY: Record<string, string> = {
  model: 'nova-3',
  filler_words: 'true',
  punctuate: 'true',
  smart_format: 'false',
  numerals: 'false',
};

/** Deepgram returns seconds already. Round once, here, and never convert again. */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

interface DeepgramBody {
  metadata?: { duration?: number };
  results?: { channels?: Array<{ alternatives?: Array<{ words?: DeepgramWord[] }> }> };
}

export class FixtureSttClient implements SttClient {
  readonly provider = 'fixture';

  constructor(
    private readonly fixtureDir: string,
    private readonly takeId: string,
  ) {}

  async transcribe(_audio: Uint8Array, _mimeType: string): Promise<Transcript> {
    const path = frozenTranscriptPath(this.fixtureDir, this.takeId);
    if (path === null) {
      throw new CoachError('STT_FAILED', `No frozen transcript for take "${this.takeId}".`, {
        takeId: this.takeId,
      });
    }
    const raw = await readFile(path, 'utf8');
    const parsed = Transcript.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new CoachError('STT_FAILED', `Frozen transcript for take "${this.takeId}" does not match the contract.`, {
        takeId: this.takeId,
        issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

export class DeepgramSttClient implements SttClient {
  readonly provider = 'deepgram';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript> {
    const url = `${DEEPGRAM_URL}?${new URLSearchParams(DEEPGRAM_QUERY).toString()}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': mimeType,
        },
        // @types/node's Uint8Array is already a valid body for fetch.
        // No cast needed; TypeScript infers the correct type.
        body: audio,
      });
    } catch (cause) {
      throw new CoachError('STT_FAILED', 'Speech provider request failed.', {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    if (!res.ok) {
      // Vendor error text is never forwarded to the client (design §10).
      throw new CoachError('STT_FAILED', `Speech provider returned HTTP ${res.status}.`, {
        status: res.status,
      });
    }

    const body = (await res.json()) as DeepgramBody;
    const words = body.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
    if (words.length === 0) {
      throw new CoachError('STT_FAILED', 'Speech provider returned no words.');
    }

    const mapped: Word[] = words.map((w) => ({
      text: w.word,
      start: r3(w.start),
      end: r3(w.end),
      confidence: Math.round((w.confidence ?? 0) * 1000) / 1000,
      isFiller: false,
    }));

    const lastEnd = mapped[mapped.length - 1]!.end;
    const transcript: Transcript = {
      provider: this.provider,
      durationSec: r3(body.metadata?.duration ?? lastEnd),
      words: mapped,
    };

    const parsed = Transcript.safeParse(transcript);
    if (!parsed.success) {
      throw new CoachError('STT_FAILED', 'Speech provider response did not map to a valid transcript.', {
        issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

/**
 * The only place STT_PROVIDER is branched on. `takeId` exists for the fixture
 * client, which selects transcript.<takeId>.json; the real client ignores it.
 */
export function createSttClient(cfg: AppConfig, takeId: string, fixtureDir: string): SttClient {
  switch (cfg.sttProvider) {
    case 'fixture':
      return new FixtureSttClient(fixtureDir, takeId);
    case 'deepgram':
      if (cfg.deepgramApiKey === undefined) {
        throw new CoachError('INTERNAL', 'STT_PROVIDER=deepgram requires DEEPGRAM_API_KEY to be set.');
      }
      return new DeepgramSttClient(cfg.deepgramApiKey);
    case 'assemblyai':
      throw new CoachError('INTERNAL', 'AssemblyAI adapter is not implemented; use deepgram or fixture.');
  }
}
