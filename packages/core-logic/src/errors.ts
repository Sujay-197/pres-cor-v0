/**
 * Typed errors. Core logic never throws a raw Error across the tool boundary —
 * P2's @Tool wrappers map `code` onto an MCP error. See CONVENTIONS.md §6.
 */

export type CoachErrorCode =
  | 'SCRIPT_EMPTY'
  | 'SCRIPT_NO_SEGMENTS'
  | 'AUDIO_UNREADABLE'
  | 'AUDIO_TOO_SHORT'
  | 'STT_FAILED'
  | 'ALIGNMENT_FAILED';

export class CoachError extends Error {
  constructor(
    readonly code: CoachErrorCode,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CoachError';
  }
}
