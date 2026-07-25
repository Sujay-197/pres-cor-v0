import { useEffect, useState } from 'react';
import DeliveryTimelineWidget from './widget/DeliveryTimelineWidget';
import type { DeliveryReport } from '@nsh/contracts';
import cleanFixture from '../../contracts/fixtures/report.clean.json';
import roughFixture from '../../contracts/fixtures/report.rough.json';

type FixtureKey = 'clean' | 'rough' | 'analyzing-then-clean' | 'analyzing-then-rough';

const FIXTURES: Record<FixtureKey, { label: string; desc: string; makeReport: () => DeliveryReport }> = {
  'clean': {
    label: 'Clean take',
    desc: 'Mostly green ticks, ~2 low fillers. SPEC §8 step 1 baseline.',
    makeReport: () => structuredClone(cleanFixture) as DeliveryReport,
  },
  'rough': {
    label: 'Rough take',
    desc: 'Red tick on the rushed key claim, overlap collision on 13.9 / 14.2s. SPEC §8 step 2 money shot.',
    makeReport: () => structuredClone(roughFixture) as DeliveryReport,
  },
  'analyzing-then-clean': {
    label: 'Analyzing → Clean',
    desc: 'Simulates a 3.5s analysis window before ready state.',
    makeReport: () => ({ ...(structuredClone(cleanFixture) as DeliveryReport), status: 'analyzing' }),
  },
  'analyzing-then-rough': {
    label: 'Analyzing → Rough',
    desc: 'Simulates a 3.5s analysis window before rough report.',
    makeReport: () => ({ ...(structuredClone(roughFixture) as DeliveryReport), status: 'analyzing' }),
  },
};

/**
 * APP-LEVEL TODO (h12-16, ONE-LINE SWAP):
 *
 * After P2's server returns generate_summary output matching the frozen DeliveryReport
 * schema, REPLACE the line below with live data:
 *
 *   const report = useLiveReportFromServer();   // ← one line
 *
 * And delete the fixture-tab switcher. The widget takes exactly one DeliveryReport prop.
 * If swapping isn't a one-line change, the schema contract failed.
 */
export default function App() {
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>('rough');
  const [report, setReport] = useState<DeliveryReport>(() => FIXTURES['rough'].makeReport());

  useEffect(() => {
    const fresh = FIXTURES[fixtureKey].makeReport();
    setReport(fresh);
    if (fresh.status === 'analyzing') {
      const target = fixtureKey === 'analyzing-then-clean' ? cleanFixture : roughFixture;
      const t = setTimeout(() => {
        setReport({ ...(structuredClone(target) as DeliveryReport), status: 'ready' });
      }, 3500);
      return () => clearTimeout(t);
    }
  }, [fixtureKey]);

  const meta = FIXTURES[fixtureKey];

  return (
    <div className="dev-shell">
      <header className="dev-header">
        <h1>Delivery Coach · Timeline Widget (P3)</h1>
        <div className="fixture-tabs" role="tablist">
          {(['clean', 'rough', 'analyzing-then-clean', 'analyzing-then-rough'] as FixtureKey[]).map(k => (
            <button
              key={k}
              role="tab"
              aria-selected={fixtureKey === k}
              className={`fixture-tab ${fixtureKey === k ? 'active' : ''}`}
              onClick={() => setFixtureKey(k)}
            >
              {FIXTURES[k].label}
            </button>
          ))}
        </div>
      </header>

      <div style={{
        background: 'rgba(148,163,184,0.05)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 16,
        fontSize: 12.5,
        color: 'var(--text-dim)',
        lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--text)' }}>{meta.label}.</strong> {meta.desc}
      </div>

      <DeliveryTimelineWidget
        key={report.reportId + '|' + report.status}
        report={report}
        onNextStepExecute={(ns) => {
          console.log('[demo] nextStep execute requested:', ns.kind, ns);
        }}
      />

      <div style={{
        marginTop: 18,
        padding: '14px 16px',
        background: 'rgba(34,197,94,0.06)',
        border: '1px solid rgba(34,197,94,0.18)',
        borderRadius: 12,
        fontSize: 12.5,
        lineHeight: 1.6,
        color: '#bbf7d0',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: '#86efac' }}>
          ⚠ One-line swap check (h12–16):
        </div>
        The widget's only input is <code style={{
          background: 'rgba(0,0,0,0.3)',
          padding: '1px 5px',
          borderRadius: 4,
        }}>report: DeliveryReport</code>. To go live: swap the fixture import for a
        server fetch / tool call in exactly one place (this file's <code style={{
          background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 4,
        }}>App.tsx</code>), delete the fixture tabs, done. If it's more than one
        import-line change, the schema contract failed — fix the fixture shape,
        don't patch the widget.
      </div>
    </div>
  );
}
