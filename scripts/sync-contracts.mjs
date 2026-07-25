#!/usr/bin/env node
/**
 * Escape hatch for CONVENTIONS.md §2.
 *
 * If NitroStudio's generators fight the npm workspace and `@nsh/contracts`
 * will not resolve, run `npm run sync:contracts` to vendor the file in
 * verbatim. Nobody is ever blocked on module resolution during a 24h build.
 *
 * The copies are GENERATED. Edit packages/contracts/src/index.ts, never a copy.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages/contracts/src/index.ts');

/** Targets that may need a vendored copy. Skipped silently if absent. */
const targets = [
  'apps/server/src/contracts.generated.ts',
  'packages/widget/src/contracts.generated.ts',
];

const banner = [
  '/* GENERATED FILE — DO NOT EDIT.',
  ' * Copied from packages/contracts/src/index.ts by scripts/sync-contracts.mjs.',
  ' * Edit the original and re-run `npm run sync:contracts`.',
  ' */',
  '',
].join('\n');

if (!existsSync(source)) {
  console.error(`contracts source missing: ${source}`);
  process.exit(1);
}

const body = readFileSync(source, 'utf8');
let written = 0;

for (const rel of targets) {
  const dest = join(root, rel);
  const parent = dirname(dest);
  if (!existsSync(parent)) {
    console.log(`skip  ${rel} (no such workspace yet)`);
    continue;
  }
  mkdirSync(parent, { recursive: true });
  writeFileSync(dest, banner + body, 'utf8');
  console.log(`write ${rel}`);
  written++;
}

// Fixtures travel with the types — the widget needs them to render.
const fixtureTargets = ['packages/widget/src/fixtures', 'apps/server/fixtures'];
for (const rel of fixtureTargets) {
  const destDir = join(root, rel);
  if (!existsSync(dirname(destDir))) continue;
  mkdirSync(destDir, { recursive: true });
  for (const f of ['report.clean.json', 'report.rough.json', 'script.demo.md']) {
    copyFileSync(join(root, 'packages/contracts/fixtures', f), join(destDir, f));
  }
  console.log(`write ${rel}/*`);
}

console.log(written ? `\nsynced ${written} target(s).` : '\nnothing to sync yet.');
