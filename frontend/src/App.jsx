import { Routes, Route, Navigate, Link } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import GamePage from './pages/GamePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

function Nav() {
  return (
    <div className="nav">
      <Link to="/" className="brand">🌟 Reading Friend</Link>
      <span className="spacer" />
      <Link to="/" className="badge">🏠 Home</Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <Nav />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/play/:childId" element={<GamePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/:childId" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
