import { describe, expect, it } from 'vitest';
import { loadConfig, AppConfigService } from './app-config.service.js';

describe('loadConfig', () => {
  it('defaults to the fixture provider', () => {
    const cfg = loadConfig({});
    expect(cfg.sttProvider).toBe('fixture');
    expect(cfg.enableProsody).toBe(true);
  });

  it('parses "false" as boolean false, not truthy string', () => {
    // Boolean('false') === true — the schema must not use z.coerce.boolean().
    expect(loadConfig({ ENABLE_PROSODY: 'false' }).enableProsody).toBe(false);
  });

  it('throws when deepgram is selected without an API key', () => {
    expect(() => loadConfig({ STT_PROVIDER: 'deepgram' })).toThrow(/DEEPGRAM_API_KEY/);
  });

  it('never exposes the raw key via describe()', () => {
    const svc = new AppConfigService(loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'sk-secret' }));
    const described = svc.describe();
    expect(described.deepgramKeyPresent).toBe(true);
    expect(JSON.stringify(described)).not.toContain('sk-secret');
  });

  it('computes fixtureDir under the project root', () => {
    const svc = new AppConfigService(loadConfig({}));
    expect(svc.fixtureDir.endsWith('fixtures')).toBe(true);
  });
});
