// apps/server/src/tools/suggest-next-step.tool.ts
//
// The only tool that mutates the outside world, and the only place
// NextStep.executed becomes true. decideNextStep always emits false.
//
// `execute` defaults to FALSE. /api/analyze proposes; the widget's confirm
// button posts execute:true to /api/tools/suggest_next_step. That is what keeps
// the committed goldens (executed: false) reproducible end-to-end and honours
// the contract's "never pre-set executed to true".

import { z } from 'zod';
import { DeliveryReport, NextStep } from '@nsh/contracts';
import { decideNextStep } from '@nsh/core-logic';
import type { ServerDeps } from '../pipeline.js';
import { parseToolInput } from './parse-input.js';

export const SuggestNextStepInput = z.object({
  report: DeliveryReport,
  takeId: z.string().min(1),
  now: z.string().min(1),
  execute: z.boolean().default(false),
});
export type SuggestNextStepInput = z.infer<typeof SuggestNextStepInput>;

export const SuggestNextStepOutput = NextStep;

export async function suggestNextStepTool(
  input: z.input<typeof SuggestNextStepInput>,
  deps: ServerDeps,
): Promise<NextStep> {
  const { report, takeId, now, execute } = parseToolInput(SuggestNextStepInput, input, 'suggestNextStepTool');

  const ctx = await deps.context.nextStepContext(takeId, now);
  const decided = decideNextStep(report, ctx);

  if (!execute || decided.kind === 'none') return decided;

  // The action is performed against the CONFIGURED connector, which is what
  // makes executed:true honest even while the connectors are fixtures.
  if (decided.kind === 'calendar_reminder') {
    const { id } = await deps.calendar.createReminder(decided.eventTitle ?? '', decided.eventStartsAt ?? '');
    deps.log('info', 'next_step.executed', { takeId, kind: decided.kind, externalId: id });
  } else {
    const { id } = await deps.gmail.draft(
      decided.draftSubject ?? '',
      decided.draftBody ?? '',
      decided.recipientHint,
    );
    deps.log('info', 'next_step.executed', { takeId, kind: decided.kind, externalId: id });
  }

  return { ...decided, executed: true };
}
