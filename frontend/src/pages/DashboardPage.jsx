import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid,
} from 'recharts';
import { api } from '../api/client.js';
import Heatmap from '../components/Heatmap.jsx';

const SPEED_NUM = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const SPEED_LABEL = { LOW: '🐢 Slow', MEDIUM: '🚶 Moderate', HIGH: '⚡ Fast' };
const SPEED_COLOR = { LOW: '#ff6b8a', MEDIUM: '#ffd84d', HIGH: '#6cf2a8' };

const ACTION_LABELS = {
  HIGHLIGHT_LETTERS: '🔦 Highlighted letters',
  SPLIT_WORD: '✂️ Split word into parts',
  SIMPLIFY_UI: '🧹 Simplified the screen',
  ATTENTION_PROMPT: '👋 Attention prompt',
  PLAY_AUDIO: '🔊 Played audio help',
  DIFFICULTY_DOWN: '⬇️ Lowered difficulty',
  DIFFICULTY_UP: '⬆️ Raised difficulty',
};

export default function DashboardPage() {
  const { childId } = useParams();
  const [data, setData] = useState(null);
  const [children, setChildren] = useState([]);
  const [pickedId, setPickedId] = useState(childId || null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (childId) return;
    api.get('/auth/children').then(({ data }) => {
      setChildren(data.children);
      if (data.children[0]) setPickedId(data.children[0]._id);
    }).catch(() => {});
  }, [childId]);

  useEffect(() => {
    const id = childId || pickedId;
    if (!id) return;
    api.get(`/dashboard/${id}`)
      .then(({ data }) => setData(data))
      .catch((e) => setError(e.response?.data?.message || 'Could not load dashboard'));
  }, [childId, pickedId]);

  if (error) return <div className="container"><div className="card error">{error}</div></div>;
  if (!data) return <div className="container"><div className="card">Loading reports…</div></div>;

  const trend = (data.brainSpeedTrend || []).map((p) => ({
    at: new Date(p.at).toLocaleDateString(),
    speed: SPEED_NUM[p.brainSpeed] || 0,
    level: p.level,
  }));

  const latestResult = data.results?.[0];
  const totalSessions = data.results?.length || 0;
  const avgScore = totalSessions
    ? Math.round(data.results.reduce((a, r) => a + (r.total ? r.correct / r.total : 0), 0) / totalSessions * 100)
    : 0;

  return (
    <div className="container stack">
      {!childId && children.length > 0 && (
        <div className="row">
          <span className="muted">Child:</span>
          <select value={pickedId || ''} onChange={(e) => setPickedId(e.target.value)}>
            {children.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid cols-3">
        <div className="card stack" style={{ textAlign: 'center' }}>
          <span className="muted">Sessions played</span>
          <h1 style={{ margin: 0, fontSize: '2.5rem' }}>{totalSessions}</h1>
        </div>
        <div className="card stack" style={{ textAlign: 'center' }}>
          <span className="muted">Average accuracy</span>
          <h1 style={{ margin: 0, fontSize: '2.5rem', color: avgScore >= 70 ? 'var(--good)' : avgScore >= 40 ? 'var(--accent)' : 'var(--bad)' }}>{avgScore}%</h1>
        </div>
        <div className="card stack" style={{ textAlign: 'center' }}>
          <span className="muted">Latest processing speed</span>
          {latestResult?.brainSpeed ? (
            <h1 style={{ margin: 0, fontSize: '2rem', color: SPEED_COLOR[latestResult.brainSpeed] }}>
              {SPEED_LABEL[latestResult.brainSpeed]}
            </h1>
          ) : <h1 style={{ margin: 0, fontSize: '2rem', color: 'var(--ink-soft)' }}>—</h1>}
        </div>
      </div>

      <div className="grid cols-2">
        {/* Brain speed trend */}
        <div className="card stack">
          <h2>📈 Processing Speed Over Time</h2>
          <p className="note">How quickly your child recognises and responds to targets. Faster = higher score.</p>
          {trend.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend}>
                <CartesianGrid stroke="#2c3666" strokeDasharray="3 3" />
                <XAxis dataKey="at" stroke="#c0c8e8" fontSize={11} />
                <YAxis domain={[0, 3]} ticks={[1, 2, 3]} stroke="#c0c8e8"
                  tickFormatter={(v) => ({ 1: '🐢', 2: '🚶', 3: '⚡' }[v] || '')} />
                <Tooltip
                  contentStyle={{ background: '#1a2347', border: 0, borderRadius: 12 }}
                  formatter={(v) => [{ 1: 'Slow', 2: 'Moderate', 3: 'Fast' }[v], 'Speed']}
                />
                <Line type="monotone" dataKey="speed" stroke="#ffd84d" strokeWidth={3} dot />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="muted" style={{ padding: '2rem', textAlign: 'center' }}>Play some games to see trends here</div>}
        </div>

        {/* Adaptive helps */}
        <div className="card stack">
          <h2>🤖 Real-Time Help Given</h2>
          <p className="note">When the system detects struggle, it automatically helps. This shows what help was used.</p>
          {data.actionDensity?.length ? (
            <div className="stack" style={{ gap: '0.5rem' }}>
              {data.actionDensity.map((a) => (
                <div key={a.action} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{ACTION_LABELS[a.action] || a.action}</span>
                  <span className="badge">{a.count}×</span>
                </div>
              ))}
            </div>
          ) : <div className="muted" style={{ padding: '2rem', textAlign: 'center' }}>No help was needed — your child handled it independently! 🎉</div>}
        </div>

        {/* Gaze heatmap */}
        <div className="card stack" style={{ gridColumn: '1 / -1' }}>
          <h2>👁️ Eye Tracking Heatmap</h2>
          <p className="note">Shows where your child looked on screen during games. Bright spots = more attention. Helps identify reading patterns and focus areas.</p>
          <Heatmap points={data.heatmap || []} />
        </div>

        {/* Difficulty zones */}
        <div className="card stack" style={{ gridColumn: '1 / -1' }}>
          <h2>⚠️ Challenging Areas</h2>
          <p className="note">Letters, words, or shapes that caused confusion or needed re-reading. These are areas to practice more.</p>
          {data.difficultyZones?.length ? (
            <div className="grid cols-3" style={{ gap: '0.5rem' }}>
              {data.difficultyZones.map((z, i) => (
                <div key={i} className="card" style={{ padding: '0.75rem', background: 'var(--bg-soft)' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{z.target || '—'}</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {z.type === 'CONFUSION' ? '😕 Got confused' : '🔄 Decoding issue'} · {z.count}×
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="muted" style={{ padding: '2rem', textAlign: 'center' }}>🎉 No struggles detected — everything went smoothly!</div>}
        </div>

        {/* Recent sessions */}
        <div className="card stack" style={{ gridColumn: '1 / -1' }}>
          <h2>📋 Session History</h2>
          {data.results?.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#c0c8e8', fontSize: '0.85rem' }}>
                  <th style={{ padding: '0.5rem 0' }}>Date</th>
                  <th>Level</th>
                  <th>Score</th>
                  <th>Speed</th>
                  <th>Leveled up?</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r._id} style={{ borderTop: '1px solid #2c3666' }}>
                    <td style={{ padding: '0.5rem 0' }}>{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td><span className="badge">{r.level}</span></td>
                    <td><strong>{r.correct}/{r.total}</strong></td>
                    <td style={{ color: SPEED_COLOR[r.brainSpeed] || 'var(--ink-soft)' }}>
                      {SPEED_LABEL[r.brainSpeed] || '—'}
                    </td>
                    <td>{r.promoted ? '⭐ Yes!' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="muted" style={{ padding: '2rem', textAlign: 'center' }}>No sessions yet — start playing to see results here</div>}
        </div>
      </div>
    </div>
  );
}
