// apps/server/src/adapters/connectors.ts
//
// ARCHITECTURE_BRIEF §3, "Compose" bucket: these wrap EXISTING MCP
// Calendar/Gmail servers rather than rebuilding calendar/email logic
// ourselves. That's the actual "connector proof" judges are checking for
// on the differentiation checklist — composing, not reinventing.
//
// HARD RULE (TEAM_PLANS h8-16, repeated because it's the one that will
// sink the demo if broken): NEVER auto-send. Both methods below only
// create a DRAFT. The user must confirm before anything goes out for
// real — that confirmation step lives in suggest-next-step.tool.ts, not
// here, but it's worth restating: nothing in this file should ever fire
// without an explicit `confirmed: true` upstream.

export interface CalendarReminderInput {
  title: string;
  notes: string;
  remindBeforeEventId: string; // the upcoming event we're timing this against
}

export interface DraftNoteInput {
  to: string;          // mentor/friend's email — supplied by the user, not guessed
  subject: string;
  body: string;
}

export interface ConnectorResult {
  kind: 'calendar_reminder' | 'draft_note';
  externalId: string;   // event ID or draft ID, for the receipt shown in the widget
  link?: string;         // deep link back to the calendar event / gmail draft, if available
}

export interface CalendarConnector {
  createReminder(input: CalendarReminderInput): Promise<ConnectorResult>;
}

export interface GmailConnector {
  createDraft(input: DraftNoteInput): Promise<ConnectorResult>;
}

// ---- Real implementations ----
//
// TODO(P2, h8-16): these bodies call whatever MCP client NitroStack gives
// us for composed connectors — likely something like
// `this.mcpClient.callTool('calendar.createEvent', {...})` once the
// Calendar/Gmail servers are actually composed into the project via
// NitroStudio. The exact call shape depends on how composition works in
// NitroStack, which is worth confirming with a teammate or the docs
// before hand-typing this blind (same caution as the @Tool decorator
// syntax elsewhere in this repo).
//
// Keeping these as thin classes now means whoever wires the real MCP
// client just fills in the body — the interface above is already the
// contract suggest-next-step.tool.ts codes against.

export class ComposedCalendarConnector implements CalendarConnector {
  async createReminder(input: CalendarReminderInput): Promise<ConnectorResult> {
    // TODO: call composed Calendar MCP server's create-event tool.
    // This creates the reminder itself, NOT the meeting it's about — the
    // meeting/interview already exists in upcomingEvents; we're adding a
    // "review your delivery report" reminder ahead of it.
    void input;
    throw new Error('Calendar connector not yet composed — see TODO above');
  }
}

export class ComposedGmailConnector implements GmailConnector {
  async createDraft(input: DraftNoteInput): Promise<ConnectorResult> {
    // TODO: call composed Gmail MCP server's create-draft tool.
    // NOTE: "draft", not "send" — even at the connector level. This method
    // name is createDraft on purpose, there is no sendEmail method in this
    // file at all, so it's structurally impossible to auto-send from here.
    void input;
    throw new Error('Gmail connector not yet composed — see TODO above');
  }
}

// ---- Fixture implementations: for local testing / offline demo ----
//
// Same reasoning as FixtureSttClient — build the escape hatch now, not at
// hour 22. Lets you test the full suggest_next_step flow (and demo it
// offline) without real Calendar/Gmail access.

export class FixtureCalendarConnector implements CalendarConnector {
  async createReminder(input: CalendarReminderInput): Promise<ConnectorResult> {
    console.log('[fixture calendar] would create reminder:', input.title);
    return {
      kind: 'calendar_reminder',
      externalId: `fixture-event-${Date.now()}`,
    };
  }
}

export class FixtureGmailConnector implements GmailConnector {
  async createDraft(input: DraftNoteInput): Promise<ConnectorResult> {
    console.log('[fixture gmail] would draft note to:', input.to, '-', input.subject);
    return {
      kind: 'draft_note',
      externalId: `fixture-draft-${Date.now()}`,
    };
  }
}
