// apps/server/src/adapters/connectors.ts
//
// Three seams, split by what they actually do (design §5.3).
//
// ContextProvider READS ambient facts. knownMentor is not a calendar fact, so
// it does not belong on CalendarConnector — ContextProvider owns assembling the
// whole NextStepContext. Under real MCP composition it fans out to a calendar
// server and a user profile; as a fixture it reads the shared JSON keyed by
// take id.
//
// CalendarConnector and GmailConnector WRITE. Only suggest_next_step calls
// them, and only after decideNextStep has already chosen.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextStepContext } from '@nsh/contracts';
import { CoachError } from '@nsh/core-logic';
import type { Logger } from '../audit.js';

export interface ContextProvider {
  nextStepContext(takeId: string, now: string): Promise<NextStepContext>;
}

export interface CalendarConnector {
  createReminder(title: string, startsAt: string): Promise<{ id: string }>;
}

export interface GmailConnector {
  draft(subject: string, body: string, to: string | null): Promise<{ id: string }>;
}

/** What an unknown take (i.e. any upload) gets: no events, no mentor. */
export const NEUTRAL_CONTEXT: Omit<NextStepContext, 'now'> = {
  upcomingEvents: [],
  knownMentor: null,
};

const CONTEXT_FIXTURE = 'next-step-context.json';

export class FixtureContextProvider implements ContextProvider {
  constructor(private readonly fixtureDir: string) {}

  async nextStepContext(takeId: string, now: string): Promise<NextStepContext> {
    const raw = await readFile(join(this.fixtureDir, CONTEXT_FIXTURE), 'utf8');
    const all = JSON.parse(raw) as Record<string, unknown>;
    const entry = all[takeId];

    // The caller's `now` always wins. The value stored in the fixture is the
    // default build-report.mjs regenerates with; /api/analyze pins its own.
    if (entry === undefined) return { ...NEUTRAL_CONTEXT, now };

    const parsed = NextStepContext.safeParse({ ...(entry as object), now });
    if (!parsed.success) {
      throw new CoachError('INTERNAL', `next-step-context.json entry "${takeId}" does not match the contract.`, {
        takeId,
        issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

/** Deterministic synthetic id — no Date.now(), so a report stays reproducible. */
const syntheticId = (prefix: string, parts: Array<string | null>): string =>
  `${prefix}${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12)}`;

export class FixtureCalendarConnector implements CalendarConnector {
  constructor(private readonly log?: Logger) {}

  async createReminder(title: string, startsAt: string): Promise<{ id: string }> {
    const id = syntheticId('fixture-event-', [title, startsAt]);
    this.log?.('info', 'connector.calendar.createReminder', { id, startsAt });
    return { id };
  }
}

export class FixtureGmailConnector implements GmailConnector {
  constructor(private readonly log?: Logger) {}

  async draft(subject: string, body: string, to: string | null): Promise<{ id: string }> {
    const id = syntheticId('fixture-draft-', [subject, body, to]);
    // Metadata only: the draft body is user content and never reaches the log.
    this.log?.('info', 'connector.gmail.draft', { id, hasRecipientHint: to !== null });
    return { id };
  }
}
