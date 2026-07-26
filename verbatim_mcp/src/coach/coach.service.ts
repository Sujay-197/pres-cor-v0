import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { Injectable } from '@nitrostack/core';
import { z } from 'zod';
import {
  DeliveryReport, DeliverySignal, NextStep, ScriptSegment, CorrelationResult,
} from '../domain/contracts/index.js';
import {
  CoachError, alignSegments, correlateSegments, decideNextStep, generateSummary, parseScript,
} from '../domain/core-logic/index.js';
import { AppConfigService } from '../config/app-config.service.js';
import { createSttClient } from '../adapters/stt-client.js';
import { prosodyForFile } from '../adapters/audio-decode.js';
import { resolveTakeAudio, uploadTakeId, uploadFilenameFor } from '../adapters/takes.js';
import {
  FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector,
  type ContextProvider, type CalendarConnector, type GmailConnector,
} from '../adapters/connectors.js';
import type { Logger } from '../common/logger.js';

/** Output-side contract-drift guard. Maps to INTERNAL, never BAD_INPUT. */
export function assertToolOutput<T extends z.ZodTypeAny>(schema: T, output: unknown, toolName: string): void {
  const result = schema.safeParse(output);
  if (result.success) return;
  const summary = result.error.issues.map((i) => `"${i.path.join('.') || '(root)'}" (${i.code})`).join(', ');
  throw new CoachError('INTERNAL', `${toolName}: output failed contract validation at ${summary}.`, {
    issues: result.error.issues,
  });
}

export function reportIdFor(takeId: string): string { return `rpt-demo-${takeId}`; }
export function audioUrlFor(takeId: string): string { return `/api/audio/${takeId}`; }

export interface AnalyzeInput { takeId: string; script?: string; now: string; }
export interface SuggestNextStepArgs {
  report: DeliveryReport; takeId: string; now: string; execute: boolean;
}

@Injectable({ deps: [AppConfigService, FixtureContextProvider, FixtureCalendarConnector, FixtureGmailConnector] })
export class CoachService {
  constructor(
    private readonly config: AppConfigService,
    private readonly context: ContextProvider,
    private readonly calendar: CalendarConnector,
    private readonly gmail: GmailConnector,
  ) {}

  parseScriptText(raw: string): ScriptSegment[] {
    return parseScript(raw);
  }

  async transcribe(takeId: string, log?: Logger): Promise<DeliverySignal> {
    const cfg = this.config.cfg;
    const client = createSttClient(cfg, takeId, this.config.fixtureDir);
    const needsBytes = cfg.sttProvider !== 'fixture' || cfg.enableProsody;
    const audio = needsBytes ? resolveTakeAudio(this.config.audioDir, this.config.uploadDir, takeId) : null;
    if (cfg.sttProvider !== 'fixture' && audio === null) {
      throw new CoachError('AUDIO_UNREADABLE', `No audio file on disk for take "${takeId}".`, { takeId });
    }
    const bytes = audio === null ? new Uint8Array(0) : new Uint8Array(await readFile(audio.path));
    const transcript = await client.transcribe(bytes, audio?.mimeType ?? 'application/octet-stream');
    if (transcript.durationSec > cfg.audioMaxSeconds) {
      throw new CoachError('AUDIO_UNREADABLE',
        `Recording is ${transcript.durationSec}s; the limit is ${cfg.audioMaxSeconds}s.`, { takeId });
    }
    const prosody = await prosodyForFile({ filePath: audio?.path ?? null, enabled: cfg.enableProsody, log });
    const result: DeliverySignal = { transcript, prosody };
    assertToolOutput(DeliverySignal, result, 'transcribe');
    return result;
  }

  correlate(signal: DeliverySignal, segments: ScriptSegment[]): CorrelationResult {
    const alignment = alignSegments(signal.transcript, segments, signal.prosody);
    const result = correlateSegments(signal, segments, alignment);
    assertToolOutput(CorrelationResult, result, 'correlate');
    return result;
  }

  summarize(
    segments: ScriptSegment[], correlation: CorrelationResult, signal: DeliverySignal,
    meta: { reportId: string; audioUrl: string | null },
  ): DeliveryReport {
    const result = generateSummary(segments, correlation, signal, meta);
    assertToolOutput(DeliveryReport, result, 'summarize');
    return result;
  }

  /**
   * The one place a connector can fire. execute:false → decideNextStep only.
   * execute:true → fire the CONFIGURED connector and flip executed:true.
   */
  async suggestNextStep(args: SuggestNextStepArgs, log?: Logger): Promise<NextStep> {
    const ctx = await this.context.nextStepContext(args.takeId, args.now);
    const decided = decideNextStep(args.report, ctx);
    if (!args.execute || decided.kind === 'none') return decided;

    if (decided.kind === 'calendar_reminder') {
      const { id } = await this.calendar.createReminder(decided.eventTitle ?? '', decided.eventStartsAt ?? '');
      log?.('info', 'next_step.executed', { takeId: args.takeId, kind: decided.kind, externalId: id });
    } else {
      const { id } = await this.gmail.draft(decided.draftSubject ?? '', decided.draftBody ?? '', decided.recipientHint);
      log?.('info', 'next_step.executed', { takeId: args.takeId, kind: decided.kind, externalId: id });
    }
    const result: NextStep = { ...decided, executed: true };
    assertToolOutput(NextStep, result, 'suggestNextStep');
    return result;
  }

  private defaultScript(): string {
    return readFileSyncUtf8(this.config.fixtureDir, 'script.demo.md');
  }

  /**
   * Composed pipeline. NEVER passes execute:true — analyze proposes, it never
   * acts. The widget's confirm button reaches execution through the discrete
   * suggest_next_step tool with execute:true.
   */
  async analyze(input: AnalyzeInput, log?: Logger): Promise<DeliveryReport> {
    const segments = this.parseScriptText(input.script ?? this.defaultScript());
    const signal = await this.transcribe(input.takeId, log);
    const correlation = this.correlate(signal, segments);
    const report = this.summarize(segments, correlation, signal, {
      reportId: reportIdFor(input.takeId), audioUrl: audioUrlFor(input.takeId),
    });
    report.nextStep = await this.suggestNextStep(
      { report, takeId: input.takeId, now: input.now, execute: false }, log,
    );
    return report;
  }

  async resolveUploadIfPresent(input: { takeId: string; file_name?: string; file_type?: string; file_content?: string }): Promise<string> {
    if (!input.file_content || !input.file_name) return input.takeId;
    const bytes = decodeBase64File(input.file_content);
    if (bytes.byteLength > this.config.cfg.uploadMaxBytes) {
      throw new CoachError('AUDIO_UNREADABLE', 'Uploaded file exceeds the size limit.', {});
    }
    const id = uploadTakeId(bytes);
    const filename = uploadFilenameFor(id, basename(input.file_name));
    if (filename === null) throw new CoachError('AUDIO_UNREADABLE', 'Unsupported audio file type.', {});
    await mkdir(this.config.uploadDir, { recursive: true });
    const dest = join(this.config.uploadDir, filename);
    if (!resolve(dest).startsWith(resolve(this.config.uploadDir) + sep)) {
      throw new CoachError('AUDIO_UNREADABLE', 'Invalid upload path.', {});
    }
    await writeFile(dest, bytes);
    return id;
  }
}

// Local helper to keep the single fs import obvious.
import { readFileSync } from 'node:fs';
import { join, basename, resolve, sep } from 'node:path';
function readFileSyncUtf8(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8');
}

function decodeBase64File(content: string): Uint8Array {
  const m = content.match(/^data:([A-Za-z0-9-+/.]+);base64,(.+)$/);
  return m ? new Uint8Array(Buffer.from(m[2]!, 'base64')) : new Uint8Array(Buffer.from(content, 'base64'));
}
