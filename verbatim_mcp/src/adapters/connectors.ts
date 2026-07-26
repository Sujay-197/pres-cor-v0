import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nitrostack/core';
import { NextStepContext } from '../domain/contracts/index.js';
import { CoachError } from '../domain/core-logic/index.js';
import { AppConfigService } from '../config/app-config.service.js';

export interface ContextProvider {
  nextStepContext(takeId: string, now: string): Promise<NextStepContext>;
}
export interface CalendarConnector {
  createReminder(title: string, startsAt: string): Promise<{ id: string }>;
}
export interface GmailConnector {
  draft(subject: string, body: string, to: string | null): Promise<{ id: string }>;
}

export const NEUTRAL_CONTEXT: Omit<NextStepContext, 'now'> = { upcomingEvents: [], knownMentor: null };
const CONTEXT_FIXTURE = 'next-step-context.json';

@Injectable({ deps: [AppConfigService] })
export class FixtureContextProvider implements ContextProvider {
  constructor(private readonly config: AppConfigService) {}

  async nextStepContext(takeId: string, now: string): Promise<NextStepContext> {
    const path = join(this.config.fixtureDir, CONTEXT_FIXTURE);
    let all: Record<string, unknown>;
    try {
      all = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    } catch (cause) {
      throw new CoachError('INTERNAL', `Failed to read or parse "${CONTEXT_FIXTURE}".`, {
        path, cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (!Object.hasOwn(all, takeId)) return { ...NEUTRAL_CONTEXT, now };
    const entry = all[takeId];
    if (entry === undefined) return { ...NEUTRAL_CONTEXT, now };
    const parsed = NextStepContext.safeParse({ ...(entry as object), now });
    if (!parsed.success) {
      throw new CoachError('INTERNAL', `next-step-context.json entry "${takeId}" does not match the contract.`, {
        takeId, issues: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    return parsed.data;
  }
}

const syntheticId = (prefix: string, parts: Array<string | null>): string =>
  `${prefix}${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 12)}`;

@Injectable()
export class FixtureCalendarConnector implements CalendarConnector {
  async createReminder(title: string, startsAt: string): Promise<{ id: string }> {
    return { id: syntheticId('fixture-event-', [title, startsAt]) };
  }
}

@Injectable()
export class FixtureGmailConnector implements GmailConnector {
  async draft(subject: string, body: string, to: string | null): Promise<{ id: string }> {
    return { id: syntheticId('fixture-draft-', [subject, body, to]) };
  }
}
