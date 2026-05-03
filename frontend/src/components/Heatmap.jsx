export default function Heatmap({ points = [] }) {
  if (!points.length) return <div className="heatmap center muted">No gaze data yet</div>;
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const maxC = Math.max(...points.map((p) => p.count));
  return (
    <div className="heatmap">
      {points.map((p, i) => {
        const left = ((p.x + 0.5) / (maxX + 1)) * 100;
        const top = ((p.y + 0.5) / (maxY + 1)) * 100;
        const intensity = Math.max(0.15, p.count / maxC);
        return (
          <div
            key={i}
            className="dot"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              opacity: intensity,
              transform: `translate(-50%, -50%) scale(${0.6 + intensity * 1.6})`,
            }}
          />
        );
      })}
    </div>
  );
}
