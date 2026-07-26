import { describe, expect, it } from 'vitest';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector, NEUTRAL_CONTEXT } from './connectors.js';
import { AppConfigService, loadConfig } from '../config/app-config.service.js';

const config = new AppConfigService(loadConfig({}));

describe('FixtureContextProvider', () => {
  it('returns the pinned now and rough events for the rough take', async () => {
    const cp = new FixtureContextProvider(config);
    const ctx = await cp.nextStepContext('rough', '2026-07-25T09:00:00Z');
    expect(ctx.now).toBe('2026-07-25T09:00:00Z');
    expect(ctx.upcomingEvents.length).toBeGreaterThan(0);
  });
  it('returns neutral context for an unknown take', async () => {
    const cp = new FixtureContextProvider(config);
    const ctx = await cp.nextStepContext('up-unknown', '2026-07-25T09:00:00Z');
    expect(ctx.upcomingEvents).toEqual(NEUTRAL_CONTEXT.upcomingEvents);
    expect(ctx.knownMentor).toBeNull();
  });
});

describe('connectors are deterministic', () => {
  it('calendar returns a stable synthetic id for identical inputs', async () => {
    const cal = new FixtureCalendarConnector();
    const a = await cal.createReminder('Pitch', '2026-07-27T14:00:00Z');
    const b = await cal.createReminder('Pitch', '2026-07-27T14:00:00Z');
    expect(a.id).toBe(b.id);
  });
  it('gmail returns a stable synthetic id for identical inputs', async () => {
    const gm = new FixtureGmailConnector();
    const a = await gm.draft('s', 'b', 'to');
    const b = await gm.draft('s', 'b', 'to');
    expect(a.id).toBe(b.id);
  });
});
