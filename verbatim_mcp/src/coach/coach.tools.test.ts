import { describe, expect, it } from 'vitest';
import { CoachTools } from './coach.tools.js';
import { CoachService } from './coach.service.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';

function tools() {
  const config = new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }));
  const svc = new CoachService(config, new FixtureContextProvider(config), new FixtureCalendarConnector(), new FixtureGmailConnector());
  return new CoachTools(svc);
}
const ctx = () => ({ toolName: 't', logger: { info() {}, error() {}, warn() {}, debug() {} } }) as never;

describe('CoachTools', () => {
  it('parse_script returns deterministic seg-NNN ids', async () => {
    const segs = await tools().parseScript({ raw: 'Intro line.\n\n**Key stat** is 98 percent.' }, ctx());
    expect(segs[0]!.id).toBe('seg-001');
    expect(segs[1]!.isKeyPoint).toBe(true);
  });

  it('analyze_delivery returns a full report the widget can render', async () => {
    const report = await tools().analyzeDelivery({ takeId: 'rough', now: '2026-07-25T09:00:00Z' }, ctx());
    expect(report.status).toBe('ready');
    expect(report.issues.some((i) => i.severity === 'high')).toBe(true);
    expect(report.nextStep!.executed).toBe(false);
  });

  it('suggest_next_step with execute:true flips executed', async () => {
    const t = tools();
    const report = await t.analyzeDelivery({ takeId: 'rough', now: '2026-07-25T09:00:00Z' }, ctx());
    const ns = await t.suggestNextStep({ report, takeId: 'rough', now: '2026-07-25T09:00:00Z', execute: true }, ctx());
    expect(ns.executed).toBe(true);
  });
});
