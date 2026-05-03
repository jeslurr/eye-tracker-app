import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'parent' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await register(form);
      nav('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Sign-up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <div className="card stack">
        <h1>Create your account</h1>
        <p className="muted">For parents and teachers. Children get their own profiles inside your account.</p>
        <form onSubmit={submit} className="stack">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Your name" required />
          <input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="Email" type="email" required />
          <input value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Password (min 6 chars)" type="password" minLength={6} required />
          <select value={form.role} onChange={(e) => set('role', e.target.value)}>
            <option value="parent">Parent</option>
            <option value="teacher">Teacher</option>
          </select>
          {error && <div className="error">{error}</div>}
          <button disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="muted">Already have one? <Link to="/login">Sign in</Link>.</p>
      </div>
    </div>
  );
}
