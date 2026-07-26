import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  DeliveryReport,
  NextStep,
  isAllowedAudioUrl,
  FILLER_LEXICON,
} from './index.js';

describe('contract', () => {
  it('pins the contract version', () => {
    expect(CONTRACT_VERSION).toBe('1.0.0');
  });

  it('rejects a report missing required fields', () => {
    // Would pass (wrongly) if DeliveryReport were too loose.
    const bad = DeliveryReport.safeParse({ reportId: 'x' });
    expect(bad.success).toBe(false);
  });

  it('accepts a minimal well-formed report', () => {
    const ok = DeliveryReport.safeParse({
      reportId: 'rpt-1', contractVersion: '1.0.0', segments: [], issues: [],
      fillerCount: 0, avgPaceWpm: 0, durationSec: 0, audioUrl: null,
      status: 'ready', nextStep: null,
    });
    expect(ok.success).toBe(true);
  });

  it('defaults NextStep nullable fields to null', () => {
    const parsed = NextStep.parse({ kind: 'none', rationale: 'x', executed: false });
    expect(parsed.eventTitle).toBeNull();
    expect(parsed.draftBody).toBeNull();
  });

  it('rejects a javascript: audio url but allows a root-relative one', () => {
    expect(isAllowedAudioUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedAudioUrl('/api/audio/rough')).toBe(true);
  });

  it('treats multi-word hedges as fillers in the lexicon', () => {
    expect(FILLER_LEXICON).toContain('you know');
  });
});
