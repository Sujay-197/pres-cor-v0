import { describe, expect, it } from 'vitest';
import { CoachError } from '@nsh/core-logic';
import { describeConfig, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies the documented defaults when the environment is empty', () => {
    const cfg = loadConfig({});
    expect(cfg).toEqual({
      port: 8787,
      sttProvider: 'fixture',
      deepgramApiKey: undefined,
      enableProsody: true,
      audioMaxSeconds: 180,
      uploadMaxBytes: 26_214_400,
      logLevel: 'info',
    });
  });

  it('coerces numeric and boolean environment strings', () => {
    const cfg = loadConfig({
      PORT: '9001',
      ENABLE_PROSODY: 'false',
      AUDIO_MAX_SECONDS: '30',
      UPLOAD_MAX_BYTES: '1024',
      LOG_LEVEL: 'debug',
    });
    expect(cfg.port).toBe(9001);
    expect(cfg.enableProsody).toBe(false);
    expect(cfg.audioMaxSeconds).toBe(30);
    expect(cfg.uploadMaxBytes).toBe(1024);
    expect(cfg.logLevel).toBe('debug');
  });

  it('treats ENABLE_PROSODY=true as enabled', () => {
    expect(loadConfig({ ENABLE_PROSODY: 'true' }).enableProsody).toBe(true);
  });

  it('fails at boot when STT_PROVIDER=deepgram and no key is present', () => {
    let thrown: unknown;
    try {
      loadConfig({ STT_PROVIDER: 'deepgram' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).code).toBe('INTERNAL');
    expect((thrown as CoachError).message).toContain('DEEPGRAM_API_KEY');
  });

  it('accepts STT_PROVIDER=deepgram when a key is present, without exposing it', () => {
    const cfg = loadConfig({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'dummy-not-a-real-key' });
    expect(cfg.sttProvider).toBe('deepgram');
    expect(typeof cfg.deepgramApiKey).toBe('string');
    // describeConfig is what /api/health and the boot log use — it must report
    // presence only, never the value.
    const described = describeConfig(cfg);
    expect(described).toEqual({ sttProvider: 'deepgram', prosodyEnabled: true, deepgramKeyPresent: true });
    expect(JSON.stringify(described)).not.toContain('dummy-not-a-real-key');
  });

  it('rejects an invalid enum value as a CoachError naming only the key', () => {
    let thrown: unknown;
    try {
      loadConfig({ LOG_LEVEL: 'loud', DEEPGRAM_API_KEY: 'dummy-not-a-real-key' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoachError);
    expect((thrown as CoachError).message).toContain('LOG_LEVEL');
    expect((thrown as CoachError).message).not.toContain('dummy-not-a-real-key');
  });

  it('ignores unrelated environment variables', () => {
    expect(loadConfig({ PATH: '/usr/bin', HOME: '/root' }).sttProvider).toBe('fixture');
  });
});
