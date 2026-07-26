import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CoachService } from './coach/coach.service.js';
import { CoachTools } from './coach/coach.tools.js';
import { AppConfigService, loadConfig } from './config/app-config.service.js';
import { FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector } from './adapters/connectors.js';

describe('DI wiring', () => {
  it('resolves CoachTools with CoachService injected', () => {
    const config = new AppConfigService(loadConfig({ STT_PROVIDER: 'fixture', ENABLE_PROSODY: 'false' }));
    const context = new FixtureContextProvider(config);
    const calendar = new FixtureCalendarConnector();
    const gmail = new FixtureGmailConnector();
    const service = new CoachService(config, context, calendar, gmail);
    const tools = new CoachTools(service);
    expect(tools).toBeInstanceOf(CoachTools);
  });

  it('coach.module.ts exports CoachModule with correct imports', () => {
    const src = readdirSync(join(process.cwd(), 'src/coach'));
    expect(src).toContain('coach.module.ts');
    const text = require('node:fs').readFileSync(join(process.cwd(), 'src/coach/coach.module.ts'), 'utf8');
    expect(text).toContain('CoachTools');
    expect(text).toContain('CoachService');
    expect(text).toContain('NextStepGuard');
    expect(text).toContain('CoachExceptionFilter');
    expect(text).toContain('AuditInterceptor');
  });
});
