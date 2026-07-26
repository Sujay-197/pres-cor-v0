import { McpApp, Module, ConfigModule, JWTModule } from '@nitrostack/core';
import { CoachModule } from './coach/coach.module.js';

@McpApp({
  module: AppModule,
  server: { name: 'delivery-coach', version: '1.0.0' },
  logging: { level: 'info' },
})
@Module({
  name: 'delivery-coach',
  description: 'Corrects delivery mechanics against your own script',
  imports: [
    ConfigModule.forRoot(),
    // Registered so the deploy-time NextStepGuard can verify tokens. Locally,
    // with JWT_SECRET unset, the guard allows all calls (documented seam).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    JWTModule.forRoot({ secret: process.env.JWT_SECRET ?? 'dev-insecure-secret', expiresIn: '7d' }) as any,
    CoachModule,
  ],
})
export class AppModule {}
