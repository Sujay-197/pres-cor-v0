import { describe, expect, it, afterEach } from 'vitest';
import { NextStepGuard } from './next-step.guard.js';

const mkCtx = (authorization?: string) => ({ metadata: authorization ? { authorization } : {} }) as never;

describe('NextStepGuard (seam)', () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => { if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original; });

  it('allows all calls when JWT_SECRET is unset (documented pre-deploy seam)', async () => {
    delete process.env.JWT_SECRET;
    expect(await new NextStepGuard().canActivate(mkCtx())).toBe(true);
  });

  it('rejects a call with no bearer token once JWT_SECRET is set', async () => {
    process.env.JWT_SECRET = 'deploy-secret';
    expect(await new NextStepGuard().canActivate(mkCtx())).toBe(false);
  });

  it('rejects a malformed bearer token once JWT_SECRET is set', async () => {
    process.env.JWT_SECRET = 'deploy-secret';
    expect(await new NextStepGuard().canActivate(mkCtx('Bearer not-a-jwt'))).toBe(false);
  });
});
