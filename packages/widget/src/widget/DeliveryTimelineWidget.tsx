import { useEffect, useRef, useState } from 'react';
import type { DeliveryIssue, DeliveryReport } from '@nsh/contracts';
import { isAllowedAudioUrl } from '@nsh/contracts';
import Timeline from './Timeline';
import ScriptPanel from './ScriptPanel';
import SummaryCard from './SummaryCard';
import NextStepCard from './NextStepCard';
import SkeletonLoader from './SkeletonLoader';
import './index.css';

type Props = {
  /**
   * The widget contract — frozen Tier-1 schema.
   *
   * IMPORTANT (the seam): the only thing that should ever change between
   * "building against fixture JSON" and "wiring to the real server" is the
   * one line that assigns `report`. This prop is the complete interface.
   */
  report: DeliveryReport;

  /** Optional callback invoked when user clicks an issue's confirm / execute button. */
  onNextStepExecute?: (nextStep: NonNullable<DeliveryReport['nextStep']>) => void;
};

export default function DeliveryTimelineWidget({ report, onNextStepExecute }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [targetedSegmentId, setTargetedSegmentId] = useState<string | null>(null);
  const selectedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Our contract types audioUrl as string | null (null before P2 attaches a
  // real recording); normalise to '' so the guard and the <audio> element both
  // get a plain string. isAllowedAudioUrl already rejects ''.
  const audioUrl = report.audioUrl ?? '';
  const safeAudioSrc = isAllowedAudioUrl(audioUrl) ? audioUrl : '';

  // Sync audio.currentTime via rAF-ish timeupdate events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const audio = a;
    function onTime() { setCurrentTime(audio.currentTime); }
    function onPlay() { setIsPlaying(true); }
    function onPause() { setIsPlaying(false); }
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onPause);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onPause);
    };
  }, [safeAudioSrc]);

  useEffect(() => {
    setCurrentTime(0);
    setSelectedIssueId(null);
    setTargetedSegmentId(null);
    const a = audioRef.current;
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch {}
    }
  }, [report.reportId, safeAudioSrc]);

  function handleSeek(sec: number) {
    const a = audioRef.current;
    if (a) {
      try { a.currentTime = sec; } catch {}
    }
    setCurrentTime(sec);
  }

  function handleTogglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => {}); } else { a.pause(); }
  }

  function handleSelectIssue(id: string | null) {
    setSelectedIssueId(id);
    if (selectedTimeoutRef.current) clearTimeout(selectedTimeoutRef.current);
  }

  function handleHighlightSegment(segId: string | null) {
    setTargetedSegmentId(segId);
    if (selectedTimeoutRef.current) clearTimeout(selectedTimeoutRef.current);
    selectedTimeoutRef.current = setTimeout(() => setTargetedSegmentId(null), 900);
  }

  function handleSummaryIssueClick(issue: DeliveryIssue) {
    setSelectedIssueId(issue.id);
    handleHighlightSegment(issue.segmentId);
    handleSeek(issue.timestamp);
  }

  if (report.status === 'analyzing') {
    return (
      <div className="widget">
        <audio ref={audioRef} src={safeAudioSrc} className="audio-wrap" />
        <SkeletonLoader />
      </div>
    );
  }

  return (
    <div className="widget widget-fade-in" role="region" aria-label="Delivery coach timeline">
      <audio ref={audioRef} src={safeAudioSrc} className="audio-wrap" controls />
      <div className="widget-inner">
        <Timeline
          report={report}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onSeek={handleSeek}
          onTogglePlay={handleTogglePlay}
          selectedIssueId={selectedIssueId}
          onSelectIssue={handleSelectIssue}
          onHighlightSegment={handleHighlightSegment}
        />
        <ScriptPanel
          report={report}
          currentTime={currentTime}
          targetedSegmentId={targetedSegmentId}
        />
        <div className="cards-grid">
          <SummaryCard report={report} onIssueClick={handleSummaryIssueClick} />
          <NextStepCard report={report} onToggleExecute={onNextStepExecute} />
        </div>
      </div>
    </div>
  );
}
