// apps/server/src/adapters/stt-client.ts
//
// This is your critical path (TEAM_PLANS h2-4). Two jobs, both important:
//   1. Talk to Deepgram, get words back.
//   2. Convert everything to OUR shape before it goes anywhere else.
//
// The one rule that matters most here (CONVENTIONS §3): Deepgram gives
// timestamps in milliseconds. We convert to seconds RIGHT HERE, once.
// After this file, nobody else in the whole codebase should ever see a
// millisecond again. If you ever catch a bug where two numbers don't
// line up, check here first — it's almost always a units mismatch.

import { config } from '../config';
import type { Word, Transcript } from '../contracts-stub';

// Words that count as "filler" regardless of what the vendor tags.
// Deepgram flags "uh" and "um" on its own (filler_words=true), but we
// still run everything through this list ourselves so behavior is
// identical no matter which vendor we're using (CONVENTIONS §4).
const FILLER_LEXICON = new Set(['um', 'uh', 'like', 'you know', 'so', 'actually', 'basically']);

export interface SttClient {
  transcribe(pcm: Buffer, sampleRate: number): Promise<Transcript>;
}

// ---- Real implementation: talks to Deepgram ----

interface DeepgramWord {
  word: string;
  start: number; // seconds already, per Deepgram's own docs — but DOUBLE
                  // CHECK this against a real response before trusting it.
                  // Some vendors return ms, some return seconds - verify,
                  // don't assume, since this is the exact bug class
                  // CONVENTIONS §3 is warning about.
  end: number;
}

interface DeepgramResponse {
  results: {
    channels: Array<{
      alternatives: Array<{
        words: DeepgramWord[];
      }>;
    }>;
  };
}

export class DeepgramSttClient implements SttClient {
  private readonly apiKey: string;

  constructor() {
    if (!config.DEEPGRAM_API_KEY) {
      throw new Error('DeepgramSttClient requires DEEPGRAM_API_KEY');
    }
    this.apiKey = config.DEEPGRAM_API_KEY;
  }

  async transcribe(pcm: Buffer, sampleRate: number): Promise<Transcript> {
    const url = `https://api.deepgram.com/v1/listen?model=nova-3&filler_words=true&encoding=linear16&sample_rate=${sampleRate}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': 'audio/raw',
        },
        body: pcm as unknown as BodyInit,
      });
    } catch (err) {
      // Network failure -> CoachError so the tool boundary can map it
      // cleanly (CONVENTIONS §6: STT_FAILED).
      throw Object.assign(new Error('STT request failed'), { code: 'STT_FAILED', cause: err });
    }

    if (!res.ok) {
      throw Object.assign(new Error(`Deepgram returned ${res.status}`), { code: 'STT_FAILED' });
    }

    const body = (await res.json()) as DeepgramResponse;
    const rawWords = body.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];

    if (rawWords.length === 0) {
      throw Object.assign(new Error('No words in transcript'), { code: 'STT_FAILED' });
    }

    return { words: rawWords.map(toOurWord) };
  }
}

function toOurWord(w: DeepgramWord): Word {
  return {
    text: w.word,
    startSec: w.start, // <- the ONE place a vendor number becomes our number
    endSec: w.end,
    isFiller: FILLER_LEXICON.has(w.word.toLowerCase()),
  };
}

// ---- Fixture implementation: offline fallback ----
//
// Build this NOW, not at hour 22 (TEAM_PLANS explicitly calls this out).
// Set STT_PROVIDER=fixture and this replays a saved transcript instead of
// calling Deepgram at all — this is what saves the demo if venue wifi dies.

import * as fs from 'fs/promises';

export class FixtureSttClient implements SttClient {
  constructor(private readonly fixturePath: string) {}

  async transcribe(): Promise<Transcript> {
    // Note: real signature takes (pcm, sampleRate) to match the interface,
    // but this implementation ignores both — it just replays the file
    // that was frozen ahead of time for exactly this recording.
    const raw = await fs.readFile(this.fixturePath, 'utf-8');
    const parsed = JSON.parse(raw) as Transcript;
    return parsed;
  }
}

// ---- Factory: picks the right one based on config ----
//
// This is the ONLY place that should read config.STT_PROVIDER — keeps the
// "one env read, one place" rule (CONVENTIONS §9) intact even as we add
// a second provider (assemblyai) later.

export function createSttClient(fixturePath?: string): SttClient {
  switch (config.STT_PROVIDER) {
    case 'deepgram':
      return new DeepgramSttClient();
    case 'fixture':
      if (!fixturePath) {
        throw new Error('STT_PROVIDER=fixture requires a fixturePath');
      }
      return new FixtureSttClient(fixturePath);
    case 'assemblyai':
      throw new Error('AssemblyAI adapter not built — Deepgram is primary, this is a stretch goal');
    default:
      throw new Error(`Unknown STT_PROVIDER: ${config.STT_PROVIDER}`);
  }
}
