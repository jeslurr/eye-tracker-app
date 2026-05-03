import { useEffect, useRef, useState } from 'react';

let webgazerPromise;

async function getWebGazer() {
  if (!webgazerPromise) {
    webgazerPromise = import('webgazer').then((m) => m.default || m);
  }
  return webgazerPromise;
}

export function useGazeTracking({ onSample, throttleMs = 33, enabled = true } = {}) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const lastEmitRef = useRef(0);
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let webgazer;

    async function start() {
      try {
        setStatus('loading');
        webgazer = await getWebGazer();
        if (cancelled) return;

        let firstData = false;
        webgazer
          .setRegression('ridge')
          .setGazeListener((data) => {
            if (!data) return;
            // Mark running on first real prediction
            if (!firstData) {
              firstData = true;
              if (!cancelled) setStatus('running');
            }
            const now = performance.now();
            if (now - lastEmitRef.current < throttleMs) return;
            lastEmitRef.current = now;
            onSampleRef.current?.({ x: data.x, y: data.y, t: Date.now() });
          })
          .saveDataAcrossSessions(true);

        await webgazer.begin();

        if (!cancelled) {
          webgazer.showVideoPreview(false).showPredictionPoints(false).showFaceOverlay(false);
          // If model loaded but no gaze data yet, still mark running so calibration can start
          if (!firstData && !cancelled) setStatus('running');
        }
      } catch (e) {
        if (!cancelled) { setError(e); setStatus('error'); }
      }
    }
    start();

    return () => {
      cancelled = true;
      try { webgazer?.pause?.(); webgazer?.end?.(); } catch {}
    };
  }, [enabled, throttleMs]);

  return { status, error };
}
