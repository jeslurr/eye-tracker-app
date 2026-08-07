/**
 * Client for the Python gaze service (../../eye-tracking/server.py).
 *
 * A module-level singleton rather than a hook, because two separate components
 * need it at once: useGazeTracking consumes the sample stream, and Calibration
 * drives the calibration commands. Both must talk to the same socket.
 */

const URL = import.meta.env.VITE_GAZE_WS_URL || 'ws://127.0.0.1:8765';
const RECONNECT_MS = 1500;
// How long to wait for the service before deciding it isn't running.
const CONNECT_TIMEOUT_MS = 2500;
// How long a "service is down" verdict stays cached before probing again.
const PROBE_TTL_MS = 10_000;

const listeners = {
  sample: new Set(),
  status: new Set(),
  calibration: new Set(),
};

let socket = null;
let refCount = 0;
let reconnectTimer = null;
let connectTimer = null;
let available = null; // null = unknown, true/false once decided
let decidedAt = 0;
let lastStatus = { state: 'idle', calibrated: false, fps: 0, errorPx: null };
const availabilityWaiters = new Set();
// Commands issued before the socket opens. Calibration mounts as soon as the
// source is chosen, which can beat the connection when the source is pinned.
let pending = [];

function emit(channel, payload) {
  for (const fn of listeners[channel]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[gaze] ${channel} listener failed`, err);
    }
  }
}

function settleAvailability(value) {
  if (available === value) return;
  available = value;
  decidedAt = Date.now();
  for (const resolve of availabilityWaiters) resolve(value);
  availabilityWaiters.clear();
}

function open() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  let ws;
  try {
    ws = new WebSocket(URL);
  } catch {
    settleAvailability(false);
    scheduleReconnect();
    return;
  }
  socket = ws;

  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) {
      settleAvailability(false);
      ws.close();
    }
  }, CONNECT_TIMEOUT_MS);

  ws.onopen = () => {
    clearTimeout(connectTimer);
    settleAvailability(true);
    send({
      type: 'hello',
      viewport: {
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
    });
    const queued = pending;
    pending = [];
    for (const message of queued) send(message);
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'gaze':
        emit('sample', { x: msg.x, y: msg.y, t: msg.t, conf: msg.conf });
        break;
      case 'status':
        lastStatus = {
          state: msg.state,
          calibrated: !!msg.calibrated,
          fps: msg.fps ?? 0,
          errorPx: msg.error_px ?? null,
        };
        emit('status', lastStatus);
        break;
      case 'calib.progress':
        emit('calibration', {
          kind: 'progress',
          point: msg.point,
          collected: msg.collected,
          needed: msg.needed,
          reason: msg.reason ?? null,
        });
        break;
      case 'calib.done':
        emit('calibration', {
          kind: 'done',
          errorPx: msg.error_px,
          points: msg.points,
          samples: msg.samples,
        });
        break;
      case 'error':
        emit('calibration', { kind: 'error', message: msg.message });
        console.warn('[gaze] service error:', msg.message);
        break;
      default:
        break;
    }
  };

  ws.onclose = () => {
    clearTimeout(connectTimer);
    if (socket === ws) socket = null;
    if (available === null) settleAvailability(false);
    lastStatus = { ...lastStatus, state: 'disconnected' };
    emit('status', lastStatus);
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose always follows, so reconnect is handled there.
  };
}

function scheduleReconnect() {
  // Only stay connected while something is actually listening.
  if (refCount <= 0) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(open, RECONNECT_MS);
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/** send(), but hold the message until the socket opens if it hasn't yet. */
function sendOrQueue(message) {
  if (send(message)) return true;
  open();
  pending.push(message);
  // Bound the queue so a service that never comes up can't grow it forever.
  if (pending.length > 32) pending.shift();
  return false;
}

export const gazeClient = {
  /** Open the connection and keep it while at least one caller holds it. */
  acquire() {
    refCount += 1;
    open();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      refCount -= 1;
      if (refCount <= 0) {
        clearTimeout(reconnectTimer);
        clearTimeout(connectTimer);
        socket?.close();
        socket = null;
      }
    };
  },

  /**
   * Resolves true if the Python service is reachable, false otherwise.
   * Used to decide between the Python source and the WebGazer fallback.
   */
  probe() {
    if (available === true) return Promise.resolve(true);
    // A negative result goes stale: the user may start the service after the
    // app loaded. Re-test rather than pinning them to WebGazer until reload.
    if (available === false && Date.now() - decidedAt < PROBE_TTL_MS) {
      return Promise.resolve(false);
    }
    available = null;
    open();
    return new Promise((resolve) => {
      availabilityWaiters.add(resolve);
      setTimeout(() => {
        if (availabilityWaiters.delete(resolve)) resolve(available === true);
      }, CONNECT_TIMEOUT_MS + 250);
    });
  },

  get status() {
    return lastStatus;
  },

  get isConnected() {
    return socket?.readyState === WebSocket.OPEN;
  },

  on(channel, fn) {
    listeners[channel].add(fn);
    return () => listeners[channel].delete(fn);
  },

  // --- calibration commands ---
  beginCalibration() {
    return sendOrQueue({ type: 'calib.begin' });
  },
  /** Collect samples for a viewport-coordinate target. */
  calibrationPoint(x, y) {
    return sendOrQueue({ type: 'calib.point', x, y });
  },
  fitCalibration() {
    return sendOrQueue({ type: 'calib.fit' });
  },
  clearCalibration() {
    return sendOrQueue({ type: 'calib.clear' });
  },
};
