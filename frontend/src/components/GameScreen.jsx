import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AdaptiveRenderer from './AdaptiveRenderer.jsx';
import GazeDot from './GazeDot.jsx';
import Calibration from './Calibration.jsx';
import { useGazeTracking } from '../hooks/useGazeTracking.js';
import { connectSocket } from '../api/socket.js';
import { api } from '../api/client.js';

const TARGET_TIME_MS = 12_000;
const ROUND_COUNT = 6;

const INSTRUCTIONS = {
  shapes: "Let's play the shapes game! You'll see a shape name on the screen. Look at the buttons below and tap the one that matches. Ready? Let's go!",
  letters: "Let's practice letters! I'll show you a letter at the top. Find and tap the same letter from the choices below. Listen carefully and look closely!",
  words: "Time to read some words! I'll show you a word. Find the matching word from the choices and tap it. Take your time and sound it out!",
  sentences: "Let's read sentences! I'll show you a sentence. Find the matching one from the choices below. Read carefully and tap the right answer!",
};

// --- Speech helper ---
function speak(text) {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    utterance.pitch = 1.1;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

function speakTarget(level, target) {
  const text = level === 'shapes' ? `Find the ${target}`
    : level === 'letters' ? `Find the letter ${target}`
    : level === 'words' ? `Find the word: ${target}`
    : `Find: ${target}`;
  return speak(text);
}

export default function GameScreen({ childId, level, difficulty, targets, onFinish }) {
  const [phase, setPhase] = useState('calibrate');
  const [sessionId, setSessionId] = useState(null);
  const [gaze, setGaze] = useState({ x: null, y: null });
  const [round, setRound] = useState(0);
  const [target, setTarget] = useState(null);
  const [choices, setChoices] = useState([]);
  const [correct, setCorrect] = useState(0);
  const [adaptAction, setAdaptAction] = useState(null);
  const [showFeedback, setShowFeedback] = useState(null);
  const [waitingForAudio, setWaitingForAudio] = useState(false);

  const targetRef = useRef(null);
  const socketRef = useRef(null);
  const reactionsRef = useRef([]);
  const targetShownAtRef = useRef(0);
  const firstFixationAtRef = useRef(null);
  const timerRef = useRef(null);

  const order = useMemo(() => buildRounds(targets, ROUND_COUNT), [targets]);

  const { status: trackerStatus } = useGazeTracking({
    enabled: phase !== 'calibrate' && phase !== 'idle' && phase !== 'instructions',
    onSample: (s) => {
      setGaze({ x: s.x, y: s.y });
      const t = s.t;
      const inTarget = isInside(targetRef.current, s.x, s.y);
      if (inTarget && firstFixationAtRef.current == null) firstFixationAtRef.current = t;
      socketRef.current?.emit('gaze.sample', {
        sessionId,
        t,
        x: s.x,
        y: s.y,
        target: inTarget ? target : undefined,
      });
    },
  });

  // Play instruction audio when entering instructions phase
  const playInstruction = useCallback(() => {
    speak(INSTRUCTIONS[level] || INSTRUCTIONS.shapes);
  }, [level]);

  useEffect(() => {
    if (phase === 'instructions') playInstruction();
  }, [phase, playInstruction]);

  useEffect(() => {
    if (phase !== 'starting') return;
    let mounted = true;
    (async () => {
      const { data } = await api.post('/games/session', {
        userId: childId,
        level,
        difficulty,
        deviceMeta: {
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          dpr: window.devicePixelRatio,
          ua: navigator.userAgent,
        },
      });
      if (!mounted) return;
      setSessionId(data.session._id);
      const sock = connectSocket();
      socketRef.current = sock;
      sock.on('connect', () => sock.emit('session.join', { sessionId: data.session._id }));
      sock.on('adapt.action', (a) => setAdaptAction(a));
      setPhase('playing');
    })();
    return () => { mounted = false; };
  }, [phase, childId, level, difficulty]);

  // When round changes during playing, speak the target first
  useEffect(() => {
    if (phase !== 'playing') return;
    if (round >= order.length) {
      void endSession();
      return;
    }
    const t = order[round];
    setTarget(t);
    setChoices(buildChoices(t, targets));
    setWaitingForAudio(true);

    // Speak the target, then start the timer
    speakTarget(level, t).then(() => {
      setWaitingForAudio(false);
      targetShownAtRef.current = Date.now();
      firstFixationAtRef.current = null;
      timerRef.current = setTimeout(() => answer(null, true), TARGET_TIME_MS);
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.speechSynthesis.cancel();
    };
  }, [phase, round, order, targets, level]);

  function replayTargetAudio() {
    if (target) speakTarget(level, target);
  }

  function answer(choice, timedOut = false) {
    if (phase !== 'playing') return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const now = Date.now();
    const reactionMs = now - targetShownAtRef.current;
    const decisionDelayMs = firstFixationAtRef.current
      ? now - firstFixationAtRef.current
      : reactionMs;
    reactionsRef.current.push({ reactionMs, decisionDelayMs });

    const ok = choice === target;
    if (ok) setCorrect((c) => c + 1);
    setShowFeedback(timedOut ? 'time' : ok ? 'good' : 'bad');
    socketRef.current?.emit('game.tick', { sessionId, correct: correct + (ok ? 1 : 0) });

    // Speak feedback
    if (ok) speak('Great job!');
    else if (timedOut) speak("Time's up! Let's try the next one.");
    else speak('Almost! Try again next round.');

    setTimeout(() => {
      setShowFeedback(null);
      setRound((r) => r + 1);
    }, 1200);
  }

  async function endSession() {
    setPhase('ending');
    try {
      socketRef.current?.emit('session.end', { sessionId });
      const { data } = await api.post(`/games/session/${sessionId}/end`, {
        correct,
        total: order.length,
        reactions: reactionsRef.current,
      });
      socketRef.current?.disconnect();
      onFinish?.(data);
    } catch (e) {
      console.error('end session', e);
      onFinish?.(null);
    }
  }

  // --- PHASE RENDERS ---

  if (phase === 'calibrate') {
    return (
      <div className="container stack">
        <div className="card stack">
          <h1>Eye Tracking Setup</h1>
          <p>Before we start, the camera needs to learn where your eyes are. Look at each yellow dot and tap it — this only takes about 30 seconds.</p>
          <p className="note">✅ Your calibration is <strong>saved</strong> — you won't need to redo it next time on this device.</p>
          <p className="note">📷 No video is stored — only gaze coordinates.</p>
          <div className="row">
            <button onClick={() => setPhase('calibrating')}>Start calibration</button>
            <button className="ghost" onClick={() => setPhase('instructions')}>Skip — play without eye tracking</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'calibrating') {
    return <Calibration trackerStatus={trackerStatus} onDone={() => setPhase('instructions')} />;
  }

  if (phase === 'instructions') {
    return (
      <div className="container stack">
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <h1>🎮 How to Play</h1>
          <p style={{ fontSize: '1.2rem', maxWidth: 500 }}>
            {level === 'shapes' && "I'll show you a shape name. Find and tap the matching shape from the choices below!"}
            {level === 'letters' && "I'll show you a letter. Find and tap the same letter from the choices below!"}
            {level === 'words' && "I'll show you a word. Find and tap the matching word from the choices below!"}
            {level === 'sentences' && "I'll show you a sentence. Find and tap the matching sentence from the choices below!"}
          </p>
          <p className="muted">🔊 Listen to the audio instructions for help.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button onClick={playInstruction}>🔁 Replay instructions</button>
            <button onClick={() => setPhase('starting')}>▶️ Start game</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'starting' || phase === 'ending') {
    return <div className="container"><div className="card">Getting things ready…</div></div>;
  }

  return (
    <div className="container stack">
      <div className="row">
        <span className="badge">Level: {level}</span>
        <span className="badge">Round {Math.min(round + 1, order.length)} / {order.length}</span>
        <span className="spacer" />
        <span className="badge good">⭐ {correct}</span>
      </div>

      <div className="card stack" style={{ alignItems: 'center' }}>
        <div className="row" style={{ justifyContent: 'center', gap: '1rem' }}>
          <p style={{ margin: 0, fontSize: '1.3rem' }}>Find: <strong style={{ fontSize: '1.6rem' }}>{target}</strong></p>
          <button className="ghost" onClick={replayTargetAudio} style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}>
            🔊 Replay
          </button>
        </div>
        <div ref={targetRef} style={{ width: '100%' }}>
          <AdaptiveRenderer target={target} action={adaptAction} />
        </div>
        <div className="choices">
          {choices.map((c) => (
            <button key={c} onClick={() => answer(c)} disabled={waitingForAudio}>{c}</button>
          ))}
        </div>
        {waitingForAudio && <p className="muted">🔊 Listen…</p>}
        {showFeedback && (
          <div className={`badge ${showFeedback === 'good' ? 'good' : 'bad'}`}>
            {showFeedback === 'good' ? '⭐ Great!' : showFeedback === 'time' ? "Let's try the next one" : 'Almost — try again next round'}
          </div>
        )}
      </div>

      <GazeDot x={gaze.x} y={gaze.y} />
    </div>
  );
}

function buildRounds(targets, count) {
  const out = [];
  if (!targets?.length) return out;
  for (let i = 0; i < count; i++) out.push(targets[i % targets.length]);
  return shuffle(out);
}

function buildChoices(answer, pool) {
  const others = pool.filter((p) => p !== answer);
  const wrong = shuffle(others).slice(0, Math.min(3, others.length));
  return shuffle([answer, ...wrong]);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isInside(el, x, y) {
  if (!el || x == null || y == null) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
