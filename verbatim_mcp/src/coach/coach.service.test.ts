import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoachService } from './coach.service.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';
import { DeliveryReport } from '../domain/contracts/index.js';

const fixtureDir = join(process.cwd(), 'fixtures');
const golden = (label: string) => JSON.parse(readFileSync(join(fixtureDir, `report.${label}.json`), 'utf8')) as DeliveryReport;
const stripUrl = (r: DeliveryReport) => { const { audioUrl, ...rest } = r; return rest; };

function service() {
  const config = new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }));
  return new CoachService(config, new FixtureContextProvider(config), new FixtureCalendarConnector(), new FixtureGmailConnector());
}

describe('CoachService.analyze', () => {
  it.each(['rough', 'clean'])('reproduces the golden %s report modulo audioUrl', async (label) => {
    const report = await service().analyze({ takeId: label, now: '2026-07-25T09:00:00Z' });
    expect(DeliveryReport.safeParse(report).success).toBe(true);
    expect(stripUrl(report)).toEqual(stripUrl(golden(label)));
  });

  it('SECURITY: analyze never executes the next step (executed stays false)', async () => {
    const report = await service().analyze({ takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    expect(report.nextStep!.executed).toBe(false);
    expect(report.nextStep!.kind).toBe('calendar_reminder');
  });
});

describe('CoachService.suggestNextStep execute-gating', () => {
  it('proposes without firing a connector when execute is false', async () => {
    const svc = service();
    const report = await svc.analyze({ takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    const ns = await svc.suggestNextStep({ report, takeId: 'rough', now: '2026-07-25T09:00:00Z', execute: false });
    expect(ns.executed).toBe(false);
  });

  it('fires the connector and flips executed:true only when execute is true', async () => {
    const svc = service();
    const report = await svc.analyze({ takeId: 'rough', now: '2026-07-25T09:00:00Z' });
    const ns = await svc.suggestNextStep({ report, takeId: 'rough', now: '2026-07-25T09:00:00Z', execute: true });
    expect(ns.executed).toBe(true);
  });
});
