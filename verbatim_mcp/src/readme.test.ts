import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('README demo instructions', () => {
  it('documents the analyze_delivery demo and the required env vars', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('analyze_delivery');
    expect(readme).toContain('STT_PROVIDER');
    expect(readme).toContain('delivery-timeline');
    expect(readme.toLowerCase()).toContain('nitrostudio');
  });
});
