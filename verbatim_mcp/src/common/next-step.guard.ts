import { Guard, ExecutionContext, Injectable } from '@nitrostack/core';

/**
 * PRE-DEPLOY SEAM. suggest_next_step is the one tool that fires a real-world
 * connector action, so per ARCHITECTURE_BRIEF §3 it must be authed on a live
 * deploy. Locally there is no auth surface, so this guard ALLOWS everything
 * while JWT_SECRET is unset. When JWT_SECRET is present it enforces a bearer
 * token.
 *
 * TODO (deploy): import JWTModule + jsonwebtoken and verify the token
 * signature against JWT_SECRET here, populating context.auth. Until then this
 * enforces presence/shape only. See auth-security SKILL.md JWTGuard for the
 * full verification body.
 */
@Injectable()
export class NextStepGuard implements Guard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = process.env.JWT_SECRET;
    if (!secret) return true; // documented local seam

    const auth = context.metadata?.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false;
    const token = auth.slice('Bearer '.length).trim();
    // Structural check only until real JWT verification is wired at deploy.
    const looksLikeJwt = token.split('.').length === 3 && token.length > 20;
    return looksLikeJwt;
  }
}
