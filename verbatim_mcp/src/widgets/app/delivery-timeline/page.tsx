'use client';

import { useCallback } from 'react';
import { useWidgetSDK } from '@nitrostack/widgets';
import DeliveryTimelineWidget from '../../components/coach/DeliveryTimelineWidget';
import type { DeliveryReport } from '../../components/coach/contracts';
import '../../components/coach/index.css';

export default function DeliveryTimelinePage() {
  const { isReady, getToolOutput, callTool } = useWidgetSDK();
  const report = getToolOutput<DeliveryReport>();

  const onExecute = useCallback(
    (step: NonNullable<DeliveryReport['nextStep']>) => {
      if (!report) return;
      // The confirm button — the ONLY path that fires a connector. execute:true.
      callTool('suggest_next_step', {
        report,
        takeId: report.reportId.replace(/^rpt-demo-/, ''),
        now: new Date().toISOString(),
        execute: true,
      }).catch(() => { /* surfaced by the card's optimistic receipt */ });
      void step;
    },
    [report, callTool],
  );

  if (!isReady) return <div style={{ padding: 24 }}>Connecting to host…</div>;
  if (!report) return <div style={{ padding: 24 }}>No delivery report received.</div>;

  return <DeliveryTimelineWidget report={report} onNextStepExecute={onExecute} />;
}
