import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth, roleLabel, isGM } from '../contexts/AuthContext.jsx';
import { useWs } from '../contexts/WsContext.jsx';
import CharacterCard from '../components/CharacterCard.jsx';
import LinkCharacterModal from '../components/LinkCharacterModal.jsx';
import { optimizeImageFile } from '../lib/imageOptimization.js';
import { Camera, Plus, RefreshCw, ChevronDown, ChevronUp, Shield, Swords, Link, Unlink } from 'lucide-react';

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
      const uploadFile = await optimizeImageFile(file);
      const fd = new FormData();
      fd.append('file', uploadFile);
      const res = await fetch('/api/me/avatar', { method: 'PATCH', body: fd });
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
  const currentUserIsGM     = isGM(me);
  const currentUserCanSelfLink = Boolean(me) && !currentUserIsGM;

  const [profile, setProfile]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  // Player self-link: available characters to link/unlink
  const [availableChars, setAvailableChars]   = useState([]);
  const [loadingAvail, setLoadingAvail]       = useState(false);
  const [showLinkSection, setShowLinkSection] = useState(false);
  const [linkingId, setLinkingId]             = useState(null);

  const loadAvailableChars = useCallback(async () => {
    if (!isOwn || isGM(me)) return;
    setLoadingAvail(true);
    try {
      const data = await api.get('/me/characters/available');
      setAvailableChars(data ?? []);
    } catch {
      setAvailableChars([]);
    }
    setLoadingAvail(false);
  }, [isOwn, currentUserIsGM ]);

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
  useEffect(() => { if (showLinkSection) loadAvailableChars(); }, [showLinkSection, loadAvailableChars]);

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

  const selfLink = async (charId) => {
    setLinkingId(charId);
    try {
      await api.post(`/me/characters/${charId}/link`, {});
      await Promise.all([loadProfile(), loadAvailableChars()]);
    } catch (err) {
      alert(err.message);
    }
    setLinkingId(null);
  };

  const selfUnlink = async (charId) => {
    if (!confirm('Remover vínculo deste personagem?')) return;
    setLinkingId(charId);
    try {
      await api.delete(`/me/characters/${charId}/link`);
      await Promise.all([loadProfile(), loadAvailableChars()]);
    } catch (err) {
      alert(err.message);
    }
    setLinkingId(null);
  };

  const triggerSync = async () => {
    setSyncing(true);
    setSyncResult(null);

    try {
      const result = await api.post('/foundry/actors/sync', {});
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
  const activeChars  = characters.filter(c => c.active && !c.retired);
  const retiredChars = characters.filter(c => c.retired || !c.active);

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
            {isGM(user)
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
        {currentUserIsGM  && (
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
          {currentUserIsGM  && (
            <button className="add-char-btn" onClick={() => setShowLinkModal(true)}>
              <Plus size={12} /> Adicionar
            </button>
          )}
        </div>

        {activeChars.length === 0 ? (
          <div className="empty-state">
            <span>Nenhum personagem ativo.</span>
            {currentUserIsGM  && (
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
                isGM={currentUserIsGM}
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
                  isGM={currentUserIsGM}
                  onUpdate={loadProfile}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Player: self-link characters ──────────────────────────────────── */}
      {isOwn && currentUserCanSelfLink && (
        <section className="profile-section">
          <div className="profile-section-header">
            <h2 className="profile-section-title">
              <Link size={13} style={{ marginRight: 6 }} />
              Vincular Personagem
            </h2>
            <button
              className="add-char-btn"
              onClick={() => setShowLinkSection(v => !v)}
            >
              {showLinkSection ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showLinkSection ? 'Fechar' : 'Gerenciar'}
            </button>
          </div>

          {showLinkSection && (
            <div className="player-link-panel">
              <p className="player-link-hint">
                Selecione personagens do Foundry para vincular à sua conta.
                Personagens já vinculados aparecem marcados — clique em desvincular para remover.
              </p>

              {loadingAvail ? (
                <div className="empty-state" style={{ padding: 20 }}>Carregando personagens disponíveis...</div>
              ) : availableChars.length === 0 ? (
                <div className="empty-state">
                  <span>Nenhum personagem disponível para vincular.</span>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    Aguarde a sincronização do Foundry ou peça ao GM para vinculá-los.
                  </span>
                </div>
              ) : (
                <div className="avail-char-list">
                  {availableChars.map(char => {
                    const isLinked = char.isLinked;
                    const busy     = linkingId === char.id;
                    return (
                      <div key={char.id} className={`avail-char-row ${isLinked ? 'avail-char-linked' : ''}`}>
                        <div className="avail-char-token">
                          {char.tokenImg
                            ? <img
                                src={`/api/foundry/assets?path=${encodeURIComponent(char.tokenImg)}`}
                                alt={char.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={e => { e.target.style.display = 'none'; }}
                              />
                            : <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: '#fff', fontSize: 15 }}>{char.name[0]}</span>
                          }
                        </div>
                        <div className="avail-char-info">
                          <span className="avail-char-name">{char.name}</span>
                          <span className="avail-char-level">Nível {char.level}</span>
                        </div>
                        {isLinked
                          ? (
                            <button
                              className="avail-char-btn avail-char-btn-unlink"
                              onClick={() => selfUnlink(char.id)}
                              disabled={busy}
                              title="Remover vínculo"
                            >
                              <Unlink size={12} />
                              {busy ? '...' : 'Desvincular'}
                            </button>
                          )
                          : (
                            <button
                              className="avail-char-btn avail-char-btn-link"
                              onClick={() => selfLink(char.id)}
                              disabled={busy}
                              title="Vincular personagem"
                            >
                              <Link size={12} />
                              {busy ? '...' : 'Vincular'}
                            </button>
                          )
                        }
                      </div>
                    );
                  })}
                </div>
              )}
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

        /* Player self-link panel */
        .player-link-panel { display: flex; flex-direction: column; gap: 12px; }
        .player-link-hint { font-size: 12px; color: var(--text-faint); line-height: 1.5; }
        .avail-char-list { display: flex; flex-direction: column; gap: 6px; }
        .avail-char-row {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px; background: var(--bg-card);
          border: 1px solid var(--border); border-radius: var(--radius);
          transition: border-color 0.15s;
        }
        .avail-char-linked {
          border-color: rgba(201,168,76,0.3);
          background: rgba(201,168,76,0.05);
        }
        .avail-char-token {
          width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, #2a3060, #4a5090);
          display: flex; align-items: center; justify-content: center; overflow: hidden;
          border: 2px solid var(--border);
        }
        .avail-char-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .avail-char-name { font-size: 14px; font-weight: 600; color: var(--text); }
        .avail-char-level { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); }
        .avail-char-btn {
          display: flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: var(--radius);
          font-size: 11px; font-family: var(--font-display);
          letter-spacing: 0.8px; text-transform: uppercase;
          flex-shrink: 0; transition: all 0.15s;
        }
        .avail-char-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .avail-char-btn-link {
          background: var(--crimson); color: #f0d0d0;
          border: 1px solid rgba(196,48,48,0.3);
        }
        .avail-char-btn-link:hover:not(:disabled) { background: var(--crimson-bright); }
        .avail-char-btn-unlink {
          background: none; color: var(--text-muted);
          border: 1px solid var(--border);
        }
        .avail-char-btn-unlink:hover:not(:disabled) { color: var(--crimson-bright); border-color: var(--crimson); }

        @media (max-width: 600px) {
          .profile-header-card { flex-direction: column; align-items: center; text-align: center; }
          .profile-gm-tools { align-items: stretch; width: 100%; }
          .profile-stats-row { justify-content: center; }
          .char-grid { grid-template-columns: 1fr; }
          .avail-char-btn { padding: 5px 8px; }
        }
      `}</style>
    </div>
  );
}
