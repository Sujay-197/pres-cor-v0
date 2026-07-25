import { useState } from 'react';
import type { DeliveryReport } from '@nsh/contracts';

type Props = {
  report: DeliveryReport;
  onToggleExecute?: (nextStep: NonNullable<DeliveryReport['nextStep']>) => void;
};

function formatEventDate(iso: string | null): string {
  if (!iso) return '';
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

/**
 * Short preview of the draft body for the card. The contract carries the full
 * body only (draftBody); the old branch had a separate bodyPreview field, so we
 * derive the preview here rather than adding a field to the frozen NextStep.
 */
function preview(body: string | null, max = 90): string {
  if (!body) return '';
  return body.length <= max ? body : `${body.slice(0, max).trimEnd()}…`;
}

export default function NextStepCard({ report, onToggleExecute }: Props) {
  const ns = report.nextStep;
  const [localExecuted, setLocalExecuted] = useState(false);

  // No actionable step: either the report is still analysing (kind: 'none') or
  // no nextStep was attached. Both render the same neutral nudge.
  if (!ns || ns.kind === 'none') {
    return (
      <div className="card">
        <div className="card-title"><span>→</span> Next step</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {ns?.rationale ??
            "Run through this take with a colleague you trust. The coach doesn't score confidence — real people do."}
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

  if (ns.kind === 'calendar_reminder') {
    return (
      <div className="card">
        <div className="card-title"><span>📅</span> Next step</div>
        <div className="ns-head">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div className="ns-icon cal">📆</div>
            <div>
              <p className="ns-title">Upcoming pitch event detected</p>
              <div className="ns-message">{ns.rationale}</div>
            </div>
          </div>
        </div>
        <div className="ns-event">
          <strong>{ns.eventTitle}</strong>
          <div style={{ marginTop: 2, color: 'var(--text-dim)' }}>
            {formatEventDate(ns.eventStartsAt)}
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
              Reminder set — this report will surface before <strong>{ns.eventTitle}</strong>.
            </div>
          </div>
        )}
      </div>
    );
  }

  // draft_note
  return (
    <div className="card">
      <div className="card-title"><span>✉</span> Next step</div>
      <div className="ns-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div className="ns-icon note">✎</div>
          <div>
            <p className="ns-title">Ask a real person to watch your next run</p>
            <div className="ns-message">{ns.rationale}</div>
          </div>
        </div>
      </div>
      <div className="ns-note-preview">
        <div className="nrow"><span className="nlabel">To</span>{ns.recipientHint}</div>
        <div className="nrow"><span className="nlabel">Subject</span><strong>{ns.draftSubject}</strong></div>
        <div style={{ marginTop: 6, color: 'var(--text)', opacity: 0.9 }}>{preview(ns.draftBody)}</div>
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
            Draft note ready — drop it into your email for <strong>{ns.recipientHint}</strong>.
          </div>
        </div>
      )}
    </div>
  );
}
