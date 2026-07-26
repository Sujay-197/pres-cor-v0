export default function SkeletonLoader() {
  return (
    <div className="widget-fade-in">
      <div className="analyzing-banner">
        <div className="spinner" />
        Analyzing delivery… correlating script segments with speech features.
      </div>
      <div className="skel-shell">
        <div className="skel skel-timeline" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skel skel-seg" style={{ opacity: 1 - i * 0.13 }} />
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, marginTop: 18 }}>
          <div className="skel skel-card" />
          <div className="skel skel-card" style={{ background: `linear-gradient(90deg, rgba(148,163,184,0.05), rgba(139,92,246,0.1), rgba(148,163,184,0.05))` }} />
        </div>
      </div>
    </div>
  );
}
