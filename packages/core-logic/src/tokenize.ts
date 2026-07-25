import { FILLER_LEXICON, type Word } from '@nsh/contracts';

/**
 * Hard fillers are never legitimate script words, so they can be tagged on
 * sight. Deepgram returns these directly under filler_words=true.
 */
export const HARD_FILLERS: ReadonlySet<string> = new Set(['uh', 'um', 'mm', 'mhmm', 'hmm', 'er', 'ah']);

/**
 * Soft fillers MAY be legitimate script words — script.demo.md:11 reads
 * "I'd like to talk about what the next twelve months look like". They are
 * only fillers when alignment shows they have no matching script token, so
 * they are resolved after alignment (see align.ts), never here.
 */
export const SOFT_FILLERS: readonly string[] = FILLER_LEXICON.filter((f) => !HARD_FILLERS.has(f));

const SOFT_BIGRAMS: ReadonlySet<string> = new Set(SOFT_FILLERS.filter((f) => f.includes(' ')));
const SOFT_UNIGRAMS: ReadonlySet<string> = new Set(SOFT_FILLERS.filter((f) => !f.includes(' ')));

/**
 * The single normalisation path. Script text and transcript words BOTH go
 * through this or alignment fails on punctuation alone.
 *
 * Hyphens split rather than collapse, so the script's "ninety-eight" and
 * Deepgram's "ninety eight" produce identical tokens. This is why the request
 * sets smart_format=false and numerals=false — with them on we would be
 * comparing "ninety-eight percent" against "98%".
 */
export function normaliseText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function isHardFiller(token: string): boolean {
  return HARD_FILLERS.has(token);
}

/** Returns how many tokens the soft filler at position `i` spans: 2, 1 or 0. */
export function isSoftFiller(tokens: string[], i: number): 0 | 1 | 2 {
  const first = tokens[i];
  if (first === undefined) return 0;
  const second = tokens[i + 1];
  if (second !== undefined && SOFT_BIGRAMS.has(`${first} ${second}`)) return 2;
  return SOFT_UNIGRAMS.has(first) ? 1 : 0;
}

/** Longest match wins — "you know" must beat a bare "know". */
export function fillerMatchLength(tokens: string[], i: number): 0 | 1 | 2 {
  const soft = isSoftFiller(tokens, i);
  if (soft > 0) return soft;
  const first = tokens[i];
  return first !== undefined && isHardFiller(first) ? 1 : 0;
}

/** Applies the hard-filler pass. Exported so P2's STT adapter classifies identically. */
export function tagHardFillers(words: Word[]): Word[] {
  return words.map((w) => ({ ...w, isFiller: isHardFiller(normaliseText(w.text)[0] ?? '') }));
}
