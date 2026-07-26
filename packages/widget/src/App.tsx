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

/**
 * OFFLINE_FIXTURES is a plain object literal, so it inherits from
 * Object.prototype: `OFFLINE_FIXTURES['constructor']` resolves to the
 * `Object` constructor rather than `undefined` via bracket access, even
 * though 'constructor' is not a registered take id — and 'constructor'
 * itself passes the server's take-id shape check, so a staged take with that
 * name is not far-fetched. Without this guard, a server failure for that
 * take would call `structuredClone(Object)`, which throws `DataCloneError`
 * — inside a `.catch` handler, so it becomes an unhandled rejection instead
 * of the offline fallback. `Object.hasOwn` makes the allow-list explicit,
 * matching the same fix already applied in apps/server/src/http.ts and
 * apps/server/src/adapters/connectors.ts.
 */
export function offlineReport(takeId: string): DeliveryReport | null {
  if (!Object.hasOwn(OFFLINE_FIXTURES, takeId)) return null;
  return structuredClone(OFFLINE_FIXTURES[takeId]) as DeliveryReport;
}

/* ---------------------------------------------------------------------- *
 * Guarded take load. Pulled out of the component so the race/cancellation
 * discipline is unit-testable without a DOM (the widget's vitest config runs
 * in `environment: 'node'` — there is no render() here). The `load` effect
 * below is just: call this, hand its cancel() to the effect cleanup.
 * ---------------------------------------------------------------------- */

export type TakeLoadResult =
  | { status: 'ready'; report: DeliveryReport; offline: false }
  | { status: 'ready'; report: DeliveryReport; offline: true; notice: string }
  | { status: 'error'; notice: string };

/**
 * Runs analyzeTake for `takeId` and reports the outcome to `onResult`,
 * falling back to the matching offline fixture on failure. Returns a
 * `cancel()` function: calling it — e.g. from a React effect's cleanup when
 * `takeId` changes again before this call has settled — suppresses the
 * `onResult` callback, so a stale response can never overwrite a newer one.
 * This is also what protects against React StrictMode's mount → cleanup →
 * mount double-invoke firing two concurrent loads for the same take: the
 * first invocation's cleanup cancels it before the second one's result can
 * land, so no state update happens twice.
 */
export function runTakeLoad(
  takeId: string,
  onResult: (result: TakeLoadResult) => void,
  f: typeof fetch = fetch,
): () => void {
  let cancelled = false;
  analyzeTake(takeId, null, f)
    .then((live) => {
      if (cancelled) return;
      onResult({ status: 'ready', report: live, offline: false });
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      const fallback = offlineReport(takeId);
      if (fallback !== null) {
        onResult({
          status: 'ready',
          report: fallback,
          offline: true,
          notice: 'Server unreachable — showing the committed fixture for this take.',
        });
        return;
      }
      onResult({
        status: 'error',
        notice: err instanceof ApiError ? `${err.code}: ${err.message}` : 'Analysis failed.',
      });
    });
  return () => {
    cancelled = true;
  };
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

  // Cleared on unmount; onUpload/onExecute are callbacks, not effects, so
  // they cannot return a cleanup function of their own — this ref is what
  // stops a late-arriving response from calling setState after the widget
  // has gone away.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // takeId changes (tab switch, or an upload landing) run this effect again.
  // React tears down the previous run's cleanup — which calls cancel() below
  // — before the new run starts, so an in-flight load for the take we just
  // navigated away from can never land after the one we navigated to. The
  // same cancel-before-restart sequencing is what protects against
  // StrictMode's mount → cleanup → mount double-invoke of this same effect.
  useEffect(() => {
    setPhase('loading');
    setNotice('');
    const cancel = runTakeLoad(takeId, (result) => {
      if (result.status === 'ready') {
        setReport(result.report);
        setPhase('ready');
        setOffline(result.offline);
        if (result.offline) setNotice(result.notice);
      } else {
        setPhase('error');
        setNotice(result.notice);
      }
    });
    return cancel;
  }, [takeId]);

  const onUpload = useCallback(
    (file: File) => {
      setPhase('loading');
      setNotice(`Uploading ${file.name}…`);
      uploadTake(file)
        .then(async (id) => {
          const live = await fetchTakes();
          if (!mountedRef.current) return;
          setTakes(live);
          setTakeId(id);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current) return;
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
        .then((executed) => {
          if (!mountedRef.current) return;
          setReport((prev) => (prev === null ? prev : { ...prev, nextStep: executed }));
        })
        .catch((err: unknown) => {
          if (!mountedRef.current) return;
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
