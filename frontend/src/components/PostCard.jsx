import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Heart, Trash2, MessageSquare, CornerDownRight, ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const MAX_VISIBLE_DEPTH = 3;

function AuthorChip({ author }) {
  const name    = author?.displayName || 'Aventureiro';
  const isGM    = author?.role === 'GM';
  const initial = name[0]?.toUpperCase() ?? '?';
  return (
    <div className="post-author">
      <div className="post-avatar" style={{
        background: isGM
          ? 'linear-gradient(135deg, #8b2020, #c9a84c)'
          : 'linear-gradient(135deg, #2a3060, #4a5090)',
      }}>
        {initial}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className="post-author-name">{name}</span>
        {isGM
          ? <span className="gm-badge-sm">GM</span>
          : <span className="role-badge-sm">Jogador</span>
        }
      </div>
    </div>
  );
}

export const PostCard = memo(function PostCard({ post: initialPost, onUpdate, depth = 0 }) {
  const { user } = useAuth();
  const [localPost, setLocalPost] = useState(initialPost);
  const [liking, setLiking]             = useState(false);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [repliesOpen, setRepliesOpen]   = useState(false);
  const [replies, setReplies]           = useState([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const post = localPost;

  useEffect(() => {
    setLocalPost(initialPost);
  }, [initialPost]);

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
    try { await api.delete(`/posts/${post.id}`); onUpdate?.(); } catch (e) { alert(e.message); }
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
        .post-author { display: flex; align-items: center; gap: 9px; }
        .post-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 13px; font-weight: 700; color: #fff; flex-shrink: 0; }
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

function ReplyComposer({ parentId, onSubmit, onCancel }) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    const nextContent = content.trim();
    const tempId = `temp-reply-${Date.now()}`;
    const optimisticReply = {
      id: tempId,
      content: nextContent,
      parentId,
      likeCount: 0,
      likedByMe: false,
      replyCount: 0,
      createdAt: new Date().toISOString(),
      author: {
        id: user?.id,
        displayName: user?.displayName || user?.name || 'Aventureiro',
        role: user?.role,
      },
    };
    setLoading(true);
    setContent('');
    onSubmit?.(optimisticReply);
    try {
      const post = await api.post('/posts', { content: nextContent, parentId });
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

export function PostComposer({ onPost }) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    const nextContent = content.trim();
    const tempId = `temp-${Date.now()}`;
    const optimisticPost = {
      id: tempId,
      content: nextContent,
      parentId: null,
      entityType: null,
      entityId: null,
      likeCount: 0,
      likedByMe: false,
      replyCount: 0,
      createdAt: new Date().toISOString(),
      author: {
        id: user?.id,
        displayName: user?.displayName || user?.name || 'Aventureiro',
        role: user?.role,
      },
    };
    setLoading(true);
    setContent('');
    onPost?.(optimisticPost);
    try {
      const post = await api.post('/posts', { content: nextContent });
      onPost?.(post, tempId);
    }
    catch (e) {
      onPost?.(null, tempId, true);
      setContent(nextContent);
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="composer">
      <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="O que aconteceu na aventura?" maxLength={500} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }} rows={3} />
      <div className="composer-footer">
        <span style={{ fontSize: '12px', color: content.length > 450 ? 'var(--crimson-bright)' : 'var(--text-faint)' }}>{content.length}/500</span>
        <button onClick={submit} disabled={loading || !content.trim()} className="post-btn">Postar</button>
      </div>
      <style>{`
        .composer { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
        .composer textarea { border: none; background: transparent; resize: none; padding: 0; font-size: 15px; }
        .composer textarea:focus { box-shadow: none; }
        .composer-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
        .post-btn { background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 6px 20px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s; }
        .post-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .post-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
