import { useCallback, useEffect, useRef, useState } from 'react';
import { gazeClient } from '../api/gazeClient.js';

const POINTS = [
  [10, 10], [50, 10], [90, 10],
  [10, 50], [50, 50], [90, 50],
  [10, 90], [50, 90], [90, 90],
];

// WebGazer trains on click position, so it needs repeated clicks per dot.
// The Python service dwells instead: one click starts a sample burst.
const CLICKS_PER_POINT = 5;

// If no sample is accepted for this long, the dot is visibly stuck. Say why and
// offer a way out rather than leaving the user staring at a frozen circle.
const STALL_MS = 4000;

const REASON_TEXT = {
  no_face: "I can't see your face — move so your whole face is in the camera view.",
  eyes_closed: 'Keep your eyes open and look right at the dot.',
  head_turned: 'Turn to face the screen more directly.',
};

export default function Calibration({ onDone, trackerStatus, source = 'webgazer', detail }) {
  const isPython = source === 'python';
  const [idx, setIdx] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 for the current dot
  const [stallReason, setStallReason] = useState(null);
  const [fitting, setFitting] = useState(false);
  const [errorPx, setErrorPx] = useState(null);
  const [failure, setFailure] = useState(null);

  const dotRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Last time a sample was actually accepted, used to detect a stall.
  const lastAcceptRef = useRef(0);
  const lastReasonRef = useRef(null);

  const ready = trackerStatus === 'running';
  const done = idx >= POINTS.length;

  // Tell the service a fresh calibration is starting; a stale one must not
  // contribute samples to the new fit.
  useEffect(() => {
    if (!isPython) return;
    gazeClient.beginCalibration();
  }, [isPython]);

  useEffect(() => {
    if (!isPython) return undefined;
    return gazeClient.on('calibration', (evt) => {
      if (evt.kind === 'progress') {
        if (evt.reason) {
          lastReasonRef.current = evt.reason;
          return; // nothing collected; leave the ring where it is
        }
        lastReasonRef.current = null;
        lastAcceptRef.current = Date.now();
        setStallReason(null);
        setProgress(evt.needed ? evt.collected / evt.needed : 0);
        if (evt.collected >= evt.needed) {
          setCollecting(false);
          setProgress(1);
          setIdx((i) => i + 1);
        }
      } else if (evt.kind === 'done') {
        setFitting(false);
        setErrorPx(evt.errorPx);
        // Hold the result on screen briefly so the parent can see it landed.
        setTimeout(() => onDoneRef.current?.(), 1400);
      } else if (evt.kind === 'error') {
        setFitting(false);
        setCollecting(false);
        setFailure(evt.message);
      }
    });
  }, [isPython]);

  // Watch for a dot that has stopped filling.
  useEffect(() => {
    if (!collecting) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - lastAcceptRef.current > STALL_MS) {
        setStallReason(lastReasonRef.current || 'no_face');
      }
    }, 500);
    return () => clearInterval(timer);
  }, [collecting]);

  // All dots collected -> fit.
  useEffect(() => {
    if (!done) return;
    if (!isPython) {
      onDoneRef.current?.();
      return;
    }
    if (fitting || errorPx != null || failure) return;
    setFitting(true);
    gazeClient.fitCalibration();
  }, [done, isPython, fitting, errorPx, failure]);

  const click = useCallback(() => {
    if (isPython) {
      if (collecting || !dotRef.current) return;
      // Send the dot's true viewport centre. The service calibrates directly
      // into viewport coordinates, so this is the value the fit maps to.
      const r = dotRef.current.getBoundingClientRect();
      setCollecting(true);
      setProgress(0);
      setStallReason(null);
      lastAcceptRef.current = Date.now();
      gazeClient.calibrationPoint(r.left + r.width / 2, r.top + r.height / 2);
      return;
    }
    const next = clicks + 1;
    if (next >= CLICKS_PER_POINT) {
      setClicks(0);
      setIdx((i) => i + 1);
    } else {
      setClicks(next);
    }
  }, [isPython, collecting, clicks]);

  function cancelPoint() {
    setCollecting(false);
    setProgress(0);
    setStallReason(null);
    // Drop the half-filled point and re-arm this position from scratch.
    gazeClient.beginCalibration();
    setIdx(0);
  }

  function retry() {
    setFailure(null);
    setErrorPx(null);
    setFitting(false);
    setCollecting(false);
    setProgress(0);
    setStallReason(null);
    setClicks(0);
    setIdx(0);
    if (isPython) gazeClient.beginCalibration();
  }

  const fill = isPython ? progress : clicks / CLICKS_PER_POINT;
  const [px, py] = POINTS[Math.min(idx, POINTS.length - 1)];
  // Keep the instructions away from the dot the user is meant to be staring at,
  // otherwise the first dot lands on top of the text.
  const panelSide = py > 50 ? { top: 24 } : { bottom: 24 };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(11,16,32,0.97)', zIndex: 50,
      color: 'white', display: 'grid', placeItems: 'center'
    }}>
      {!done && (
        <div style={{
          position: 'absolute', ...panelSide, left: '50%',
          transform: 'translateX(-50%)', width: 'min(560px, 90vw)',
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <h2 style={{ margin: '0 0 .25rem' }}>Look &amp; tap</h2>
          {!ready && <p className="muted">Starting camera&hellip; please wait.</p>}
          {ready && (
            <p className="muted" style={{ margin: 0 }}>
              {isPython
                ? `Tap the yellow dot, then keep looking at it until it fills. (${idx + 1}/${POINTS.length})`
                : `Look at the yellow dot and tap it ${CLICKS_PER_POINT} times. (${idx + 1}/${POINTS.length})`}
            </p>
          )}
          {stallReason && (
            <p className="badge bad" style={{ marginTop: '.75rem', display: 'inline-block' }}>
              {REASON_TEXT[stallReason] || 'Not getting a clear view of your eyes.'}
            </p>
          )}
          {isPython && !stallReason && (
            <p className="note" style={{ opacity: 0.6, marginTop: '.5rem' }}>
              Using the local eye-tracking service.
            </p>
          )}
        </div>
      )}

      {ready && !done && (
        <button
          ref={dotRef}
          onClick={click}
          disabled={collecting}
          aria-label={`Calibration point ${idx + 1} of ${POINTS.length}`}
          style={{
            position: 'absolute',
            left: `${px}%`,
            top: `${py}%`,
            transform: 'translate(-50%, -50%)',
            width: 64, height: 64,
            borderRadius: '50%',
            padding: 0,
            border: 'none',
            zIndex: 2,
            background: `conic-gradient(var(--accent) ${fill * 360}deg, rgba(255,255,255,0.18) 0)`,
            boxShadow: collecting
              ? '0 0 46px rgba(255,216,77,0.95)'
              : '0 0 30px rgba(255,216,77,0.5)',
            transition: 'box-shadow 120ms ease',
            cursor: collecting ? 'default' : 'pointer',
          }}
        />
      )}

      {stallReason && collecting && (
        <div style={{
          position: 'absolute', bottom: py > 50 ? 'auto' : 96, top: py > 50 ? 96 : 'auto',
          left: '50%', transform: 'translateX(-50%)',
        }}>
          <button className="ghost" onClick={cancelPoint}>Start over</button>
        </div>
      )}

      {fitting && <div className="card">Working out your calibration&hellip;</div>}

      {errorPx != null && (
        <div className="card stack" style={{ textAlign: 'center' }}>
          <h3 style={{ margin: 0 }}>Calibration saved ✅</h3>
          <p className="muted">Typical accuracy: about {Math.round(errorPx)} pixels.</p>
        </div>
      )}

      {failure && (
        <div className="card stack" style={{ textAlign: 'center', maxWidth: 420 }}>
          <h3 style={{ margin: 0 }}>Calibration didn&apos;t work</h3>
          <p className="muted">{failure}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button onClick={retry}>Try again</button>
            <button className="ghost" onClick={() => onDoneRef.current?.()}>Skip for now</button>
          </div>
        </div>
      )}
    </div>
  );
}
