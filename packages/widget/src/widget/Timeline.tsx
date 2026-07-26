import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeliveryIssue, DeliveryReport, ScriptSegment } from '@nsh/contracts';
import { ISSUE_TYPE_LABEL, SEVERITY_LABEL, SEVERITY_COLOR } from '@nsh/contracts';
import { formatTime, getSegmentById, layoutTicks } from './utils';

type Props = {
  report: DeliveryReport;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (sec: number) => void;
  onTogglePlay: () => void;
  selectedIssueId: string | null;
  onSelectIssue: (id: string | null) => void;
  onHighlightSegment: (segId: string | null) => void;
};

export default function Timeline({
  report,
  currentTime,
  onSeek,
  selectedIssueId,
  onSelectIssue,
  onHighlightSegment,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const progress = report.durationSec > 0 ? Math.min(1, currentTime / report.durationSec) : 0;
  const tickLayout = useMemo(() => layoutTicks(report.issues), [report.issues]);

  useEffect(() => {
    function onUp() { draggingRef.current = false; }
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  function clientXToSec(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * report.durationSec;
  }

  function seekFromEvent(clientX: number) {
    onSeek(clientXToSec(clientX));
  }

  const clusterBadgeShown = new Set<string>();
  return (
    <div className="timeline-shell">
      <div className="timeline" style={{ '--progress': progress } as React.CSSProperties}>
        <div
          ref={trackRef}
          className="timeline-track"
          onClick={(e) => seekFromEvent(e.clientX)}
          onMouseDown={(e) => { draggingRef.current = true; seekFromEvent(e.clientX); }}
          onMouseMove={(e) => {
            const sec = clientXToSec(e.clientX);
            setHoverTime(sec);
            if (draggingRef.current) onSeek(sec);
          }}
          onMouseLeave={() => setHoverTime(null)}
          onTouchStart={(e) => { draggingRef.current = true; seekFromEvent(e.touches[0].clientX); }}
          onTouchMove={(e) => { if (draggingRef.current) onSeek(e.touches[0].clientX); }}
          role="slider"
          aria-label="Playback timeline"
          aria-valuemin={0}
          aria-valuemax={report.durationSec}
          aria-valuenow={currentTime}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft')  onSeek(Math.max(0, currentTime - 1));
            if (e.key === 'ArrowRight') onSeek(Math.min(report.durationSec, currentTime + 1));
          }}
        />

        <div
          className="timeline-handle"
          style={{ left: `${progress * 100}%` }}
        />

        <div className="timeline-ticks">
          {tickLayout.map(({ issue, lane, clusterSize, clusterMembers }) => {
            const showBadge = clusterSize > 1 && !clusterBadgeShown.has(clusterMembers.join('|'));
            if (clusterSize > 1) clusterBadgeShown.add(clusterMembers.join('|'));
            const sevColor = SEVERITY_COLOR[issue.severity];
            const selected = selectedIssueId === issue.id;
            const laneClass = `lane-${Math.min(lane, 5)}`;
            return (
              <TickView
                key={issue.id}
                issue={issue}
                report={report}
                leftPct={(issue.timestamp / report.durationSec) * 100}
                laneClass={laneClass}
                clusterSize={clusterSize}
                showBadge={showBadge}
                sevColor={sevColor}
                selected={selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectIssue(selected ? null : issue.id);
                  onHighlightSegment(issue.segmentId);
                  onSeek(issue.timestamp);
                }}
                segments={report.segments}
              />
            );
          })}
        </div>
      </div>

      <div className="timeline-ruler">
        <span>0:00</span>
        <span>{formatTime(report.durationSec / 4)}</span>
        <span>{formatTime(report.durationSec / 2)}</span>
        <span>{formatTime((report.durationSec * 3) / 4)}</span>
        <span>{formatTime(report.durationSec)}</span>
      </div>
      {hoverTime !== null && (
        <div style={{
          position: 'absolute', bottom: 4, left: 12,
          fontSize: 11, color: 'var(--text-dim)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          hover: {formatTime(hoverTime)}
        </div>
      )}
    </div>
  );
}

type TickViewProps = {
  issue: DeliveryIssue;
  report: DeliveryReport;
  leftPct: number;
  laneClass: string;   // e.g. "lane-0", "lane-1" — CSS class controls vertical stacking
  clusterSize: number;
  showBadge: boolean;
  sevColor: string;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  segments: ScriptSegment[];
};

function TickView({
  issue, leftPct, laneClass, clusterSize, showBadge, sevColor, selected, onClick, segments,
}: TickViewProps) {
  const seg = getSegmentById(segments, issue.segmentId);
  const style: React.CSSProperties = {
    left: `${leftPct}%`,
    ['--sev-color' as any]: sevColor,
  };
  if (selected) {
    style.zIndex = 50;
    style.transform = 'translateY(-4px) scale(1.45)';
  }
  return (
    <div
      className={`tick severity-${issue.severity} ${laneClass} ${clusterSize > 1 ? 'clustered' : ''}`}
      style={style}
      onClick={onClick}
      role="button"
      aria-label={`${SEVERITY_LABEL[issue.severity]} ${ISSUE_TYPE_LABEL[issue.type]} at ${formatTime(issue.timestamp)}`}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e as any); }}
      title={`${ISSUE_TYPE_LABEL[issue.type]} — ${SEVERITY_LABEL[issue.severity]}`}
    >
      {showBadge && clusterSize > 1 && <span className="tick-badge">{clusterSize}</span>}
      <span className="tooltip">
        <strong style={{ color: sevColor }}>{SEVERITY_LABEL[issue.severity]}</strong>
        {' · '}
        {ISSUE_TYPE_LABEL[issue.type]}
        {' · '}
        {formatTime(issue.timestamp)}
      </span>
      {selected && (
        <div className="popover">
          <button
            className="popover-close"
            aria-label="Close"
            onClick={(e) => { e.stopPropagation(); onClick(e); }}
          >×</button>
          <div className="popover-ttl">
            <span className={`badge badge-sev`} style={{ background: sevColor }}>
              {SEVERITY_LABEL[issue.severity]}
            </span>
            <span>{ISSUE_TYPE_LABEL[issue.type]}</span>
            {seg?.isKeyPoint && <span className="badge badge-kp">Key point</span>}
          </div>
          {seg && (
            <div className="popover-seg">
              <span className={seg.isKeyPoint ? 'kp' : ''}>{seg.text}</span>
            </div>
          )}
          <div className="popover-detail">{issue.detail}</div>
          <div className="popover-ts">
            <span>⏱ {formatTime(issue.timestamp)}</span>
            <span className="seek">Jump →</span>
          </div>
        </div>
      )}
    </div>
  );
}
