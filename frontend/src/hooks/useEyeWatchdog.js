import { useEffect, useRef, useState } from 'react';

/**
 * Watches for gaze going quiet and fires a repeating alert while it stays quiet.
 *
 * Driven by the arrival of samples rather than by the service's reported state,
 * because "eyes not detected" has several causes that surface differently: no
 * face at all changes the state to `no_face`, but a head turned too far or eyes
 * half shut keeps the state at `running` while the samples fall below the
 * confidence floor and get dropped client-side. Silence covers every case, and
 * works identically for the WebGazer fallback which reports no state at all.
 *
 * Arms only after the first sample of the session. Without that, skipping
 * calibration — a supported choice — would nag the child every ten seconds
 * about eyes that were never being tracked in the first place.
 */
export function useEyeWatchdog({
  enabled,
  lastSampleAtRef,
  lossAfterMs = 2500,
  repeatMs = 10_000,
  onAlert,
} = {}) {
  const [lost, setLost] = useState(false);
  const lostSinceRef = useRef(null);
  const lastAlertRef = useRef(0);
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  useEffect(() => {
    if (!enabled) {
      setLost(false);
      lostSinceRef.current = null;
      return undefined;
    }

    const timer = setInterval(() => {
      const seenAt = lastSampleAtRef?.current || 0;
      // Never armed: tracking isn't running, so there is nothing to warn about.
      if (!seenAt) return;

      const now = Date.now();
      if (now - seenAt <= lossAfterMs) {
        if (lostSinceRef.current != null) {
          lostSinceRef.current = null;
          setLost(false);
        }
        return;
      }

      if (lostSinceRef.current == null) {
        // Fire the first alert here rather than falling through to the repeat
        // check. Seeding lastAlert with 0 and relying on `now - 0 >= repeatMs`
        // happens to work only because Date.now() is huge; it would silently
        // delay the first alert under any other clock.
        lostSinceRef.current = now;
        lastAlertRef.current = now;
        setLost(true);
        onAlertRef.current?.(0);
        return;
      }
      if (now - lastAlertRef.current >= repeatMs) {
        lastAlertRef.current = now;
        onAlertRef.current?.(Math.round((now - lostSinceRef.current) / 1000));
      }
    }, 500);

    return () => clearInterval(timer);
  }, [enabled, lossAfterMs, repeatMs, lastSampleAtRef]);

  return lost;
}
