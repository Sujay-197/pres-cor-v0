import { ExceptionFilterInterface, ExecutionContext, Injectable } from '@nitrostack/core';
import { CoachError, type CoachErrorCode } from '../domain/core-logic/index.js';

export const ERROR_STATUS: Record<CoachErrorCode, number> = {
  BAD_INPUT: 400, SCRIPT_EMPTY: 400, SCRIPT_NO_SEGMENTS: 400,
  AUDIO_UNREADABLE: 415, AUDIO_TOO_SHORT: 422, STT_FAILED: 502,
  ALIGNMENT_FAILED: 422, INTERNAL: 500,
};
export const GENERIC_MESSAGE = 'Internal server error.';

export interface MappedError {
  status: number;
  body: { error: { code: string; message: string } };
  logMessage: string;
  logContext: Record<string, unknown>;
}

export function mapCoachError(err: unknown): MappedError {
  if (err instanceof CoachError) {
    return {
      status: ERROR_STATUS[err.code],
      body: { error: { code: err.code, message: err.message } },
      logMessage: err.message,
      logContext: err.context,
    };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { code: 'INTERNAL', message: GENERIC_MESSAGE } }, logMessage: detail, logContext: {} };
}

@Injectable()
export class CoachExceptionFilter implements ExceptionFilterInterface {
  catch(exception: unknown, context: ExecutionContext): unknown {
    const mapped = mapCoachError(exception);
    // context is logged, never returned. Framework input-validation errors that
    // are not CoachError land in the generic branch above (client-safe).
    try {
      context?.logger?.error?.('tool.error', { code: mapped.body.error.code, ...mapped.logContext });
    } catch { /* logger optional in some contexts */ }
    return mapped.body;
  }
}
