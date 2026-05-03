import { useEffect, useState } from 'react';

const POINTS = [
  [10, 10], [50, 10], [90, 10],
  [10, 50], [50, 50], [90, 50],
  [10, 90], [50, 90], [90, 90],
];
const CLICKS_PER_POINT = 5;

export default function Calibration({ onDone, trackerStatus }) {
  const [idx, setIdx] = useState(0);
  const [clicks, setClicks] = useState(0);
  const ready = trackerStatus === 'running';

  useEffect(() => {
    if (idx >= POINTS.length) onDone?.();
  }, [idx, onDone]);

  if (idx >= POINTS.length) return null;
  const [px, py] = POINTS[idx];

  function click() {
    const next = clicks + 1;
    if (next >= CLICKS_PER_POINT) {
      setClicks(0);
      setIdx((i) => i + 1);
    } else {
      setClicks(next);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(11,16,32,0.95)', zIndex: 50,
      color: 'white', display: 'grid', placeItems: 'center'
    }}>
      <div style={{ position: 'absolute', top: 24, left: 24 }}>
        <h2 style={{ margin: 0 }}>Look &amp; tap</h2>
        {ready
          ? <p className="muted">Look at the yellow dot and tap it {CLICKS_PER_POINT} times. ({idx + 1}/{POINTS.length})</p>
          : <p className="muted">Starting camera&hellip; please wait.</p>
        }
      </div>
      {ready && (
        <button
          onClick={click}
          style={{
            position: 'absolute',
            left: `${px}%`,
            top: `${py}%`,
            transform: 'translate(-50%, -50%)',
            width: 64, height: 64,
            borderRadius: '50%',
            padding: 0,
            background: `conic-gradient(var(--accent) ${(clicks / CLICKS_PER_POINT) * 360}deg, #444 0)`,
            boxShadow: '0 0 30px rgba(255,216,77,0.5)',
          }}
        />
      )}
    </div>
  );
}
