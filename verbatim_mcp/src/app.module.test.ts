import { describe, expect, it } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('scaffold cleanup', () => {
  it('has removed the pizzaz module', () => {
    expect(existsSync(join(process.cwd(), 'src/modules/pizzaz'))).toBe(false);
  });

  it('AppModule source no longer references pizzaz', () => {
    const src = readdirSync(join(process.cwd(), 'src'));
    expect(src).toContain('app.module.ts');
    const text = require('node:fs').readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    expect(text.toLowerCase()).not.toContain('pizzaz');
  });
});
