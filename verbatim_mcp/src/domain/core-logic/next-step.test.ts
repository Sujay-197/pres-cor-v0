import { describe, expect, it } from 'vitest';
import type { DeliveryReport, NextStepContext } from '../contracts/index.js';
import { decideNextStep } from './next-step.js';

const report = (over: Partial<DeliveryReport> = {}): DeliveryReport => ({
  reportId: 'rpt-test', contractVersion: '1.0.0', segments: [], issues: [],
  fillerCount: 0, avgPaceWpm: 130, durationSec: 45, audioUrl: null,
  status: 'ready', nextStep: null, ...over,
});

const ctx = (over: Partial<NextStepContext> = {}): NextStepContext => ({
  upcomingEvents: [], knownMentor: null, now: '2026-07-25T09:00:00Z', ...over,
});

describe('decideNextStep', () => {
  it('returns none while the report is still analysing', () => {
    expect(decideNextStep(report({ status: 'analyzing' }), ctx()).kind).toBe('none');
  });

  it('surfaces a calendar reminder for an event inside 7 days', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [{ title: 'Northwind investor call', startsAt: '2026-07-27T14:00:00Z' }],
    }));
    expect(step.kind).toBe('calendar_reminder');
    expect(step.eventTitle).toBe('Northwind investor call');
    expect(step.eventStartsAt).toBe('2026-07-27T14:00:00Z');
  });

  it('ignores an event beyond 7 days and drafts a note instead', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [{ title: 'Far off', startsAt: '2026-09-01T14:00:00Z' }],
    }));
    expect(step.kind).toBe('draft_note');
  });

  it('picks the soonest event when several qualify', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [
        { title: 'Later', startsAt: '2026-07-30T10:00:00Z' },
        { title: 'Sooner', startsAt: '2026-07-26T10:00:00Z' },
      ],
    }));
    expect(step.eventTitle).toBe('Sooner');
  });

  it('ignores events already in the past', () => {
    const step = decideNextStep(report(), ctx({
      upcomingEvents: [{ title: 'Yesterday', startsAt: '2026-07-24T10:00:00Z' }],
    }));
    expect(step.kind).toBe('draft_note');
  });

  it('addresses a known mentor by name', () => {
    const step = decideNextStep(report(), ctx({ knownMentor: 'Priya' }));
    expect(step.recipientHint).toContain('Priya');
    expect(step.draftBody).toContain('Priya');
  });

  it('falls back to a generic recipient when no mentor is known', () => {
    const step = decideNextStep(report(), ctx());
    expect(step.kind).toBe('draft_note');
    expect(step.recipientHint).toBeTruthy();
  });

  it('drafts a note even for a clean take — always points at a person', () => {
    // SPEC §2: the last action always points toward real human practice.
    expect(decideNextStep(report({ issues: [] }), ctx()).kind).toBe('draft_note');
  });

  it('never executes', () => {
    for (const c of [ctx(), ctx({ upcomingEvents: [{ title: 'X', startsAt: '2026-07-26T10:00:00Z' }] })]) {
      expect(decideNextStep(report(), c).executed).toBe(false);
    }
  });

  it('never reads the clock — now is injected', () => {
    const past = decideNextStep(report(), ctx({
      now: '2026-07-20T09:00:00Z',
      upcomingEvents: [{ title: 'Soon', startsAt: '2026-07-21T10:00:00Z' }],
    }));
    expect(past.kind).toBe('calendar_reminder');
  });
});
