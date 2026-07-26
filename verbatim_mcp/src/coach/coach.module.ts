import { Module } from '@nitrostack/core';
import { CoachTools } from './coach.tools.js';
import { CoachService } from './coach.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from '../adapters/connectors.js';
import { NextStepGuard } from '../common/next-step.guard.js';
import { CoachExceptionFilter } from '../common/coach-exception.filter.js';
import { AuditInterceptor } from '../common/audit.interceptor.js';

@Module({
  name: 'coach',
  description: 'Delivery-correction speech coach tools and widget',
  controllers: [CoachTools],
  providers: [
    AppConfigService,
    CoachService,
    FixtureContextProvider,
    FixtureCalendarConnector,
    FixtureGmailConnector,
    NextStepGuard,
    CoachExceptionFilter,
    AuditInterceptor,
  ],
})
export class CoachModule {}
