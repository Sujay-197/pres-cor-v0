import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeliveryTimelineWidget from './widget/DeliveryTimelineWidget';
import type { DeliveryReport, NextStep } from '@nsh/contracts';
import cleanFixture from '../../contracts/fixtures/report.clean.json';
import roughFixture from '../../contracts/fixtures/report.rough.json';

/* ---------------------------------------------------------------------- *
 * Server seam. Everything below is exported so it can be unit-tested with
 * an injected fetch, and so nothing under ./widget/ needs to know a server
 * exists. Vite proxies /api to the server port, so there is no CORS setup.
 * ---------------------------------------------------------------------- */

export interface TakeOption {
  id: string;
  label: string;
  mimeType: string;
  hasFrozenTranscript: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let code = 'INTERNAL';
  let message = `Request failed with HTTP ${res.status}.`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    /* non-JSON error body — keep the defaults */
  }
  throw new ApiError(code, message, res.status);
}

export async function fetchTakes(f: typeof fetch = fetch): Promise<TakeOption[]> {
  const body = await unwrap<{ takes: TakeOption[] }>(await f('/api/takes'));
  return body.takes;
}

export async function analyzeTake(
  takeId: string,
  now: string | null = null,
  f: typeof fetch = fetch,
): Promise<DeliveryReport> {
  const payload = now === null ? { takeId } : { takeId, now };
  const res = await f('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return unwrap<DeliveryReport>(res);
}

export async function uploadTake(file: File, f: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const body = await unwrap<{ takeId: string }>(await f('/api/uploads', { method: 'POST', body: form }));
  return body.takeId;
}

/**
 * The confirm step. decideNextStep only ever proposes; this is the call that
 * fires the connector and comes back with executed:true.
 */
export async function executeNextStep(
  report: DeliveryReport,
  takeId: string,
  f: typeof fetch = fetch,
): Promise<NextStep> {
  const res = await f('/api/tools/suggest_next_step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, takeId, now: new Date().toISOString(), execute: true }),
  });
  return unwrap<NextStep>(res);
}

/* ---------------------------------------------------------------------- *
 * Offline fallback. Design §13: if the server is unreachable the widget
 * still renders a report. A demo that dies with the server is worse than
 * one that degrades.
 * ---------------------------------------------------------------------- */

const OFFLINE_FIXTURES: Record<string, unknown> = {
  clean: cleanFixture,
  rough: roughFixture,
};

export const OFFLINE_TAKES: TakeOption[] = [
  { id: 'clean', label: 'Clean take', mimeType: 'audio/mp4', hasFrozenTranscript: true },
  { id: 'rough', label: 'Rough take', mimeType: 'audio/mp4', hasFrozenTranscript: true },
];

export function offlineReport(takeId: string): DeliveryReport | null {
  const fixture = OFFLINE_FIXTURES[takeId];
  if (fixture === undefined) return null;
  return structuredClone(fixture) as DeliveryReport;
}

/* ---------------------------------------------------------------------- */

type Phase = 'loading' | 'ready' | 'error';

export default function App() {
  const [takes, setTakes] = useState<TakeOption[]>(OFFLINE_TAKES);
  const [takeId, setTakeId] = useState<string>('rough');
  const [report, setReport] = useState<DeliveryReport | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTakes()
      .then((live) => {
        if (cancelled || live.length === 0) return;
        setTakes(live);
        setOffline(false);
      })
      .catch(() => {
        if (cancelled) return;
        setOffline(true);
        setNotice('Server unreachable — showing the committed fixtures.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback((id: string) => {
    setPhase('loading');
    setNotice('');
    analyzeTake(id)
      .then((live) => {
        setReport(live);
        setPhase('ready');
        setOffline(false);
      })
      .catch((err: unknown) => {
        const fallback = offlineReport(id);
        if (fallback !== null) {
          setReport(fallback);
          setPhase('ready');
          setOffline(true);
          setNotice('Server unreachable — showing the committed fixture for this take.');
          return;
        }
        setPhase('error');
        setNotice(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Analysis failed.');
      });
  }, []);

  useEffect(() => {
    load(takeId);
  }, [takeId, load]);

  const onUpload = useCallback(
    (file: File) => {
      setPhase('loading');
      setNotice(`Uploading ${file.name}…`);
      uploadTake(file)
        .then(async (id) => {
          setTakes(await fetchTakes());
          setTakeId(id);
        })
        .catch((err: unknown) => {
          setPhase('error');
          setNotice(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Upload failed.');
        });
    },
    [],
  );

  const onExecute = useCallback(
    (step: NextStep) => {
      if (report === null || offline) return;
      executeNextStep(report, takeId)
        .then((executed) => setReport((prev) => (prev === null ? prev : { ...prev, nextStep: executed })))
        .catch((err: unknown) => {
          setNotice(err instanceof ApiError ? `${err.code}: ${err.message}` : `Could not execute ${step.kind}.`);
        });
    },
    [report, takeId, offline],
  );

  const activeLabel = useMemo(
    () => takes.find((t) => t.id === takeId)?.label ?? takeId,
    [takes, takeId],
  );

  return (
    <div className="dev-shell">
      <header className="dev-header">
        <h1>Delivery Coach · Timeline Widget</h1>
        <div className="fixture-tabs" role="tablist">
          {takes.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={takeId === t.id}
              className={`fixture-tab ${takeId === t.id ? 'active' : ''}`}
              onClick={() => setTakeId(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files.item(0);
          if (file !== null) onUpload(file);
        }}
        style={{
          background: 'rgba(148,163,184,0.05)',
          border: '1px dashed var(--border)',
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 12.5,
          color: 'var(--text-dim)',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: 'var(--text)' }}>{activeLabel}.</strong>{' '}
        Drop a recording here, or{' '}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          style={{ background: 'none', border: 0, color: 'var(--text)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          choose a file
        </button>
        .
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.item(0) ?? null;
            if (file !== null) onUpload(file);
          }}
        />
        {notice === '' ? null : (
          <div style={{ marginTop: 6, color: offline ? '#fbbf24' : 'var(--text-dim)' }}>{notice}</div>
        )}
      </div>

      {phase === 'error' || report === null ? (
        <div style={{ padding: 24, color: 'var(--text-dim)' }}>
          {phase === 'error' ? notice : 'Analyzing…'}
        </div>
      ) : (
        <DeliveryTimelineWidget
          key={report.reportId + '|' + report.status}
          report={phase === 'loading' ? { ...report, status: 'analyzing' } : report}
          onNextStepExecute={onExecute}
        />
      )}
    </div>
  );
}
