import { useState } from 'react';
import type { DeliveryReport } from '@nsh/contracts';

type Props = {
  report: DeliveryReport;
  onToggleExecute?: (nextStep: NonNullable<DeliveryReport['nextStep']>) => void;
};

function formatEventDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function NextStepCard({ report, onToggleExecute }: Props) {
  const ns = report.nextStep;
  const [localExecuted, setLocalExecuted] = useState(false);

  if (!ns) {
    return (
      <div className="card">
        <div className="card-title"><span>→</span> Next step</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          Run through this take with a colleague you trust. The coach doesn't score confidence — real people do.
        </div>
      </div>
    );
  }

  const executed = localExecuted || ns.executed;
  const step = ns;

  function handleExecute() {
    setLocalExecuted(true);
    onToggleExecute?.(step);
  }

  if (ns.type === 'calendar_reminder') {
    return (
      <div className="card">
        <div className="card-title"><span>📅</span> Next step</div>
        <div className="ns-head">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div className="ns-icon cal">📆</div>
            <div>
              <p className="ns-title">Upcoming pitch event detected</p>
              <div className="ns-message">{ns.message}</div>
            </div>
          </div>
        </div>
        <div className="ns-event">
          <strong>{ns.eventTitle}</strong>
          <div style={{ marginTop: 2, color: 'var(--text-dim)' }}>
            {formatEventDate(ns.eventIsoDate)} · surfacing {ns.leadMinutes} min before
          </div>
        </div>
        {!executed ? (
          <div className="ns-actions">
            <button className="btn btn-primary" onClick={handleExecute}>
              ✓ Set reminder
            </button>
            <button className="btn btn-secondary" onClick={handleExecute}>
              Remind me later
            </button>
          </div>
        ) : (
          <div className="receipt">
            <div className="receipt-check">✓</div>
            <div className="receipt-text">
              Reminder set — this report will surface <strong>{ns.leadMinutes} minutes</strong> before your event.
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title"><span>✉</span> Next step</div>
      <div className="ns-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div className="ns-icon note">✎</div>
          <div>
            <p className="ns-title">Ask a real person to watch your next run</p>
            <div className="ns-message">{ns.message}</div>
          </div>
        </div>
      </div>
      <div className="ns-note-preview">
        <div className="nrow"><span className="nlabel">To</span>{ns.recipient}</div>
        <div className="nrow"><span className="nlabel">Subject</span><strong>{ns.subject}</strong></div>
        <div style={{ marginTop: 6, color: 'var(--text)', opacity: 0.9 }}>{ns.bodyPreview}</div>
      </div>
      {!executed ? (
        <div className="ns-actions">
          <button className="btn btn-primary" onClick={handleExecute}>
            ✎ Open draft
          </button>
          <button className="btn btn-secondary" onClick={handleExecute}>
            Tweak before sending
          </button>
        </div>
      ) : (
        <div className="receipt">
          <div className="receipt-check">✓</div>
          <div className="receipt-text">
            Draft note ready — drop it into your email for <strong>{ns.recipient}</strong>.
          </div>
        </div>
      )}
    </div>
  );
}
