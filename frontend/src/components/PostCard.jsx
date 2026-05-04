import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Heart, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export function PostCard({ post, onUpdate }) {
  const { user } = useAuth();
  const [liking, setLiking] = useState(false);

  const like = async () => {
    setLiking(true);
    try {
      await api.post(`/posts/${post.id}/like`, {});
      onUpdate?.();
    } catch {}
    setLiking(false);
  };

  const del = async () => {
    if (!confirm('Apagar este post?')) return;
    try {
      await api.delete(`/posts/${post.id}`);
      onUpdate?.();
    } catch (e) { alert(e.message); }
  };

  const isOwn = user?.id === post.author_id;

  return (
    <article className="post-card animate-in">
      <div className="post-author">
        <div className="post-avatar">{post.author_name?.[0]?.toUpperCase()}</div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="post-author-name">{post.author_name}</span>
            {post.author_role === 'GM' && <span className="gm-badge-sm">GM</span>}
          </div>
          <span className="post-time">
            {formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: ptBR })}
          </span>
        </div>
      </div>

      <p className="post-content">{post.content}</p>

      <div className="post-actions">
        <button onClick={like} disabled={liking} className={`like-btn ${post.liked_by_me ? 'liked' : ''}`}>
          <Heart size={14} fill={post.liked_by_me ? 'currentColor' : 'none'} />
          <span>{post.like_count || 0}</span>
        </button>
        {isOwn && (
          <button onClick={del} className="delete-btn">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <style>{`
        .post-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 16px;
          transition: border-color 0.15s;
        }
        .post-card:hover { border-color: var(--border-bright); }
        .post-author { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .post-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, var(--crimson), var(--gold-dim));
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-display); font-size: 14px; font-weight: 700;
          color: var(--text); flex-shrink: 0;
        }
        .post-author-name { font-weight: 600; font-size: 14px; color: var(--text); }
        .post-time { font-size: 12px; color: var(--text-muted); }
        .gm-badge-sm {
          font-family: var(--font-display); font-size: 9px; font-weight: 700;
          color: var(--gold); letter-spacing: 1px;
          padding: 1px 4px; background: rgba(201,168,76,0.1);
          border: 1px solid var(--gold-dim); border-radius: 2px;
        }
        .post-content { font-size: 15px; line-height: 1.65; color: var(--text); white-space: pre-wrap; word-break: break-word; }
        .post-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
        .like-btn {
          display: flex; align-items: center; gap: 5px;
          background: none; border: 1px solid var(--border);
          color: var(--text-muted); border-radius: var(--radius);
          padding: 4px 10px; font-size: 13px;
          transition: all 0.15s;
        }
        .like-btn:hover { border-color: #a02020; color: #c04040; }
        .like-btn.liked { color: #c04040; border-color: #5a1515; background: rgba(139,32,32,0.1); }
        .delete-btn {
          background: none; border: none; color: var(--text-faint);
          padding: 4px; border-radius: var(--radius);
          transition: color 0.15s;
        }
        .delete-btn:hover { color: var(--crimson-bright); }
      `}</style>
    </article>
  );
}

export function PostComposer({ onPost }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      await api.post('/posts', { content: content.trim() });
      setContent('');
      onPost?.();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="composer">
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="O que aconteceu na aventura?"
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
        .composer {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 16px;
        }
        .composer textarea { border: none; background: transparent; resize: none; padding: 0; font-size: 15px; }
        .composer textarea:focus { box-shadow: none; }
        .composer-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
        .post-btn {
          background: var(--crimson);
          color: #f0d0d0;
          font-family: var(--font-display);
          font-size: 12px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          padding: 6px 20px; border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.3);
          transition: all 0.15s;
        }
        .post-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .post-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
