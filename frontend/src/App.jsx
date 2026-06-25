import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

import Layout from './components/Layout.jsx';

import HomePage from './pages/HomePage.jsx';
import MissionsPage from './pages/MissionsPage.jsx';
import CemeteryPage from './pages/CemeteryPage.jsx';
import MapsPage from './pages/MapsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import PatchNotesPage from './pages/PatchNotesPage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';

import SplashScreen from './components/SplashScreen.jsx';
import LgpdConsentModal from './components/LgpdConsentModal.jsx';
import ChooseNameModal from './components/ChooseNameModal.jsx';

import { useAuth } from './contexts/AuthContext.jsx';
import { useWs } from './contexts/WsContext.jsx';

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      flexDirection: 'column',
      gap: '16px',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: '24px',
        color: 'var(--gold)',
        letterSpacing: '4px',
      }}>
        NIMROD
      </div>

      <div style={{
        color: 'var(--text-muted)',
        fontSize: '13px',
        animation: 'pulse 1.5s infinite',
      }}>
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
      if (userId && userRef.current?.id === userId) {
        refresh();
      }
    });

    return unsub;
  }, [on, userRef, refresh]);

  return null;
}

export default function App() {
  const { user, loading } = useAuth();

  const [splashDone, setSplashDone] = useState(false);

  // LGPD: informational only, localStorage-controlled, never blocks routes.
  const [lgpdSeen, setLgpdSeen] = useState(
    () => !!localStorage.getItem('lgpd_seen'),
  );

  // Display-name modal.
  const needsName =
    !loading &&
    splashDone &&
    user &&
    !user.displayName;

  // Show LGPD once.
  const showLgpd =
    !lgpdSeen &&
    !loading &&
    splashDone &&
    !!user;

  const handleLgpdClose = () => {
    localStorage.setItem('lgpd_seen', 'true');
    setLgpdSeen(true);
  };

  return (
    <>
      <RoleSyncBridge />

      {/* Splash */}
      {!splashDone && (
        <SplashScreen onDone={() => setSplashDone(true)} />
      )}

      {/* Auth loading */}
      {loading && splashDone && (
        <LoadingScreen />
      )}

      {/* LGPD */}
      {showLgpd && (
        <LgpdConsentModal onClose={handleLgpdClose} />
      )}

      {/* First-login name modal */}
      {needsName && (
        <ChooseNameModal />
      )}

      {/* Routes */}
      {!loading && splashDone && (
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />

            <Route
              path="missions"
              element={<MissionsPage />}
            />

            <Route
              path="cemetery"
              element={<CemeteryPage />}
            />

            <Route
              path="maps"
              element={<MapsPage />}
            />

            <Route
              path="profile"
              element={<ProfilePage />}
            />

            <Route
              path="profile/:userId"
              element={<ProfilePage />}
            />

            <Route
              path="*"
              element={<Navigate to="/" replace />}
            />

            <Route
              path="patch-notes"
              element={<PatchNotesPage />}
            />
            <Route path="gm/sessions" element={<SessionsPage />} />
          </Route>
        </Routes>
      )}
    </>
  );
}