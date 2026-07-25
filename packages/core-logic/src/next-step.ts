import type { DeliveryReport, NextStep, NextStepContext } from '@nsh/contracts';

const WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * The closing agentic action — decides, never executes. P2 executes after the
 * user confirms, and only then flips `executed` to true.
 *
 * There is deliberately no "everything is fine, do nothing" exit. SPEC §2 says
 * the last action always points toward real human practice, so a clean take
 * still ends by proposing a person to rehearse with.
 */
export function decideNextStep(report: DeliveryReport, ctx: NextStepContext): NextStep {
  const base = {
    executed: false,
    eventTitle: null, eventStartsAt: null,
    recipientHint: null, draftSubject: null, draftBody: null,
  };

  if (report.status !== 'ready') {
    return { ...base, kind: 'none', rationale: 'Analysis is still running.' };
  }

  const now = Date.parse(ctx.now);
  const soonest = ctx.upcomingEvents
    .map((e) => ({ ...e, at: Date.parse(e.startsAt) }))
    .filter((e) => Number.isFinite(e.at) && e.at >= now && e.at - now <= WINDOW_DAYS * MS_PER_DAY)
    .sort((a, b) => a.at - b.at)[0];

  const unresolved = report.issues.filter((i) => i.severity === 'high').length;

  if (soonest) {
    const days = Math.max(Math.round((soonest.at - now) / MS_PER_DAY), 0);
    return {
      ...base,
      kind: 'calendar_reminder',
      eventTitle: soonest.title,
      eventStartsAt: soonest.startsAt,
      rationale:
        `"${soonest.title}" is on your calendar in ${days} day${days === 1 ? '' : 's'}. ` +
        (unresolved > 0
          ? `${unresolved} high-severity issue${unresolved === 1 ? ' is' : 's are'} unresolved, so this report is worth re-reading close to the event.`
          : 'Worth re-reading close to the event.'),
    };
  }

  const mentor = ctx.knownMentor;
  return {
    ...base,
    kind: 'draft_note',
    recipientHint: mentor ? `${mentor} (watched your last rehearsal)` : 'someone who has heard this pitch before',
    draftSubject: 'Could you watch this once?',
    draftBody:
      `Hi ${mentor ?? 'there'} — I've rehearsed this to the point where solo runs aren't teaching me much. ` +
      'Do you have 10 minutes this week to listen live and tell me where you stopped believing me?',
    rationale:
      `Nothing on your calendar in the next ${WINDOW_DAYS} days. ` +
      (unresolved > 0
        ? 'The remaining issues are delivery habits, and those change faster in front of a person than on a replay.'
        : 'This take is already clean — the remaining gains come from a live audience, not another solo run.'),
  };
}
