// apps/server/src/tools/parse-script.tool.ts
//
// One function plus its input/output schemas. A plain function, not a class:
// NitroStack's generator supplies its own class and decorator shape, and a
// plain function is the smallest thing that survives that transition.

import { z } from 'zod';
import { ScriptSegment } from '@nsh/contracts';
import { parseScript } from '@nsh/core-logic';

export const ParseScriptInput = z.object({ raw: z.string() });
export type ParseScriptInput = z.infer<typeof ParseScriptInput>;

export const ParseScriptOutput = z.array(ScriptSegment);

export function parseScriptTool(input: ParseScriptInput): ScriptSegment[] {
  return parseScript(ParseScriptInput.parse(input).raw);
}
