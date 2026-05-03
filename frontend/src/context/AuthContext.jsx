import { createContext, useContext, useEffect, useState } from 'react';
import { api, setAuthToken } from '../api/client.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!token) { setLoading(false); return; }
      setAuthToken(token);
      try {
        const { data } = await api.get('/auth/me');
        if (!cancelled) setUser(data.user);
      } catch {
        if (!cancelled) { setAuthToken(null); setToken(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [token]);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    setAuthToken(data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  async function register(payload) {
    const { data } = await api.post('/auth/register', payload);
    setAuthToken(data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
