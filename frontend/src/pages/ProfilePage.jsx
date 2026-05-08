import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth, roleLabel } from '../contexts/AuthContext.jsx';
import { useWs } from '../contexts/WsContext.jsx';
import CharacterCard from '../components/CharacterCard.jsx';
import LinkCharacterModal from '../components/LinkCharacterModal.jsx';
import { Camera, Plus, RefreshCw, ChevronDown, ChevronUp, Shield, Swords } from 'lucide-react';

// ── Avatar upload ─────────────────────────────────────────────────────────────
function AvatarUpload({ avatarUrl, displayName, isOwn, onUploaded }) {
  const fileRef   = useRef(null);
  const [preview, setPreview]   = useState(avatarUrl);
  const [loading, setLoading]   = useState(false);

  const initial = displayName?.[0]?.toUpperCase() ?? '?';

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Instant preview
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/me/avatar', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload falhou');
      const data = await res.json();
      onUploaded?.(data.avatarUrl);
    } catch (err) {
      alert(err.message);
      setPreview(avatarUrl); // revert
    }
    setLoading(false);
  };

  return (
    <div className="avatar-wrap">
      <div className="avatar-circle">
        {preview
          ? <img src={preview} alt={displayName} className="avatar-img" />
          : <span className="avatar-initial">{initial}</span>
        }
        {loading && <div className="avatar-loading-overlay"><RefreshCw size={20} className="spin" /></div>}
      </div>

      {isOwn && (
        <>
          <button
            className="avatar-edit-btn"
            onClick={() => fileRef.current?.click()}
            title="Alterar foto de perfil"
            disabled={loading}
          >
            <Camera size={14} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
        </>
      )}

      <style>{`
        .avatar-wrap { position: relative; flex-shrink: 0; }
        .avatar-circle {
          width: 88px; height: 88px; border-radius: 50%;
          background: linear-gradient(135deg, #2a3060, #4a5090);
          border: 3px solid var(--border-bright);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; position: relative;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        .avatar-img { width: 100%; height: 100%; object-fit: cover; }
        .avatar-initial {
          font-family: var(--font-display); font-size: 32px; font-weight: 700; color: #fff;
        }
        .avatar-loading-overlay {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          color: var(--gold);
        }
        .avatar-edit-btn {
          position: absolute; bottom: 2px; right: 2px;
          width: 26px; height: 26px; border-radius: 50%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-bright);
          color: var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .avatar-edit-btn:hover { color: var(--gold); border-color: var(--gold-dim); }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatBadge({ icon: Icon, label, value }) {
  return (
    <div className="stat-badge">
      <Icon size={14} style={{ color: 'var(--gold)', opacity: 0.8 }} />
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>

      <style>{`
        .stat-badge { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); }
        .stat-value { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--text); }
        .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
      `}</style>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { userId } = useParams();
  const { user: me, setUser } = useAuth();
  const { on } = useWs();

  const targetId = userId ?? me?.id;
  const isOwn    = targetId === me?.id;
  const isGM     = me?.role === 'GM';

  const [profile, setProfile]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const loadProfile = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/players/${targetId}/profile`);
      setProfile(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [targetId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Sync WS events
  useEffect(() => {
    const u1 = on('CHARACTER_UPDATED', ({ userId: uid }) => {
      if (uid === targetId) loadProfile();
    });
    const u2 = on('AVATAR_UPDATED', ({ userId: uid, avatarUrl }) => {
      if (uid === targetId) {
        setProfile(p => p ? { ...p, user: { ...p.user, avatarUrl } } : p);
        if (isOwn) setUser(u => u ? { ...u, avatarUrl } : u);
      }
    });
    return () => { u1(); u2(); };
  }, [on, targetId, isOwn, loadProfile, setUser]);

  const handleAvatarUploaded = useCallback((avatarUrl) => {
    setProfile(p => p ? { ...p, user: { ...p.user, avatarUrl } } : p);
    if (isOwn) setUser(u => u ? { ...u, avatarUrl } : u);
  }, [isOwn, setUser]);

  const triggerSync = async () => {
    setSyncing(true);
    setSyncResult(null);

    try {
      await loadProfile();

      setSyncResult(
        '✓ Perfil atualizado com dados sincronizados do Foundry',
      );
    } catch (err) {
      setSyncResult(`✗ ${err.message}`);
    }

    setSyncing(false);
  };

  if (loading) return (
    <div className="profile-loading">
      {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: i === 1 ? 100 : 160 }} />)}
    </div>
  );

  if (error) return (
    <div className="profile-error">
      <p>Erro ao carregar perfil: {error}</p>
      <button onClick={loadProfile}>Tentar novamente</button>
    </div>
  );

  if (!profile) return null;

  const { user, characters, stats } = profile;
  const activeChars  = characters.filter(c => !c.retired);
  const retiredChars = characters.filter(c => c.retired);

  return (
    <div className="profile-root">

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="profile-header-card">
        <AvatarUpload
          avatarUrl={user.avatarUrl}
          displayName={user.displayName}
          isOwn={isOwn}
          onUploaded={handleAvatarUploaded}
        />

        <div className="profile-identity">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 className="profile-name">{user.displayName}</h1>
            {user.role === 'GM'
              ? <span className="gm-badge">GM — Mestre</span>
              : <span className="player-badge">Jogador</span>
            }
          </div>
          <div className="profile-stats-row">
            <StatBadge icon={Swords} label="Missões" value={stats.totalMissions} />
            <StatBadge icon={Shield} label="Ativas"  value={stats.activeMissions} />
          </div>
        </div>

        {/* GM tools */}
        {isGM && (
          <div className="profile-gm-tools">
            <button
              className="gm-tool-btn"
              onClick={() => setShowLinkModal(true)}
              title="Vincular personagem Foundry a este jogador"
            >
              <Plus size={13} /> Vincular Personagem
            </button>
            <button
              className="gm-tool-btn"
              onClick={triggerSync}
              disabled={syncing}
              title="Sincronizar personagens do Foundry"
            >
              <RefreshCw size={13} className={syncing ? 'spin' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar Foundry'}
            </button>
            {syncResult && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>
                {syncResult}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Active characters ─────────────────────────────────────────────── */}
      <section className="profile-section">
        <div className="profile-section-header">
          <h2 className="profile-section-title">⚔ Personagens Ativos</h2>
          {isGM && (
            <button className="add-char-btn" onClick={() => setShowLinkModal(true)}>
              <Plus size={12} /> Adicionar
            </button>
          )}
        </div>

        {activeChars.length === 0 ? (
          <div className="empty-state">
            <span>Nenhum personagem ativo.</span>
            {isGM && (
              <span style={{ fontSize: '13px', color: 'var(--text-faint)' }}>
                Sincronize com o Foundry ou adicione manualmente.
              </span>
            )}
          </div>
        ) : (
          <div className="char-grid">
            {activeChars.map(char => (
              <CharacterCard
                key={char.id}
                character={char}
                isOwn={isOwn}
                isGM={isGM}
                onUpdate={loadProfile}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Retired characters ────────────────────────────────────────────── */}
      {retiredChars.length > 0 && (
        <section className="profile-section">
          <button
            className="retired-toggle"
            onClick={() => setShowRetired(v => !v)}
          >
            {showRetired ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {retiredChars.length} personagem{retiredChars.length !== 1 ? 's' : ''} aposentado{retiredChars.length !== 1 ? 's' : ''}
          </button>

          {showRetired && (
            <div className="char-grid char-grid-retired">
              {retiredChars.map(char => (
                <CharacterCard
                  key={char.id}
                  character={char}
                  isOwn={isOwn}
                  isGM={isGM}
                  onUpdate={loadProfile}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showLinkModal && (
        <LinkCharacterModal
          targetUserId={targetId}
          onClose={() => setShowLinkModal(false)}
          onLinked={loadProfile}
        />
      )}

      <style>{`
        .profile-root { display: flex; flex-direction: column; gap: 24px; max-width: 860px; margin: 0 auto; }
        .profile-loading { display: flex; flex-direction: column; gap: 12px; }
        .profile-error { padding: 24px; text-align: center; color: var(--crimson-bright); }

        /* Header card */
        .profile-header-card {
          display: flex; align-items: flex-start; gap: 20px;
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 24px;
          flex-wrap: wrap;
        }
        .profile-identity { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 12px; }
        .profile-name { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: 1px; }
        .gm-badge { font-family: var(--font-display); font-size: 10px; font-weight: 700; color: var(--gold); letter-spacing: 1px; padding: 2px 8px; background: rgba(201,168,76,0.12); border: 1px solid var(--gold-dim); border-radius: var(--radius); }
        .player-badge { font-family: var(--font-display); font-size: 10px; color: var(--text-faint); letter-spacing: 0.8px; padding: 2px 8px; border: 1px solid var(--border); border-radius: var(--radius); }
        .profile-stats-row { display: flex; gap: 10px; flex-wrap: wrap; }

        /* GM tools */
        .profile-gm-tools { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
        .gm-tool-btn { display: flex; align-items: center; gap: 6px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-muted); font-size: 12px; padding: 6px 12px; border-radius: var(--radius); transition: all 0.15s; white-space: nowrap; }
        .gm-tool-btn:hover:not(:disabled) { color: var(--gold); border-color: var(--gold-dim); }
        .gm-tool-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Sections */
        .profile-section { display: flex; flex-direction: column; gap: 14px; }
        .profile-section-header { display: flex; align-items: center; justify-content: space-between; }
        .profile-section-title { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--gold); letter-spacing: 1.5px; text-transform: uppercase; }
        .add-char-btn { display: flex; align-items: center; gap: 4px; background: none; color: var(--text-faint); font-size: 12px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius); transition: all 0.15s; }
        .add-char-btn:hover { color: var(--gold); border-color: var(--gold-dim); }

        .char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
        .char-grid-retired { opacity: 0.65; }

        .retired-toggle { display: flex; align-items: center; gap: 6px; background: none; color: var(--text-faint); font-family: var(--font-display); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; border: none; padding: 4px 0; transition: color 0.15s; }
        .retired-toggle:hover { color: var(--text-muted); }

        .empty-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px; color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--radius-lg); font-style: italic; }

        @media (max-width: 600px) {
          .profile-header-card { flex-direction: column; align-items: center; text-align: center; }
          .profile-gm-tools { align-items: stretch; width: 100%; }
          .profile-stats-row { justify-content: center; }
          .char-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
