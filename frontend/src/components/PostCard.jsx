import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Heart, Trash2, MessageSquare, CornerDownRight, ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useAuth, isGM, isGMPrincipal, roleLabel } from '../contexts/AuthContext.jsx';

const MAX_VISIBLE_DEPTH = 3;

// ── PostAvatar ────────────────────────────────────────────────────────────────
// Exibe token_img do personagem quando disponível.
// Proxy idêntico ao TokenImg do CharacterCard para imagens do Foundry.
// Fallback: círculo com inicial, mesma lógica de cor de antes.
function PostAvatar({ author }) {
  const [imgErrored, setImgErrored] = useState(false);

  const authorIsGM      = isGM(author);
  const hasChar   = Boolean(author?.characterName);
  const rawSrc    = author?.characterTokenImg ?? null;

  // Mesma lógica de proxy do CharacterCard/TokenImg
  const proxied = rawSrc
    ? rawSrc.startsWith('/uploads/')
      ? rawSrc
      : `/api/foundry/assets?path=${encodeURIComponent(
          rawSrc.startsWith('http') ? new URL(rawSrc).pathname : rawSrc
        )}`
    : null;

  const showImg = proxied && !imgErrored;

  const fallbackInitial = hasChar
    ? author.characterName[0]?.toUpperCase() ?? '?'
    : (author?.displayName || 'A')[0]?.toUpperCase() ?? '?';

  const fallbackBg = authorIsGM
    ? 'linear-gradient(135deg, #8b2020, #c9a84c)'
    : 'linear-gradient(135deg, #2a3060, #4a5090)';

  return (
    <div
      className="post-avatar"
      style={showImg ? {} : { background: fallbackBg }}
    >
      {showImg
        ? <img
            src={proxied}
            alt={author.characterName}
            onError={() => setImgErrored(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        : fallbackInitial
      }
    </div>
  );
}

// ── AuthorChip ────────────────────────────────────────────────────────────────
// Exibe: [token] Personagem Lv 5 / por Jogador  (com personagem)
//        [inicial] Nome do Jogador               (sem personagem — legado)
function AuthorChip({ author }) {
  const playerName = author?.displayName || 'Aventureiro';
  const authorIsGM       = isGM(author);
  const hasChar    = Boolean(author?.characterName);

  return (
    <div className="post-author">
      <PostAvatar author={author} />

      <div className="post-author-meta">
        {hasChar ? (
          <>
            <div className="post-author-char-row">
              <span className="post-char-name">{author.characterName}</span>
              <span className="post-char-level">Lv {author.characterLevel}</span>
              {authorIsGM && <span className="gm-badge-sm">GM</span>}
            </div>
            <div className="post-author-player-row">
              <span className="post-author-by">por </span>
              <span className="post-author-name">{playerName}</span>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="post-author-name">{playerName}</span>
            {authorIsGM
              ? <span className="gm-badge-sm">GM</span>
              : <span className="role-badge-sm">Jogador</span>
            }
          </div>
        )}
      </div>
    </div>
  );
}

export const PostCard = memo(function PostCard({ post: initialPost, onUpdate, depth = 0 }) {
  const { user } = useAuth();
  const [localPost, setLocalPost]           = useState(initialPost);
  const [liking, setLiking]                 = useState(false);
  const [showReplyBox, setShowReplyBox]     = useState(false);
  const [repliesOpen, setRepliesOpen]       = useState(false);
  const [replies, setReplies]               = useState([]);
  const [repliesLoaded, setRepliesLoaded]   = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const post = localPost;

  useEffect(() => { setLocalPost(initialPost); }, [initialPost]);

  const like = async () => {
    if (liking) return;
    const wasLiked = post.likedByMe;
    setLocalPost(p => ({ ...p, likedByMe: !wasLiked, likeCount: wasLiked ? p.likeCount - 1 : p.likeCount + 1 }));
    setLiking(true);
    try {
      const res = await api.post(`/posts/${post.id}/like`, {});
      setLocalPost(p => ({ ...p, likedByMe: res.liked, likeCount: res.likeCount }));
    } catch {
      setLocalPost(p => ({ ...p, likedByMe: wasLiked, likeCount: wasLiked ? p.likeCount + 1 : p.likeCount - 1 }));
    }
    setLiking(false);
  };

  const del = async () => {
    if (!confirm('Apagar este post?')) return;
    // Remove otimisticamente antes da chamada de API
    onUpdate?.(post.id);
    try {
      await api.delete(`/posts/${post.id}`);
    } catch (e) {
      // Reverte em caso de erro (recarrega o pai)
      onUpdate?.();
      alert(e.message);
    }
  };

  const loadReplies = useCallback(async () => {
    setLoadingReplies(true);
    try {
      const data = await api.get(`/posts/${post.id}/replies`);
      setReplies(data);
      setRepliesLoaded(true);
    } catch {}
    setLoadingReplies(false);
  }, [post.id]);

  const toggleReplies = async () => {
    if (!repliesOpen && !repliesLoaded) await loadReplies();
    setRepliesOpen(v => !v);
  };

  const isOwn   = user?.id === post.author?.id;
  const hasMore = Number(post.replyCount) > 0;

  return (
    <div className={`post-wrap ${depth > 0 ? 'post-indented' : ''}`}>
      <article className="post-card animate-in">
        <div className="post-card-top">
          <AuthorChip author={post.author} />
          <span className="post-time">
            {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: ptBR })}
          </span>
        </div>

        <p className="post-content">{post.content}</p>

        {post.entityType && (
          <div className="post-entity-badge">
            {post.entityType === 'mission' ? '⚔ Missão' : '📊 Enquete'}
          </div>
        )}

        <div className="post-actions">
          <button onClick={like} disabled={liking} className={`like-btn ${post.likedByMe ? 'liked' : ''}`}>
            <Heart size={13} fill={post.likedByMe ? 'currentColor' : 'none'} />
            <span>{post.likeCount}</span>
          </button>

          {depth < MAX_VISIBLE_DEPTH && (
            <button onClick={() => setShowReplyBox(v => !v)} className="reply-trigger-btn">
              <MessageSquare size={13} /><span>Responder</span>
            </button>
          )}

          {hasMore && (
            <button onClick={toggleReplies} className="replies-toggle-btn">
              {repliesOpen
                ? <><ChevronUp size={12} /> Ocultar</>
                : <><ChevronDown size={12} /> {post.replyCount} resposta{post.replyCount !== 1 ? 's' : ''}</>
              }
            </button>
          )}

          {isOwn && (
            <button onClick={del} className="delete-btn"><Trash2 size={12} /></button>
          )}
        </div>

        {showReplyBox && (
          <ReplyComposer
            parentId={post.id}
            onSubmit={async (reply, replaceId, remove = false) => {
              if (remove && replaceId) {
                setReplies(prev => prev.filter(r => r.id !== replaceId));
                setLocalPost(p => ({ ...p, replyCount: Math.max(Number(p.replyCount || 0) - 1, 0) }));
                return;
              }
              if (reply?.id) {
                setReplies(prev => {
                  const withoutPrior = prev.filter(r => r.id !== reply.id && r.id !== replaceId);
                  return [...withoutPrior, reply];
                });
              }
              if (!replaceId) {
                setShowReplyBox(false);
                setLocalPost(p => ({ ...p, replyCount: Number(p.replyCount || 0) + 1 }));
              }
              setRepliesOpen(true);
            }}
            onCancel={() => setShowReplyBox(false)}
          />
        )}
      </article>

      {repliesOpen && (
        <div className="replies-thread">
          {loadingReplies
            ? <div className="skeleton" style={{ height: 60, margin: '6px 0' }} />
            : replies.map(r => (
                <PostCard key={r.id} post={r} depth={depth + 1} onUpdate={loadReplies} />
              ))
          }
        </div>
      )}

      <style>{`
        .post-wrap { display: flex; flex-direction: column; }
        .post-indented { margin-left: 28px; padding-left: 10px; border-left: 2px solid var(--border); }
        .post-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; transition: border-color 0.15s; }
        .post-card:hover { border-color: var(--border-bright); }
        .post-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }

        /* ── Author chip ── */
        .post-author { display: flex; align-items: center; gap: 9px; }
        .post-avatar { width: 32px; height: 32px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 13px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .post-author-meta { display: flex; flex-direction: column; gap: 1px; }

        /* Com personagem */
        .post-author-char-row { display: flex; align-items: center; gap: 5px; }
        .post-char-name { font-weight: 700; font-size: 14px; color: var(--text); font-family: var(--font-display); letter-spacing: 0.3px; }
        .post-char-level { font-size: 10px; font-family: var(--font-mono); color: var(--gold); background: rgba(201,168,76,0.1); border: 1px solid var(--gold-dim); border-radius: 3px; padding: 0px 4px; }
        .post-author-player-row { display: flex; align-items: center; }
        .post-author-by { font-size: 11px; color: var(--text-faint); }
        .post-author-name { font-size: 11px; color: var(--text-muted); }

        /* Sem personagem (legado) */
        .post-author-name { font-weight: 600; font-size: 14px; color: var(--text); }
        .post-time { font-size: 11px; color: var(--text-faint); white-space: nowrap; }
        .gm-badge-sm { font-family: var(--font-display); font-size: 8px; font-weight: 700; color: var(--gold); letter-spacing: 1px; padding: 1px 4px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold-dim); border-radius: 2px; }
        .role-badge-sm { font-family: var(--font-display); font-size: 8px; color: var(--text-faint); letter-spacing: 0.5px; text-transform: uppercase; }

        .post-content { font-size: 15px; line-height: 1.65; color: var(--text); white-space: pre-wrap; word-break: break-word; }
        .post-entity-badge { display: inline-block; font-size: 11px; color: var(--gold); letter-spacing: 0.5px; background: rgba(201,168,76,0.08); border: 1px solid var(--gold-dim); border-radius: var(--radius); padding: 2px 8px; margin: 8px 0 0; }
        .post-actions { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
        .like-btn { display: flex; align-items: center; gap: 4px; background: none; border: 1px solid var(--border); color: var(--text-muted); border-radius: var(--radius); padding: 3px 9px; font-size: 12px; transition: all 0.15s; }
        .like-btn:hover { border-color: #a02020; color: #c04040; }
        .like-btn.liked { color: #c04040; border-color: #5a1515; background: rgba(139,32,32,0.1); }
        .reply-trigger-btn { display: flex; align-items: center; gap: 4px; background: none; color: var(--text-faint); border: 1px solid transparent; border-radius: var(--radius); padding: 3px 8px; font-size: 12px; transition: all 0.15s; }
        .reply-trigger-btn:hover { color: var(--text); border-color: var(--border); }
        .replies-toggle-btn { display: flex; align-items: center; gap: 3px; background: none; color: var(--text-faint); font-size: 11px; padding: 3px 6px; border: none; border-radius: var(--radius); transition: color 0.15s; font-family: var(--font-display); }
        .replies-toggle-btn:hover { color: var(--gold); }
        .delete-btn { background: none; border: none; color: var(--text-faint); padding: 3px; border-radius: var(--radius); transition: color 0.15s; margin-left: auto; }
        .delete-btn:hover { color: var(--crimson-bright); }
        .replies-thread { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      `}</style>
    </div>
  );
});

// ── ReplyComposer ─────────────────────────────────────────────────────────────
// Respostas também podem ter personagem associado.
// Carrega os personagens do usuário ao montar e permite selecionar.
function ReplyComposer({ parentId, onSubmit, onCancel }) {
  const { user } = useAuth();
  const [content, setContent]         = useState('');
  const [loading, setLoading]         = useState(false);
  const [characters, setCharacters]   = useState([]);
  const [characterId, setCharacterId] = useState('');

  // Carrega personagens ativos do usuário
  useEffect(() => {
    if (!user?.id) return;
    api.get('/me/characters')
      .then(chars => {
        const active = chars.filter(c => !c.retired && c.active !== false);
        setCharacters(active);
        if (active.length === 1) setCharacterId(active[0].id);
      })
      .catch(() => {});
  }, [user?.id]);

  const submit = async () => {
    if (!content.trim()) return;
    const nextContent = content.trim();
    const tempId      = `temp-reply-${Date.now()}`;

    // Resolve dados do personagem selecionado para o post otimista
    const selectedChar = characters.find(c => c.id === characterId);

    const optimisticReply = {
      id:         tempId,
      content:    nextContent,
      parentId,
      likeCount:  0,
      likedByMe:  false,
      replyCount: 0,
      createdAt:  new Date().toISOString(),
      author: {
        id:             user?.id,
        displayName:    user?.displayName || user?.name || 'Aventureiro',
        role:           user?.role,
        characterId:        selectedChar?.id       ?? null,
        characterName:      selectedChar?.name     ?? null,
        characterLevel:     selectedChar?.level    ?? null,
        characterTokenImg:  selectedChar?.tokenImg ?? null,
      },
    };

    setLoading(true);
    setContent('');
    onSubmit?.(optimisticReply);
    try {
      const post = await api.post('/posts', {
        content:     nextContent,
        parentId,
        characterId: characterId || undefined,
      });
      onSubmit?.(post, tempId);
    } catch (e) {
      onSubmit?.(null, tempId, true);
      setContent(nextContent);
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="reply-composer">
      <CornerDownRight size={13} style={{ color: 'var(--text-faint)', flexShrink: 0, marginTop: 8 }} />
      <div style={{ flex: 1 }}>
        {/* Seletor de personagem — só aparece se o usuário tem personagens */}
        {characters.length > 0 && (
          <select
            value={characterId}
            onChange={e => setCharacterId(e.target.value)}
            style={{
              width: '100%', marginBottom: '6px',
              fontSize: '12px', fontFamily: 'var(--font-display)',
              background: 'var(--bg-elevated)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '4px 8px',
            }}
          >
            <option value="">— Responder como jogador —</option>
            {characters.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} (Lv {c.level})
              </option>
            ))}
          </select>
        )}

        <textarea
          autoFocus value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
          placeholder="Responder..." maxLength={500} rows={2}
          style={{ fontSize: '13px', resize: 'none' }}
        />
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ background: 'none', color: 'var(--text-faint)', fontSize: '12px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            Cancelar
          </button>
          <button onClick={submit} disabled={loading || !content.trim()} style={{ background: 'var(--crimson)', color: '#f0d0d0', fontSize: '12px', padding: '4px 14px', fontFamily: 'var(--font-display)', letterSpacing: '0.8px', textTransform: 'uppercase', border: '1px solid rgba(196,48,48,0.3)', borderRadius: 'var(--radius)', opacity: loading || !content.trim() ? 0.5 : 1 }}>
            Enviar
          </button>
        </div>
      </div>
      <style>{`.reply-composer { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }`}</style>
    </div>
  );
}

// ── PostComposer ──────────────────────────────────────────────────────────────
// Agora carrega os personagens do usuário e exibe um seletor acima do textarea.
export function PostComposer({ onPost }) {
  const { user } = useAuth();
  const [content, setContent]         = useState('');
  const [loading, setLoading]         = useState(false);
  const [characters, setCharacters]   = useState([]);
  const [characterId, setCharacterId] = useState('');
  const [charsLoading, setCharsLoading] = useState(true);

  // Carrega personagens ativos do usuário autenticado
  useEffect(() => {
    if (!user?.id) return;
    setCharsLoading(true);
    api.get('/me/characters')
      .then(chars => {
        const active = chars.filter(c => !c.retired && c.active !== false);
        setCharacters(active);
        // Pré-seleciona automaticamente se só há um personagem
        if (active.length === 1) setCharacterId(active[0].id);
      })
      .catch(() => {})
      .finally(() => setCharsLoading(false));
  }, [user?.id]);

  const submit = async () => {
    if (!content.trim()) return;
    const nextContent  = content.trim();
    const tempId       = `temp-${Date.now()}`;

    // Resolve dados do personagem selecionado para o post otimista
    const selectedChar = characters.find(c => c.id === characterId);

    const optimisticPost = {
      id:         tempId,
      content:    nextContent,
      parentId:   null,
      entityType: null,
      entityId:   null,
      likeCount:  0,
      likedByMe:  false,
      replyCount: 0,
      createdAt:  new Date().toISOString(),
      author: {
        id:             user?.id,
        displayName:    user?.displayName || user?.name || 'Aventureiro',
        role:           user?.role,
        characterId:        selectedChar?.id       ?? null,
        characterName:      selectedChar?.name     ?? null,
        characterLevel:     selectedChar?.level    ?? null,
        characterTokenImg:  selectedChar?.tokenImg ?? null,
      },
    };

    setLoading(true);
    setContent('');
    onPost?.(optimisticPost);
    try {
      const post = await api.post('/posts', {
        content:     nextContent,
        characterId: characterId || undefined,  // ← envia o personagem selecionado
      });
      onPost?.(post, tempId);
    } catch (e) {
      onPost?.(null, tempId, true);
      setContent(nextContent);
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="composer">
      {/* ── Seletor de personagem ── */}
      {!charsLoading && characters.length > 0 && (
        <div className="composer-char-row">
          <span className="composer-char-label">Postar como:</span>
          <select
            value={characterId}
            onChange={e => setCharacterId(e.target.value)}
            className="composer-char-select"
          >
            <option value="">— Jogador (sem personagem) —</option>
            {characters.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} · Lv {c.level}
              </option>
            ))}
          </select>
        </div>
      )}

      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={
          characterId
            ? `O que ${characters.find(c => c.id === characterId)?.name ?? 'seu personagem'} faz?`
            : 'O que aconteceu na aventura?'
        }
        maxLength={500}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
        rows={3}
      />

      <div className="composer-footer">
        <span style={{ fontSize: '12px', color: content.length > 450 ? 'var(--crimson-bright)' : 'var(--text-faint)' }}>
          {content.length}/500
        </span>
        <button onClick={submit} disabled={loading || !content.trim()} className="post-btn">
          Postar
        </button>
      </div>

      <style>{`
        .composer { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 10px; }

        /* Seletor de personagem */
        .composer-char-row { display: flex; align-items: center; gap: 8px; }
        .composer-char-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-family: var(--font-display); white-space: nowrap; }
        .composer-char-select { flex: 1; font-size: 13px; font-family: var(--font-display); background: var(--bg-elevated); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 5px 8px; transition: border-color 0.15s; }
        .composer-char-select:focus { border-color: var(--gold-dim); outline: none; }

        .composer textarea { border: none; background: transparent; resize: none; padding: 0; font-size: 15px; }
        .composer textarea:focus { box-shadow: none; }
        .composer-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid var(--border); }
        .post-btn { background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 6px 20px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s; }
        .post-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .post-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}