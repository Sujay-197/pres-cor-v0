// apps/server/src/tools/suggest-next-step.tool.ts
//
// The only tool with UseGuards(ConnectorAuthGuard) — it's the sole tool
// that can touch a real Calendar/Gmail account. Also the "closing agentic
// action" SPEC §2 calls out as proof this points back to real human
// practice, not just a tool call.
//
// Split of responsibility, don't blur this:
//   - decideNextStep (P1, core-logic) picks WHICH branch — calendar
//     reminder vs draft-a-note — and always returns { executed: false }.
//   - THIS tool EXECUTES that decision via the composed connector and
//     flips executed to true. Deciding and executing are different jobs.
//
// HARD RULE (TEAM_PLANS h8-16): never auto-send. Draft only, return
// executed: false until the user explicitly confirms in a follow-up call.
// An agent that emails someone unprompted reads as a bug to a judge.

import { Inject, Injectable, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { NextStepSchema, DeliveryReportSchema } from '../contracts-stub';
import { ConnectorAuthGuard } from '../guards/auth.guard';
import type { CalendarConnector, GmailConnector } from '../adapters/connectors';
// import { decideNextStep } from '@nsh/core-logic'; // merge (h4-6, decision only)

const InputSchema = z.object({
  report: DeliveryReportSchema,
  upcomingEvents: z.array(z.unknown()), // NextStepContext.upcomingEvents
  confirmed: z.boolean().default(false), // true only on the user's explicit follow-up
});

const OutputSchema = NextStepSchema;

@Injectable()
export class SuggestNextStepTool {
  constructor(
    @Inject('CalendarConnector') private readonly calendar: CalendarConnector,
    @Inject('GmailConnector') private readonly gmail: GmailConnector,
  ) {}

  @UseGuards(ConnectorAuthGuard)
  // @Tool({
  //   name: 'suggest_next_step',
  //   description:
  //     'Decide whether to surface this report before an upcoming ' +
  //     'calendar event, or draft a note to a mentor/friend asking them ' +
  //     'to watch the next attempt. Never sends without confirmation.',
  //   inputSchema: InputSchema,
  //   outputSchema: OutputSchema,
  // })
  async execute(input: z.infer<typeof InputSchema>): Promise<z.infer<typeof OutputSchema>> {
    // ---- DECIDE half: blocked on P1's decideNextStep (merge h4-6) ----
    // const decision = decideNextStep(input.report, {
    //   now: /* passed in by caller, never Date.now() inside core-logic */,
    //   upcomingEvents: input.upcomingEvents,
    // });
    // decision.executed is always false coming out of core-logic.
    //
    // Until that lands, fake a decision so the EXECUTE half below is
    // fully testable today — swap this block out at merge, nothing else
    // in this method needs to change.
    const decision: z.infer<typeof OutputSchema> = {
      kind: 'draft_note',
      executed: false,
      detail: 'PLACEHOLDER decision — replace with decideNextStep() at merge',
    };

    // ---- EXECUTE half: yours, done now ----
    if (!input.confirmed) {
      return decision; // draft/suggestion only, wait for the user to confirm
    }

    if (decision.kind === 'calendar_reminder') {
      const result = await this.calendar.createReminder({
        title: 'Review your delivery report',
        notes: decision.detail,
        remindBeforeEventId: '', // TODO: pull the matched event ID out of decision once decideNextStep carries it
      });
      return { ...decision, executed: true, detail: `${decision.detail} (event: ${result.externalId})` };
    }

    // draft_note branch — creates a DRAFT the user still has to send
    // themselves. There is no send call anywhere in this file on purpose.
    const result = await this.gmail.createDraft({
      to: '', // TODO: this needs to come from the user, not guessed — surface a prompt for it upstream
      subject: 'Could you watch my next take?',
      body: decision.detail,
    });
    return { ...decision, executed: true, detail: `${decision.detail} (draft: ${result.externalId})` };
  }
}
