import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextStep, type DeliveryReport } from '@nsh/contracts';
import { decideNextStep } from '@nsh/core-logic';
import { loadConfig } from '../config.js';
import { createDeps, type ServerDeps } from '../pipeline.js';
import { FIXTURE_DIR } from '../takes.js';
import type { CalendarConnector, GmailConnector } from '../adapters/connectors.js';
import { suggestNextStepTool } from './suggest-next-step.tool.js';

const NOW = '2026-07-25T09:00:00Z';

const golden = (label: string): DeliveryReport =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `report.${label}.json`), 'utf8')) as DeliveryReport;

interface Spies {
  calendarCalls: Array<[string, string]>;
  gmailCalls: Array<[string, string, string | null]>;
  deps: ServerDeps;
}

function spyDeps(): Spies {
  const calendarCalls: Array<[string, string]> = [];
  const gmailCalls: Array<[string, string, string | null]> = [];
  const calendar: CalendarConnector = {
    createReminder: async (title, startsAt) => {
      calendarCalls.push([title, startsAt]);
      return { id: 'spy-event-1' };
    },
  };
  const gmail: GmailConnector = {
    draft: async (subject, body, to) => {
      gmailCalls.push([subject, body, to]);
      return { id: 'spy-draft-1' };
    },
  };
  const deps = createDeps(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }), {
    calendar,
    gmail,
    clock: () => {
      throw new Error('the clock must not be read when `now` is pinned');
    },
  });
  return { calendarCalls, gmailCalls, deps };
}

describe('suggestNextStepTool — proposing (the /api/analyze path)', () => {
  it.each(['rough', 'clean'])('reproduces report.%s.json nextStep with executed false', async (label) => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden(label), nextStep: null };
    const step = await suggestNextStepTool({ report, takeId: label, now: NOW }, deps);

    expect(NextStep.safeParse(step).success).toBe(true);
    expect(step).toEqual(golden(label).nextStep);
    expect(step.executed).toBe(false);
    // Nothing fired. `executed: false` means "proposed, awaiting confirmation".
    expect(calendarCalls).toEqual([]);
    expect(gmailCalls).toEqual([]);
  });

  it('is exactly decideNextStep against the fixture context when not executing', async () => {
    const { deps } = spyDeps();
    const report = { ...golden('rough'), nextStep: null };
    const ctx = await deps.context.nextStepContext('rough', NOW);
    expect(await suggestNextStepTool({ report, takeId: 'rough', now: NOW }, deps)).toEqual(
      decideNextStep(report, ctx),
    );
  });
});

describe('suggestNextStepTool — executing (the confirm path)', () => {
  it('fires the calendar connector and flips only `executed` for the rough take', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden('rough'), nextStep: null };
    const proposed = await suggestNextStepTool({ report, takeId: 'rough', now: NOW }, deps);
    const executed = await suggestNextStepTool({ report, takeId: 'rough', now: NOW, execute: true }, deps);

    expect(executed).toEqual({ ...proposed, executed: true });
    expect(calendarCalls).toEqual([[proposed.eventTitle!, proposed.eventStartsAt!]]);
    expect(gmailCalls).toEqual([]);
  });

  it('fires the gmail connector and flips only `executed` for the clean take', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden('clean'), nextStep: null };
    const proposed = await suggestNextStepTool({ report, takeId: 'clean', now: NOW }, deps);
    const executed = await suggestNextStepTool({ report, takeId: 'clean', now: NOW, execute: true }, deps);

    expect(executed).toEqual({ ...proposed, executed: true });
    expect(gmailCalls).toEqual([[proposed.draftSubject!, proposed.draftBody!, proposed.recipientHint]]);
    expect(calendarCalls).toEqual([]);
  });

  it('executes nothing and leaves the flag false when kind is none', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report: DeliveryReport = { ...golden('rough'), nextStep: null, status: 'analyzing' };
    const step = await suggestNextStepTool({ report, takeId: 'rough', now: NOW, execute: true }, deps);

    expect(step.kind).toBe('none');
    expect(step.executed).toBe(false);
    expect(calendarCalls).toEqual([]);
    expect(gmailCalls).toEqual([]);
  });

  it('honours a pinned `now` that moves the decision past the calendar event', async () => {
    const { deps, calendarCalls, gmailCalls } = spyDeps();
    const report = { ...golden('rough'), nextStep: null };
    const step = await suggestNextStepTool(
      { report, takeId: 'rough', now: '2030-01-01T00:00:00Z', execute: true },
      deps,
    );
    expect(step.kind).toBe('draft_note');
    expect(step.executed).toBe(true);
    expect(calendarCalls).toEqual([]);
    expect(gmailCalls).toHaveLength(1);
  });
});
