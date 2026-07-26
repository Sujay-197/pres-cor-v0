#!/usr/bin/env node
// scripts/transcribe.mjs
//
// Dev tool, not shipped. Turns a recording into a frozen Transcript fixture.
// Run:  node --env-file=.env scripts/transcribe.mjs fixtures/audio/take-rough.m4a rough
//
// smart_format and numerals are OFF on purpose: both rewrite spoken numbers
// into digits ("ninety-eight percent" -> "98%"), which would sabotage
// text-matching against the script. We want verbatim tokens.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const [audioPath, label] = process.argv.slice(2);
if (!audioPath || !label) {
  console.error('usage: node --env-file=.env scripts/transcribe.mjs <audio> <clean|rough>');
  process.exit(1);
}

const key = process.env.DEEPGRAM_API_KEY;
if (!key) {
  console.error('DEEPGRAM_API_KEY not set. Run with --env-file=.env');
  process.exit(1);
}

const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
               '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg' };
const ext = extname(audioPath).toLowerCase();
const contentType = MIME[ext];
if (!contentType) {
  console.error(`unsupported extension ${ext}; supported: ${Object.keys(MIME).join(', ')}`);
  process.exit(1);
}

const params = new URLSearchParams({
  model: 'nova-3',
  filler_words: 'true',
  punctuate: 'true',
  smart_format: 'false',
  numerals: 'false',
});

console.log(`transcribing ${basename(audioPath)} ...`);
const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
  method: 'POST',
  headers: { Authorization: `Token ${key}`, 'Content-Type': contentType },
  body: readFileSync(audioPath),
});

if (!res.ok) {
  console.error(`deepgram ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
const alt = body.results?.channels?.[0]?.alternatives?.[0];
if (!alt?.words?.length) {
  console.error('no words returned; check the audio file');
  process.exit(1);
}

// Deepgram already returns seconds as floats. Round to 3dp so the fixture is
// stable and diffable; CONVENTIONS §3 forbids milliseconds anywhere downstream.
const r3 = (n) => Math.round(n * 1000) / 1000;

const transcript = {
  provider: 'deepgram',
  durationSec: r3(body.metadata?.duration ?? alt.words.at(-1).end),
  words: alt.words.map((w) => ({
    text: w.word,
    start: r3(w.start),
    end: r3(w.end),
    confidence: Math.round((w.confidence ?? 0) * 1000) / 1000,
    isFiller: false, // finalised by alignSegments — soft fillers need alignment
  })),
};

const out = join('packages/contracts/fixtures', `transcript.${label}.json`);
writeFileSync(out, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
console.log(`wrote ${out} — ${transcript.words.length} words, ${transcript.durationSec}s`);
console.log(`transcript: ${alt.transcript.slice(0, 160)}...`);
