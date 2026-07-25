// apps/server/src/main.ts
//
// Boot: validate config, build the dependency record, start the listener.
// bootstrap() is exported so tests can boot the whole server IN-PROCESS on an
// ephemeral port rather than spawning a subprocess.

import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { describeConfig, getConfig, type AppConfig } from './config.js';
import { createApp } from './http.js';
import { createDeps, type ServerDeps } from './pipeline.js';

export interface BootedServer {
  server: Server;
  port: number;
  deps: ServerDeps;
  close: () => Promise<void>;
}

export async function bootstrap(
  cfg: AppConfig,
  overrides: Partial<ServerDeps> = {},
): Promise<BootedServer> {
  const deps = createDeps(cfg, overrides);
  const app = createApp(deps);

  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(cfg.port);
    listener.once('listening', () => resolve(listener));
    listener.once('error', reject);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : cfg.port;
  // describeConfig reports whether the key is set, never its value.
  deps.log('info', 'server.listening', { port, ...describeConfig(cfg) });

  return {
    server,
    port,
    deps,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function main(): Promise<void> {
  await bootstrap(getConfig());
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
