import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './takes.js';

interface Manifest {
  name?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
}

const manifest = (relative: string): Manifest =>
  JSON.parse(readFileSync(join(REPO_ROOT, relative), 'utf8')) as Manifest;

describe('the one-command demo path', () => {
  const root = manifest('package.json');

  it('exposes a root dev script that starts both halves', () => {
    expect(root.scripts?.['dev']).toBeDefined();
    expect(root.scripts?.['dev:server']).toBeDefined();
    expect(root.scripts?.['dev:widget']).toBeDefined();
    expect(root.scripts!['dev']).toContain('dev:server');
    expect(root.scripts!['dev']).toContain('dev:widget');
  });

  it('targets workspaces that actually declare a dev script', () => {
    const server = manifest('apps/server/package.json');
    const widget = manifest('packages/widget/package.json');
    expect(server.name).toBe('@nsh/server');
    expect(widget.name).toBe('@nsh/widget');
    expect(server.scripts?.['dev']).toBeDefined();
    expect(widget.scripts?.['dev']).toBeDefined();
    expect(root.scripts!['dev:server']).toContain(server.name!);
    expect(root.scripts!['dev:widget']).toContain(widget.name!);
  });

  it('declares the runner it depends on', () => {
    expect(root.devDependencies?.['concurrently']).toBeDefined();
  });

  it('keeps apps/* in the workspace glob so @nsh/server resolves', () => {
    expect(root.workspaces).toContain('apps/*');
  });
});

describe('README', () => {
  const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

  it('documents the one command and the offline default', () => {
    expect(readme).toContain('npm run dev');
    expect(readme).toContain('STT_PROVIDER');
    expect(readme).toContain('http://127.0.0.1:5173');
  });
});
