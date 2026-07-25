// apps/server/src/guards/auth.guard.ts
//
// ARCHITECTURE_BRIEF §3: "Auth guard (OAuth 2.1 / JWT) on any tool that
// triggers a real-world action." In this build that's ONE tool —
// suggest_next_step, because it's the only one that can touch Calendar or
// Gmail. The other four tools are pure/read-only and don't need it —
// don't over-apply this guard globally, that's scope creep against the
// 24h clock.

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class ConnectorAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = this.resolveRequest(context);

    // TODO(P2): swap for real OAuth 2.1 / JWT verification once the
    // Calendar/Gmail connector composition is wired (h8-16 per TEAM_PLANS).
    // For the h4-6 merge point, a presence check on a bearer token is
    // enough to prove the guard fires — don't gold-plate this before the
    // connector work exists to protect.
    const token = req?.headers?.authorization;
    if (!token || !token.startsWith('Bearer ')) {
      throw new UnauthorizedException('suggest_next_step requires an authenticated caller');
    }

    return true;
  }

  private resolveRequest(context: ExecutionContext): any {
    // TODO(P2): confirm how NitroStack's MCP transport exposes the
    // underlying request/session to a guard — this may not be a plain
    // HTTP request object depending on transport (stdio vs SSE vs HTTP).
    return context.switchToHttp?.().getRequest?.() ?? {};
  }
}
