import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function HomePage() {
  const [children, setChildren] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/auth/children');
      setChildren(data.children);
      setErr('');
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not load children — is the server running?');
    }
  }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try {
      await api.post('/auth/children', { name });
      setName('');
    } catch (err) {
      setErr(err.response?.data?.message || 'Could not add child');
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  }

  async function remove(id) {
    if (!window.confirm('Delete this child profile?')) return;
    try {
      await api.delete(`/auth/children/${id}`);
    } catch (err) {
      setErr(err.response?.data?.message || 'Could not delete child');
      return;
    }
    await load();
  }

  return (
    <div className="container stack">
      <div className="card">
        <h1>Children</h1>
        <p className="muted">Pick a child to start a session, or add a new one.</p>
        <form onSubmit={add} className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Child's name" />
          <button disabled={busy}>Add</button>
        </form>
        {err && <div className="error">{err}</div>}
      </div>

      <div className="grid cols-3">
        {children.map((c) => (
          <div key={c._id} className="card stack">
            <h2 style={{ margin: 0 }}>{c.name}</h2>
            <span className="muted">Profile</span>
            <div className="row">
              <Link to={`/play/${c._id}`}><button>Play</button></Link>
              <Link to={`/dashboard/${c._id}`}><button className="ghost">Reports</button></Link>
              <button className="ghost" style={{ color: 'var(--error, #f87171)' }} onClick={() => remove(c._id)}>Delete</button>
            </div>
          </div>
        ))}
        {!children.length && <p className="muted">No children yet — add one above.</p>}
      </div>
    </div>
  );
}
