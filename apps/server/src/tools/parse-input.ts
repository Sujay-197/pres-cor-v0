// apps/server/src/tools/parse-input.ts
//
// Every tool boundary must validate its input without letting a raw ZodError
// escape — ZodError extends Error, and mapError (../errors.ts) turns any
// non-CoachError into a generic 500. A malformed client request should be a
// 400, so tools call this instead of `schema.parse(input)` directly.

import type { z } from 'zod';
import { CoachError } from '@nsh/core-logic';

/**
 * Validates `input` against `schema`. On success, returns the parsed value
 * (with defaults/coercions applied). On failure, throws a CoachError with
 * code BAD_INPUT rather than letting Zod's raw ZodError cross the tool
 * boundary.
 *
 * The thrown message is safe to log AND safe to return to a client: it names
 * the tool and the failing field paths plus each issue's Zod code, but never
 * the offending value (request bodies can carry user content or secrets, and
 * this message reaches both the log and the HTTP response body). The full
 * issue list is attached to `context`, which mapError logs but never returns
 * to the client.
 */
export function parseToolInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  toolName: string,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues;
  const summary = issues
    .map((issue) => `"${issue.path.join('.') || '(root)'}" (${issue.code})`)
    .join(', ');

  throw new CoachError(
    'BAD_INPUT',
    `${toolName}: invalid input at ${summary}.`,
    { issues },
  );
}
