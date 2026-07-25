// apps/server/src/tools/transcribe-delivery.tool.ts
//
// The one tool with a real vendor call inside it (ARCHITECTURE_BRIEF §3:
// "our own key only inside a tool doing internal reasoning"). This is
// YOUR critical path (TEAM_PLANS h2-4), separate from the merge-point work.
//
// Two halves:
//   1. audio -> Transcript, via SttClient (you own this fully, see
//      adapters/stt-client.ts — not built yet, next task after this).
//   2. Transcript -> ProsodyTrack, via P1's extractProsody (merge point).
// This tool's body wires both; neither half is "your logic" to write
// beyond the adapter — extractProsody is core-logic, per TEAM_PLANS h5-6.

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createSttClient } from '../adapters/stt-client';
import { normalizeToPcm, SAMPLE_RATE } from '../adapters/audio-normalize';
// import { extractProsody } from '@nsh/core-logic'; // uncomment at merge (h5-6)

const InputSchema = z.object({
  audioUrl: z.string(),
});

// Output is Tier-2 (Transcript + ProsodyTrack combined) — never leaves the
// server, so no need to import from contracts-stub; shape is whatever P1's
// correlateSegments expects as input. Confirm signature at hour 1 gate.
const OutputSchema = z.object({
  transcript: z.unknown(),
  prosody: z.unknown(),
});

@Injectable()
export class TranscribeDeliveryTool {
  // constructor(private readonly sttClient: SttClient) {}

  // @Tool({
  //   name: 'transcribe_delivery',
  //   description:
  //     'Audio -> timestamped transcript + prosody features (pitch, ' +
  //     'pace/WPM, pauses, volume). Wraps a speech-to-text + prosody model.',
  //   inputSchema: InputSchema,
  //   outputSchema: OutputSchema,
  // })
  async execute(input: z.infer<typeof InputSchema>): Promise<z.infer<typeof OutputSchema>> {
    // 1. Normalize whatever audio format came in to 16kHz mono PCM.
    const pcm = await normalizeToPcm(input.audioUrl);

    // 2. Transcribe. createSttClient picks Deepgram or the fixture replay
    //    based on STT_PROVIDER in config — nothing here needs to know
    //    which one it's talking to.
    const sttClient = createSttClient(fixturePathFor(input.audioUrl));
    const transcript = await sttClient.transcribe(pcm, SAMPLE_RATE);

    // 3. MERGE POINT (h5-6, not yet): const prosody = extractProsody(pcm, SAMPLE_RATE);
    //    extractProsody is deliberately last on P1's list — three of four
    //    issue types need no DSP at all, so this tool is fully testable
    //    against real transcripts before prosody exists. Ship this half
    //    now, don't wait.
    const prosody = null; // TODO(merge h5-6): replace with extractProsody(...)

    return { transcript, prosody };
  }
}

// When STT_PROVIDER=fixture, we need to know WHICH saved transcript to
// replay for a given recording. Simple convention: same filename, .json
// instead of the audio extension, living next to it. Adjust once P4
// settles on the actual fixtures/audio/ layout (TEAM_PLANS §P4).
function fixturePathFor(audioUrl: string): string {
  return audioUrl.replace(/\.[^/.]+$/, '.json');
}
