import { useMemo } from 'react';
import type { DeliveryIssue, DeliveryReport, Severity } from '@nsh/contracts';
import { ISSUE_TYPE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL } from '@nsh/contracts';
import { computePaceVariancePm, formatTime, getSegmentById, sortTopIssues } from './utils';

type Props = {
  report: DeliveryReport;
  onIssueClick: (issue: DeliveryIssue) => void;
};

export default function SummaryCard({ report, onIssueClick }: Props) {
  const topIssues = useMemo(() => sortTopIssues(report.issues).slice(0, 3), [report.issues]);
  const variance = useMemo(() => computePaceVariancePm(report.issues, report.avgPaceWpm), [report.issues, report.avgPaceWpm]);

  return (
    <div className="card">
      <div className="card-title">
        <span>▣</span> Delivery Summary
      </div>

      <div className="stats-row">
        <div className="stat">
          <div className="stat-label">Fillers</div>
          <div className="stat-value">
            {report.fillerCount}
            <span className="unit">total</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Avg pace</div>
          <div className="stat-value">
            {report.avgPaceWpm}
            <span className="unit">WPM</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Pace variance</div>
          <div className="stat-value">
            ±{variance}
            <span className="unit">WPM</span>
          </div>
        </div>
      </div>

      <div className="card-title" style={{ marginTop: 4, marginBottom: 8 }}>
        <span>★</span> Top moments to fix
      </div>

      <div className="top-issues">
        {topIssues.length === 0 && (
          <div style={{ padding: '12px 4px', fontSize: 13, color: 'var(--text-dim)' }}>
            Nothing flagged yet. This take is looking clean.
          </div>
        )}
        {topIssues.map((iss, i) => {
          const seg = getSegmentById(report.segments, iss.segmentId);
          const sevColor = SEVERITY_COLOR[iss.severity];
          return (
            <div
              key={iss.id}
              className={`top-issue severity-${iss.severity}`}
              onClick={() => onIssueClick(iss)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onIssueClick(iss); }}
              style={{ borderLeft: `3px solid ${sevColor}` }}
            >
              <div className="top-issue-rank">#{i + 1}</div>
              <div className="top-issue-body">
                <div className="top-issue-head">
                  <span className="top-issue-type">
                    <span style={{ color: sevColor, fontWeight: 700, marginRight: 4 }}>
                      {severityDot(iss.severity, sevColor)}
                      {SEVERITY_LABEL[iss.severity]}
                    </span>
                    {' '}
                    {ISSUE_TYPE_LABEL[iss.type]}
                  </span>
                  <span className="top-issue-ts">⏱ {formatTime(iss.timestamp)}</span>
                </div>
                <div className="top-issue-detail">
                  {seg && <strong style={{ color: 'var(--text)', fontWeight: 600 }}>&ldquo;{truncate(seg.text, 60)}&rdquo;</strong>}{' '}—{' '}
                  {iss.detail}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function severityDot(sev: Severity, color: string) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, marginRight: 4, boxShadow: `0 0 6px ${color}88`,
    }} aria-hidden />
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
