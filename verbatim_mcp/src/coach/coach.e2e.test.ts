import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoachTools } from './coach.tools.js';
import { CoachService } from './coach.service.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';
import { DeliveryReport, isAllowedAudioUrl } from '../domain/contracts/index.js';

const fixtureDir = join(process.cwd(), 'fixtures');
const golden = (label: string) => JSON.parse(readFileSync(join(fixtureDir, `report.${label}.json`), 'utf8')) as DeliveryReport;
const stripUrl = (r: DeliveryReport) => { const { audioUrl, ...rest } = r; return rest; };
const ctx = () => ({ toolName: 'analyze_delivery', logger: { info() {}, warn() {}, error() {}, debug() {} } }) as never;

function tools() {
  // ENABLE_PROSODY=false: the goldens were generated with an empty ProsodyTrack.
  const config = new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }));
  const svc = new CoachService(config, new FixtureContextProvider(config), new FixtureCalendarConnector(), new FixtureGmailConnector());
  return new CoachTools(svc);
}

describe.each(['rough', 'clean'])('analyze_delivery — %s take (golden lock)', (label) => {
  it('deep-equals the committed golden report, modulo audioUrl', async () => {
    const actual = await tools().analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx());
    expect(DeliveryReport.safeParse(actual).success).toBe(true);
    expect(stripUrl(actual)).toEqual(stripUrl(golden(label)));
  });

  it('produces a widget-loadable audioUrl', async () => {
    const actual = await tools().analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx());
    expect(actual.audioUrl).toBe(`/api/audio/${label}`);
    expect(isAllowedAudioUrl(actual.audioUrl!)).toBe(true);
    // The golden carries a DIFFERENT url; that's exactly why it is excluded above.
    expect(actual.audioUrl).not.toBe(golden(label).audioUrl);
  });

  it('is byte-stable across repeated runs', async () => {
    const t = tools();
    const [a, b] = await Promise.all([
      t.analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx()),
      t.analyzeDelivery({ takeId: label, now: '2026-07-25T09:00:00Z' }, ctx()),
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the numbers the demo turns on', () => {
  it('rough: exactly one high-severity stress_mismatch on seg-005, calendar next step', async () => {
    const r = await tools().analyzeDelivery({ takeId: 'rough', now: '2026-07-25T09:00:00Z' }, ctx());
    const high = r.issues.filter((i) => i.severity === 'high');
    expect(high).toHaveLength(1);
    expect(high[0]!.segmentId).toBe('seg-005');
    expect(high[0]!.type).toBe('stress_mismatch');
    expect(r.fillerCount).toBe(2);
    expect(r.nextStep!.kind).toBe('calendar_reminder');
    expect(r.nextStep!.executed).toBe(false);
  });

  it('clean: two low-severity issues, zero fillers, draft-note next step', async () => {
    const r = await tools().analyzeDelivery({ takeId: 'clean', now: '2026-07-25T09:00:00Z' }, ctx());
    expect(r.issues).toHaveLength(2);
    expect(r.issues.every((i) => i.severity === 'low')).toBe(true);
    expect(r.fillerCount).toBe(0);
    expect(r.nextStep!.kind).toBe('draft_note');
    expect(r.nextStep!.executed).toBe(false);
  });
});
