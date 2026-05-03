import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import GameScreen from '../components/GameScreen.jsx';

const LEVELS = [
  { id: 'shapes', label: '🔵 Shapes', desc: 'Identify basic shapes' },
  { id: 'letters', label: '🔤 Letters', desc: 'Recognise individual letters' },
  { id: 'words', label: '📖 Words', desc: 'Read simple words' },
  { id: 'sentences', label: '📝 Sentences', desc: 'Read full sentences' },
];

export default function GamePage() {
  const { childId } = useParams();
  const nav = useNavigate();
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(true);

  function loadLevel(level, difficulty = 1) {
    setPicking(false);
    setError('');
    api
      .get('/games/next', { params: { userId: childId, level, difficulty } })
      .then(({ data }) => setPlan({ ...data, level: level || data.level }))
      .catch((e) => setError(e.response?.data?.message || 'Could not load level'));
  }

  if (error) {
    return (
      <div className="container stack">
        <div className="card error">{error}</div>
        <button onClick={() => { setError(''); setPicking(true); }}>Back to levels</button>
      </div>
    );
  }

  if (picking) {
    return (
      <div className="container stack">
        <div className="card stack">
          <h1>Choose a level</h1>
          <p className="muted">Pick the game level you'd like to play.</p>
        </div>
        <div className="grid cols-2">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              className="card stack"
              onClick={() => loadLevel(l.id)}
              style={{ cursor: 'pointer', textAlign: 'left', border: '2px solid transparent' }}
            >
              <h2 style={{ margin: 0, color: '#ffffff' }}>{l.label}</h2>
              <span className="muted">{l.desc}</span>
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => loadLevel()}>Auto-pick (continue where I left off)</button>
      </div>
    );
  }

  if (!plan) return <div className="container"><div className="card">Loading level…</div></div>;

  if (result) {
    const r = result.result;
    return (
      <div className="container stack">
        <div className="card stack">
          <h1>Nice work! ⭐</h1>
          <p>You got <strong>{r.correct}</strong> out of <strong>{r.total}</strong> right.</p>
          {r.brainSpeed && <p>Brain speed: <span className="badge">{r.brainSpeed}</span></p>}
          {r.promoted && <p className="badge good">Level up! Next: {result.next.level}</p>}
          <div className="row">
            <button onClick={() => { setResult(null); setPlan(null); setPicking(true); }}>Play again</button>
            <Link to={`/dashboard/${childId}`}><button className="ghost">See report</button></Link>
            <button className="ghost" onClick={() => nav('/')}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <GameScreen
      childId={childId}
      level={plan.level}
      difficulty={plan.difficulty}
      targets={plan.targets}
      onFinish={(r) => r ? setResult(r) : nav('/')}
    />
  );
}
