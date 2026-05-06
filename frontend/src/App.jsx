import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Layout from './components/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import MissionsPage from './pages/MissionsPage.jsx';
import CemeteryPage from './pages/CemeteryPage.jsx';
import MapsPage from './pages/MapsPage.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import LgpdConsentModal from './components/LgpdConsentModal.jsx';
import ChooseNameModal from './components/ChooseNameModal.jsx';
import { useAuth } from './contexts/AuthContext.jsx';
import { useWs } from './contexts/WsContext.jsx';

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', flexDirection: 'column', gap: '16px',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--gold)', letterSpacing: '4px' }}>NIMROD</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', animation: 'pulse 1.5s infinite' }}>
        Carregando aventura...
      </div>
    </div>
  );
}

/** Syncs ROLE_UPDATED WS events → AuthContext refresh without page reload. */
function RoleSyncBridge() {
  const { userRef, refresh } = useAuth();
  const { on } = useWs();
  useEffect(() => {
    const unsub = on('ROLE_UPDATED', ({ userId } = {}) => {
      if (userId && userRef.current?.id === userId) refresh();
    });
    return unsub;
  }, [on, userRef, refresh]);
  return null;
}

export default function App() {
  const { user, loading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  //if (loading && splashDone) return <LoadingScreen />;

  // Blocking gates — resolved in strict order:
  //   1. Splash animation
  //   2. LGPD consent
  //   3. Display name selection (first login)
  //   4. App
  const needsConsent  = !loading && splashDone && user && !user.lgpdConsent;
  const needsName     = !loading && splashDone && user && user.lgpdConsent && !user.displayName;

  return (
    <>
      <RoleSyncBridge />

      {!splashDone && (
        <SplashScreen onDone={() => setSplashDone(true)} />
      )}

      {loading && splashDone && <LoadingScreen />}

      {needsConsent && <LgpdConsentModal />}
      {needsName && <ChooseNameModal />}

      <div style={{
        position: 'fixed',
        top: 10,
        left: 10,
        color: 'white',
        zIndex: 999999,
      }}>
      </div>

      {!loading && splashDone && (
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="missions" element={<MissionsPage />} />
              <Route path="cemetery" element={<CemeteryPage />} />
              <Route path="maps" element={<MapsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        )}
    </>
  );
}
