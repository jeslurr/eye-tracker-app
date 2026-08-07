import { useEffect, useRef, useState } from 'react';
import { gazeClient } from '../api/gazeClient.js';

/**
 * Gaze samples from whichever tracker is available.
 *
 * Two sources produce the same `{ x, y, t }` shape:
 *   python   - the MediaPipe service in ../../../eye-tracking (better accuracy,
 *              needs `python server.py` running locally)
 *   webgazer - in-browser fallback, always available, drifts more
 *
 * VITE_GAZE_SOURCE pins one of them; the default 'auto' probes for the Python
 * service and falls back to WebGazer when it isn't running.
 */

const CONFIGURED_SOURCE = import.meta.env.VITE_GAZE_SOURCE || 'auto';
// Samples below this confidence are blinks or extreme head turns. Passing them
// through would register as a saccade to wherever the lid happened to sit.
const MIN_CONFIDENCE = 0.4;

let webgazerPromise;

async function getWebGazer() {
  if (!webgazerPromise) {
    webgazerPromise = import('webgazer').then((m) => m.default || m);
  }
  return webgazerPromise;
}

// Service state -> the coarse status the UI cares about.
function mapServiceState(state) {
  switch (state) {
    case 'running':
    case 'uncalibrated':
    case 'calibrating':
    case 'no_face':
      return 'running'; // camera is alive; no_face is a transient framing issue
    case 'no_camera':
      return 'error';
    default:
      return 'loading';
  }
}

export function useGazeTracking({ onSample, throttleMs = 33, enabled = true } = {}) {
  const [status, setStatus] = useState('idle');
  const [source, setSource] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const lastEmitRef = useRef(0);
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cleanups = [];

    function emitSample(s) {
      const now = performance.now();
      if (now - lastEmitRef.current < throttleMs) return;
      lastEmitRef.current = now;
      onSampleRef.current?.(s);
    }

    function startPython() {
      setSource('python');
      cleanups.push(gazeClient.acquire());
      cleanups.push(
        gazeClient.on('sample', (s) => {
          if (cancelled) return;
          if (s.conf != null && s.conf < MIN_CONFIDENCE) return;
          emitSample({ x: s.x, y: s.y, t: s.t });
        })
      );
      cleanups.push(
        gazeClient.on('status', (st) => {
          if (cancelled) return;
          setDetail(st.state);
          setStatus(mapServiceState(st.state));
          if (st.state === 'no_camera') {
            setError(new Error('The gaze service could not open a webcam.'));
          }
        })
      );
      const current = gazeClient.status;
      setDetail(current.state);
      setStatus(mapServiceState(current.state));
    }

    async function startWebGazer() {
      setSource('webgazer');
      let webgazer;
      const teardown = () => {
        try {
          webgazer?.pause?.();
          webgazer?.end?.();
        } catch {
          /* webgazer throws if it never fully started */
        }
      };
      try {
        setStatus('loading');
        webgazer = await getWebGazer();
        if (cancelled) return;

        let firstData = false;
        webgazer
          .setRegression('ridge')
          .setGazeListener((data) => {
            if (!data || cancelled) return;
            if (!firstData) {
              firstData = true;
              setStatus('running');
            }
            emitSample({ x: data.x, y: data.y, t: Date.now() });
          })
          .saveDataAcrossSessions(true);

        await webgazer.begin();

        // The effect can be torn down during begin(), which resolves after the
        // camera is already live. Nothing would stop it if we only pushed the
        // cleanup afterwards.
        if (cancelled) {
          teardown();
          return;
        }
        webgazer.showVideoPreview(false).showPredictionPoints(false).showFaceOverlay(false);
        // Model is up even if no prediction has landed yet, so calibration can start.
        if (!firstData) setStatus('running');
      } catch (e) {
        teardown();
        if (!cancelled) {
          setError(e);
          setStatus('error');
        }
        return;
      }
      cleanups.push(teardown);
    }

    async function start() {
      setStatus('loading');
      if (CONFIGURED_SOURCE === 'python') {
        startPython();
        return;
      }
      if (CONFIGURED_SOURCE === 'webgazer') {
        await startWebGazer();
        return;
      }
      const pythonUp = await gazeClient.probe();
      if (cancelled) return;
      if (pythonUp) startPython();
      else await startWebGazer();
    }

    start();

    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
    };
  }, [enabled, throttleMs]);

  return { status, error, source, detail };
}
