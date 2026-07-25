// apps/server/src/tools/tools.module.ts
//
// NestJS-style module wiring. NitroStudio's CLI generator will likely
// produce something shaped close to this, or a NitroStack-specific
// equivalent — reconcile against whatever it scaffolds rather than
// fighting it; this file is the "what it should end up doing" reference.

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ParseScriptTool } from './parse-script.tool';
import { TranscribeDeliveryTool } from './transcribe-delivery.tool';
import { CorrelateSegmentsTool } from './correlate-segments.tool';
import { GenerateSummaryTool } from './generate-summary.tool';
import { SuggestNextStepTool } from './suggest-next-step.tool';
import { AuditLoggingInterceptor } from '../interceptors/audit-logging.interceptor';
import { FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors';
// Swap the two fixture providers below for ComposedCalendarConnector /
// ComposedGmailConnector once the real MCP composition is wired (h8-16).
// Nothing else changes — SuggestNextStepTool codes against the
// CalendarConnector/GmailConnector interfaces, not these concrete classes.

@Module({
  providers: [
    ParseScriptTool,
    TranscribeDeliveryTool,
    CorrelateSegmentsTool,
    GenerateSummaryTool,
    SuggestNextStepTool,
    // Bound by class token since SuggestNextStepTool's constructor asks
    // for the interfaces directly — swap useClass here at h8-16, no
    // other file changes.
    { provide: 'CalendarConnector', useClass: FixtureCalendarConnector },
    { provide: 'GmailConnector', useClass: FixtureGmailConnector },
    {
      // Applies audit logging to every tool in this module, not just
      // suggest_next_step — differentiation checklist wants a complete
      // trace, per ARCHITECTURE_BRIEF §3.
      provide: APP_INTERCEPTOR,
      useClass: AuditLoggingInterceptor,
    },
  ],
  exports: [
    ParseScriptTool,
    TranscribeDeliveryTool,
    CorrelateSegmentsTool,
    GenerateSummaryTool,
    SuggestNextStepTool,
  ],
})
export class ToolsModule {}
