import { Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import Layout from './components/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import MissionsPage from './pages/MissionsPage.jsx';
import CemeteryPage from './pages/CemeteryPage.jsx';
import MapsPage from './pages/MapsPage.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import { useAuth } from './contexts/AuthContext.jsx';

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', flexDirection: 'column', gap: '16px'
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--gold)', letterSpacing: '4px' }}>
        NIMROD
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', animation: 'pulse 1.5s infinite' }}>
        Carregando aventura...
      </div>
    </div>
  );
}

export default function App() {
  const { loading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  // Show splash until it signals done AND auth is resolved
  const showSplash = !splashDone;

  if (loading && splashDone) return <LoadingScreen />;

  return (
    <>
      {showSplash && (
        <SplashScreen onDone={() => setSplashDone(true)} />
      )}
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="missions" element={<MissionsPage />} />
          <Route path="cemetery" element={<CemeteryPage />} />
          <Route path="maps" element={<MapsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
