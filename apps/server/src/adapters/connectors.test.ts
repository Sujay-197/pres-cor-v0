import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextStepContext, type DeliveryReport } from '@nsh/contracts';
import { decideNextStep } from '@nsh/core-logic';
import type { Logger } from '../audit.js';
import { FIXTURE_DIR } from '../takes.js';
import {
  FixtureCalendarConnector,
  FixtureContextProvider,
  FixtureGmailConnector,
  NEUTRAL_CONTEXT,
} from './connectors.js';

const loadReport = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

describe('FixtureContextProvider', () => {
  it('returns a contract-valid context for each staged take', async () => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    for (const takeId of ['rough', 'clean']) {
      const ctx = await provider.nextStepContext(takeId, '2026-07-25T09:00:00Z');
      expect(NextStepContext.safeParse(ctx).success).toBe(true);
    }
  });

  /**
   * The extraction is only correct if the values still drive the committed
   * reports. Feeding the fixture context back through decideNextStep must
   * reproduce each golden report's nextStep exactly — that is a stronger check
   * than eyeballing the JSON, and it cannot pass on a hand-guessed constant.
   */
  it.each(['rough', 'clean'])('reproduces report.%s.json nextStep exactly', async (label) => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    const golden = loadReport(label);
    const ctx = await provider.nextStepContext(label, '2026-07-25T09:00:00Z');
    expect(decideNextStep(golden, ctx)).toEqual(golden.nextStep);
  });

  it('lets the caller pin `now`, overriding the value recorded in the fixture', async () => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    const ctx = await provider.nextStepContext('rough', '2030-01-01T00:00:00Z');
    expect(ctx.now).toBe('2030-01-01T00:00:00Z');
    // The rough take's event is in 2026, so pinning `now` past it changes the
    // branch — proof the override is real and not cosmetic.
    expect(decideNextStep(loadReport('rough'), ctx).kind).toBe('draft_note');
  });

  it('gives an unknown take a neutral context so uploads still get a next step', async () => {
    const provider = new FixtureContextProvider(FIXTURE_DIR);
    const ctx = await provider.nextStepContext('up-0123456789ab', '2026-07-25T09:00:00Z');
    expect(ctx).toEqual({ ...NEUTRAL_CONTEXT, now: '2026-07-25T09:00:00Z' });
    expect(decideNextStep(loadReport('rough'), ctx).kind).toBe('draft_note');
  });
});

describe('fixture writers', () => {
  it('returns a deterministic calendar id and logs metadata only', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const log: Logger = (level, message, meta) => lines.push({ level, message, ...(meta ?? {}) });
    const calendar = new FixtureCalendarConnector(log);

    const first = await calendar.createReminder('Northwind investor call', '2026-07-27T14:00:00Z');
    const again = await calendar.createReminder('Northwind investor call', '2026-07-27T14:00:00Z');
    const other = await calendar.createReminder('Other call', '2026-07-27T14:00:00Z');

    expect(first.id).toBe(again.id);
    expect(first.id).not.toBe(other.id);
    expect(first.id.startsWith('fixture-event-')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[0]!['message']).toBe('connector.calendar.createReminder');
  });

  it('returns a deterministic draft id without echoing the body', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const log: Logger = (level, message, meta) => lines.push({ level, message, ...(meta ?? {}) });
    const gmail = new FixtureGmailConnector(log);

    const draft = await gmail.draft('Could you watch this once?', 'Hi Priya — I have rehearsed this...', 'Priya');
    expect(draft.id.startsWith('fixture-draft-')).toBe(true);
    expect(await gmail.draft('Could you watch this once?', 'Hi Priya — I have rehearsed this...', 'Priya')).toEqual(draft);
    expect(JSON.stringify(lines)).not.toContain('rehearsed this');
  });
});
