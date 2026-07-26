import { McpApp, Module, ConfigModule } from '@nitrostack/core';

/**
 * Root application module — Delivery-Correction Speech Coach.
 * Feature modules are added in Task 16 (CoachModule) and Task 14 (JWTModule).
 */
@McpApp({
  module: AppModule,
  server: {
    name: 'delivery-coach',
    version: '1.0.0',
  },
  logging: {
    level: 'info',
  },
})
@Module({
  name: 'delivery-coach',
  description: 'Corrects delivery mechanics against your own script',
  imports: [ConfigModule.forRoot()],
})
export class AppModule {}
