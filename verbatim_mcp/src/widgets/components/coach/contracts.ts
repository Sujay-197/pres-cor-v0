export type IssueType = 'filler' | 'pacing' | 'stress_mismatch' | 'pause';
export type Severity = 'low' | 'medium' | 'high';

export interface ScriptSegment {
  id: string;
  text: string;
  isKeyPoint: boolean;
  markedPause: boolean;
  startSec?: number;
  endSec?: number;
}

export interface DeliveryIssue {
  id: string;
  type: IssueType;
  severity: Severity;
  timestamp: number;
  segmentId: string;
  detail: string;
}

export interface NextStep {
  kind: 'calendar_reminder' | 'draft_note' | 'none';
  rationale: string;
  executed: boolean;
  eventTitle: string | null;
  eventStartsAt: string | null;
  recipientHint: string | null;
  draftSubject: string | null;
  draftBody: string | null;
}

export interface DeliveryReport {
  reportId: string;
  contractVersion: string;
  segments: ScriptSegment[];
  issues: DeliveryIssue[];
  fillerCount: number;
  avgPaceWpm: number;
  durationSec: number;
  audioUrl: string | null;
  status: 'analyzing' | 'ready';
  nextStep: NextStep | null;
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  filler: 'Filler word',
  pacing: 'Pacing drift',
  stress_mismatch: 'Stress / emphasis mismatch',
  pause: 'Pause',
};

export const AUDIO_URL_SCHEMES = ['http:', 'https:', 'blob:', 'data:'] as const;

export function isAllowedAudioUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url);
    if (!AUDIO_URL_SCHEMES.includes(u.protocol as (typeof AUDIO_URL_SCHEMES)[number])) return false;
    if (u.protocol === 'data:') {
      const rest = u.pathname.slice(0, 32).toLowerCase();
      return (
        rest.startsWith('audio/') ||
        rest.startsWith('video/') ||
        rest.startsWith('application/octet-stream')
      );
    }
    return true;
  } catch {
    return false;
  }
}
