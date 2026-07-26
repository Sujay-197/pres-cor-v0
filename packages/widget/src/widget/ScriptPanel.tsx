import { useEffect, useRef, useState } from 'react';
import type { DeliveryReport } from '@nsh/contracts';
import { formatTime } from './utils';

type Props = {
  report: DeliveryReport;
  currentTime: number;
  targetedSegmentId: string | null;
};

export default function ScriptPanel({ report, currentTime, targetedSegmentId }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevTargetRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let found: string | null = null;
    for (const seg of report.segments) {
      const s = seg.startSec ?? 0;
      const e = seg.endSec ?? report.durationSec;
      if (currentTime >= s && currentTime < e) { found = seg.id; break; }
    }
    if (!found && report.segments.length) {
      found = report.segments[report.segments.length - 1].id;
    }
    setActiveId(found);
  }, [currentTime, report.segments, report.durationSec]);

  useEffect(() => {
    if (!targetedSegmentId || targetedSegmentId === prevTargetRef.current) return;
    prevTargetRef.current = targetedSegmentId;
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-seg-id="${targetedSegmentId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [targetedSegmentId]);

  return (
    <div className="segments" ref={scrollerRef}>
      {report.segments.map((seg, idx) => {
        const issuesHere = report.issues.filter(i => i.segmentId === seg.id);
        const isActive = activeId === seg.id;
        const isTarget = targetedSegmentId === seg.id;
        return (
          <div
            key={seg.id}
            data-seg-id={seg.id}
            className={`segment ${isActive ? 'active' : ''} ${isTarget ? 'targeted' : ''}`}
          >
            <div className="seg-idx">
              <div style={{ fontWeight: 700 }}>seg {String(idx + 1).padStart(2, '0')}</div>
              <div style={{ marginTop: 2 }}>
                {seg.startSec !== undefined && seg.endSec !== undefined
                  ? `${formatTime(seg.startSec)} – ${formatTime(seg.endSec)}`
                  : '—'}
              </div>
            </div>
            <div className="seg-body">
              <div className="seg-text">
                <span className={seg.isKeyPoint ? 'kp' : ''}>{seg.text}</span>
              </div>
              <div className="seg-meta">
                {seg.isKeyPoint && (
                  <span className="marker" style={{ color: '#c4b5fd', background: 'rgba(139,92,246,0.14)' }}>
                    ★ Key point
                  </span>
                )}
                {seg.markedPause && (
                  <span className="marker" style={{ color: '#93c5fd', background: 'rgba(59,130,246,0.12)' }}>
                    ⏸ Marked pause
                  </span>
                )}
                {issuesHere.length > 0 && (
                  <span className="marker" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}>
                    {issuesHere.length} issue{issuesHere.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
