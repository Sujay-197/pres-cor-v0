// apps/server/src/errors.ts
//
// Design §10. CoachError.code maps to an HTTP status at the tool boundary; a
// raw Error never crosses it. The `context` field is logged, never returned —
// it can carry input fragments.

import { CoachError, type CoachErrorCode } from '@nsh/core-logic';

export const ERROR_STATUS: Record<CoachErrorCode, number> = {
  SCRIPT_EMPTY: 400,
  SCRIPT_NO_SEGMENTS: 400,
  AUDIO_UNREADABLE: 415,
  AUDIO_TOO_SHORT: 422,
  STT_FAILED: 502,
  ALIGNMENT_FAILED: 422,
  INTERNAL: 500,
};

export const GENERIC_MESSAGE = 'Internal server error.';

export interface ErrorBody {
  error: { code: string; message: string };
}

export interface MappedError {
  status: number;
  body: ErrorBody;
  /** Full detail for the server-side log. Never sent to the client. */
  logMessage: string;
  logContext: Record<string, unknown>;
}

export function isCoachError(err: unknown): err is CoachError {
  return err instanceof CoachError;
}

export function mapError(err: unknown): MappedError {
  if (isCoachError(err)) {
    return {
      status: ERROR_STATUS[err.code],
      body: { error: { code: err.code, message: err.message } },
      logMessage: err.message,
      logContext: err.context,
    };
  }

  const detail = err instanceof Error ? err.message : String(err);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL', message: GENERIC_MESSAGE } },
    logMessage: detail,
    logContext: {},
  };
}
