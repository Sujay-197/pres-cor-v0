// apps/server/src/tools/parse-script.tool.ts
//
// Pure-logic tool. At merge (h4-6) this body becomes ~one call to P1's
// parseScript(raw) from packages/core-logic. Nothing else belongs here —
// CONVENTIONS §1: "if you catch yourself writing an `if` inside a @Tool
// body, it belongs in core-logic."

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ScriptSegmentSchema } from '../contracts-stub';
// import { parseScript } from '@nsh/core-logic'; // uncomment at merge

const InputSchema = z.object({
  raw: z.string().min(1, 'script cannot be empty'),
});
const OutputSchema = z.array(ScriptSegmentSchema);

@Injectable()
export class ParseScriptTool {
  // @Tool({
  //   name: 'parse_script',
  //   description:
  //     'Turn raw script/notes text into structured segments with emphasis ' +
  //     'markers (key points, planned pauses). Pure logic, no LLM call.',
  //   inputSchema: InputSchema,
  //   outputSchema: OutputSchema,
  // })
  async execute(input: z.infer<typeof InputSchema>): Promise<z.infer<typeof OutputSchema>> {
    void input;
    // MERGE POINT (h4-6): replace with —
    //   return parseScript(input.raw);
    // parseScript throws CoachError('SCRIPT_EMPTY' | 'SCRIPT_NO_SEGMENTS')
    // on bad input — CONVENTIONS §6 says that error must be mapped to an
    // MCP error here, not passed through raw. Add that mapping when the
    // real call lands, e.g.:
    //   catch (e) { if (e instanceof CoachError) throw toMcpError(e); throw e; }
    throw new Error('pending merge');
  }
}
