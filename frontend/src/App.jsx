import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';

import Layout from './components/Layout.jsx';
import BrandSeal from './components/BrandSeal.jsx';

const ExperienceEntryPage = lazy(() => import('./pages/ExperienceEntryPage.jsx'));
const MissionsPage = lazy(() => import('./pages/MissionsPage.jsx'));
const FoundryConnectPage = lazy(() => import('./pages/FoundryConnectPage.jsx'));
const CemeteryPage = lazy(() => import('./pages/CemeteryPage.jsx'));
const MapsPage = lazy(() => import('./pages/MapsPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const PatchNotesPage = lazy(() => import('./pages/PatchNotesPage.jsx'));
const SessionsPage = lazy(() => import('./pages/SessionsPage.jsx'));
const CalendarPage = lazy(() => import('./pages/CalendarPage.jsx'));
const SideQuestsPage = lazy(() => import('./pages/SideQuestsPage.jsx'));
const LobbyPage = lazy(() => import('./pages/LobbyPage.jsx'));
const Html5LobbyPage = lazy(() => import('./pages/Html5LobbyPage.jsx'));

import SplashScreen from './components/SplashScreen.jsx';
import LgpdConsentModal from './components/LgpdConsentModal.jsx';
import ChooseNameModal from './components/ChooseNameModal.jsx';

import { useAuth } from './contexts/AuthContext.jsx';
import { useWs } from './contexts/WsContext.jsx';

function LoadingScreen() {
  return <div className="app-loading" role="status"><BrandSeal /><strong>NIMROD</strong><span>Preparando sua próxima aventura…</span></div>;
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

/**
 * Banner global de enquete — aparece quando POLL_CREATED chega via WS.
 * Fecha automaticamente após 12 s ou ao clicar em X.
 * Navega para a Home (onde o mural está) ao clicar em "Ver enquete".
 */
function PollNotificationBanner() {
  const { on } = useWs();
  const { user } = useAuth();
  const [banner, setBanner] = useState(null); // { question, closesAt }

  useEffect(() => {
    const unsub = on('POLL_CREATED', (data) => {
      // Não notifica quem criou a enquete
      if (data?.creatorId && user?.id === data.creatorId) return;
      setBanner({ question: data.question, closesAt: data.closesAt ?? null });
    });
    return unsub;
  }, [on, user?.id]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 12_000);
    return () => clearTimeout(t);
  }, [banner]);

  if (!banner) return null;

  const deadline = banner.closesAt
    ? new Date(banner.closesAt).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })
    : null;

  return (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999,
      background: 'linear-gradient(135deg, #2a1a60, #1a1040)',
      border: '1px solid #5555cc',
      borderRadius: '10px',
      padding: '12px 18px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(85,85,204,0.3)',
      display: 'flex', alignItems: 'center', gap: '14px',
      maxWidth: 'min(95vw, 460px)',
      animation: 'slideDown 0.3s ease',
    }}>
      <span style={{ fontSize: '22px', flexShrink: 0 }}>📊</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: '#9999ee', fontFamily: 'var(--font-display)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '3px' }}>
          Nova enquete no mural
        </div>
        <div style={{ fontSize: '13px', color: '#ddd', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {banner.question}
        </div>
        {deadline && (
          <div style={{ fontSize: '11px', color: '#8888bb', marginTop: '3px' }}>
            ⏰ Encerra em {deadline}
          </div>
        )}
      </div>
      <a
        href="/?experience=classic"
        onClick={() => setBanner(null)}
        style={{
          flexShrink: 0,
          background: '#5555cc',
          color: '#fff',
          fontSize: '11px',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
          padding: '5px 12px',
          borderRadius: '6px',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Ver
      </a>
      <button
        aria-label="Dispensar aviso de enquete"
        onClick={() => setBanner(null)}
        style={{ background: 'none', border: 'none', color: '#666', fontSize: '16px', cursor: 'pointer', flexShrink: 0, lineHeight: 1, padding: '2px' }}
      >
        ×
      </button>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-16px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
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
      <PollNotificationBanner />

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
        <Suspense fallback={<LoadingScreen />}><Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<ExperienceEntryPage />} />
            <Route path="lobby" element={<LobbyPage />} />
            <Route path="lobby/html5" element={<Html5LobbyPage />} />
            <Route path="foundry-connect" element={<FoundryConnectPage />} />

            <Route
              path="missions"
              element={<MissionsPage />}
            />

            <Route
              path="sidequests"
              element={<SideQuestsPage />}
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
            <Route path="calendar" element={<CalendarPage />} />
          </Route>
        </Routes></Suspense>
      )}
    </>
  );
}
