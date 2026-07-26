import {
  ControllerDecorator as Controller, ToolDecorator as Tool, Widget, UseGuards, UseFilters,
  UseInterceptors, ExecutionContext, Injectable,
} from '@nitrostack/core';
import { z } from 'zod';
import {
  DeliveryReport, DeliverySignal, ScriptSegment, CorrelationResult, NextStep,
} from '../domain/contracts/index.js';
import { CoachService } from './coach.service.js';
import { NextStepGuard } from '../common/next-step.guard.js';
import { CoachExceptionFilter } from '../common/coach-exception.filter.js';
import { AuditInterceptor } from '../common/audit.interceptor.js';
import type { Logger, LogLevel } from '../common/logger.js';

const AnalyzeSchema = z.object({
  takeId: z.string().min(1).describe('Staged take id (e.g. "rough", "clean") or an upload id.'),
  script: z.string().optional().describe('Raw script markdown. Defaults to the demo script.'),
  now: z.string().min(1).describe('ISO 8601 clock, injected for deterministic next-step timing.'),
});
const ParseScriptSchema = z.object({ raw: z.string().describe('Raw script markdown.') });
const TranscribeSchema = z.object({
  takeId: z.string().min(1),
  file_name: z.string().optional().describe('Uploaded recording filename.'),
  file_type: z.string().optional().describe('Uploaded recording MIME type.'),
  file_content: z.string().optional().describe('Base64 (raw or data-URL) recording bytes.'),
});
const CorrelateSchema = z.object({ signal: DeliverySignal, segments: z.array(ScriptSegment) });
const SummarizeSchema = z.object({
  segments: z.array(ScriptSegment), correlation: CorrelationResult, signal: DeliverySignal,
  meta: z.object({ reportId: z.string().min(1), audioUrl: z.string().nullable() }),
});
const SuggestSchema = z.object({
  report: DeliveryReport, takeId: z.string().min(1), now: z.string().min(1),
  execute: z.boolean().default(false),
});

/** Bridge ctx.logger (info/warn/error methods) to the adapters' Logger callback. */
function toLogger(ctx: ExecutionContext): Logger {
  return (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const fn = (ctx.logger as unknown as Record<string, ((m: string, meta?: unknown) => void) | undefined>)[level];
    fn?.(message, meta);
  };
}

@Controller()
@Injectable({ deps: [CoachService] })
export class CoachTools {
  constructor(private readonly coach: CoachService) {}

  @Tool({
    name: 'parse_script',
    description: 'Parse script markdown into structured segments with key-point and pause markers.',
    inputSchema: ParseScriptSchema,
    outputSchema: z.array(ScriptSegment),
  })
  @UseFilters(CoachExceptionFilter)
  @UseInterceptors(AuditInterceptor)
  async parseScript(input: z.infer<typeof ParseScriptSchema>, _ctx: ExecutionContext): Promise<ScriptSegment[]> {
    return this.coach.parseScriptText(input.raw);
  }

  @Tool({
    name: 'transcribe_delivery',
    description: 'Transcribe a recording (staged take or uploaded audio) into a timestamped transcript + prosody.',
    inputSchema: TranscribeSchema,
    outputSchema: DeliverySignal,
  })
  @UseFilters(CoachExceptionFilter)
  @UseInterceptors(AuditInterceptor)
  async transcribeDelivery(input: z.infer<typeof TranscribeSchema>, ctx: ExecutionContext): Promise<DeliverySignal> {
    const takeId = await this.coach.resolveUploadIfPresent(input);
    return this.coach.transcribe(takeId, toLogger(ctx));
  }

  @Tool({
    name: 'correlate_segments',
    description: 'THE BRANCH TOOL. Align delivery to script and decide severity per deviation.',
    inputSchema: CorrelateSchema,
    outputSchema: CorrelationResult,
  })
  @UseFilters(CoachExceptionFilter)
  @UseInterceptors(AuditInterceptor)
  async correlateSegments(input: z.infer<typeof CorrelateSchema>, _ctx: ExecutionContext): Promise<CorrelationResult> {
    return this.coach.correlate(input.signal, input.segments);
  }

  @Tool({
    name: 'generate_summary',
    description: 'Assemble the timestamped DeliveryReport from correlation output.',
    inputSchema: SummarizeSchema,
    outputSchema: DeliveryReport,
  })
  @UseFilters(CoachExceptionFilter)
  @UseInterceptors(AuditInterceptor)
  async generateSummary(input: z.infer<typeof SummarizeSchema>, _ctx: ExecutionContext): Promise<DeliveryReport> {
    return this.coach.summarize(input.segments, input.correlation, input.signal, input.meta);
  }

  @Tool({
    name: 'suggest_next_step',
    description: 'Closing agentic action: calendar reminder or a drafted note to a mentor. Fires the connector only when execute=true.',
    inputSchema: SuggestSchema,
    outputSchema: NextStep,
  })
  @UseGuards(NextStepGuard)
  @UseFilters(CoachExceptionFilter)
  @UseInterceptors(AuditInterceptor)
  async suggestNextStep(input: z.infer<typeof SuggestSchema>, ctx: ExecutionContext): Promise<NextStep> {
    return this.coach.suggestNextStep(input, toLogger(ctx));
  }

  @Tool({
    name: 'analyze_delivery',
    description: 'Run the full pipeline (parse → transcribe → correlate → summarize → propose next step) and render the timeline widget. Proposes the next step; never fires a connector.',
    inputSchema: AnalyzeSchema,
    outputSchema: DeliveryReport,
  })
  @Widget('delivery-timeline')
  @UseFilters(CoachExceptionFilter)
  @UseInterceptors(AuditInterceptor)
  async analyzeDelivery(input: z.infer<typeof AnalyzeSchema>, ctx: ExecutionContext): Promise<DeliveryReport> {
    return this.coach.analyze(input, toLogger(ctx));
  }
}
