import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Flower, Plus, Trash2, X } from 'lucide-react';

function getTributeIcon(count) {
  if (count <= 0) return { icon: '🪦', label: 'Sem tributos' };
  if (count < 5) return { icon: '🌹'.repeat(Math.min(count, 4)), label: `${count} rosa${count > 1 ? 's' : ''}` };
  if (count < 10) return { icon: '💐', label: 'Buquê' };
  if (count < 20) return { icon: '👑', label: 'Coroa' };
  if (count < 30) return { icon: '👑👑', label: 'Duas Coroas' };
  return { icon: '👑👑👑', label: 'Três Coroas' };
}

function CharacterCard({ char, onUpdate }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const tribute = getTributeIcon(char.tribute_count);

  const payTribute = async () => {
    setLoading(true);
    try {
      await api.post(`/cemetery/${char.id}/tribute`, {});
      onUpdate?.();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const del = async () => {
    if (!confirm(`Remover ${char.name} do cemitério?`)) return;
    try {
      await api.delete(`/cemetery/${char.id}`);
      onUpdate?.();
    } catch (e) { alert(e.message); }
  };

  const canDelete = char.owner_id === user?.id || user?.role === 'GM';

  return (
    <div className="char-card animate-in">
      <div className="char-tribute-display" title={tribute.label}>
        {tribute.icon}
      </div>
      <div className="char-info">
        <h3 className="char-name">{char.name}</h3>
        {char.owner_name && (
          <span className="char-owner">por {char.owner_name}</span>
        )}
        {char.description && (
          <p className="char-desc">{char.description}</p>
        )}
        <div className="char-meta">
          <span className="tribute-count">
            <Flower size={11} /> {char.tribute_count} tributo{char.tribute_count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="char-actions">
        <button
          onClick={payTribute}
          disabled={loading}
          className={`tribute-btn ${char.tributed_by_me ? 'tributed' : ''}`}
          title={char.tributed_by_me ? 'Remover tributo' : 'Prestar tributo'}
        >
          {char.tributed_by_me ? '🥀' : '🌹'}
        </button>
        {canDelete && (
          <button onClick={del} className="char-delete-btn">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <style>{`
        .char-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 16px;
          display: flex; gap: 16px; align-items: flex-start;
          transition: border-color 0.15s;
        }
        .char-card:hover { border-color: var(--border-bright); }
        .char-tribute-display { font-size: 28px; flex-shrink: 0; min-width: 50px; text-align: center; line-height: 1.2; }
        .char-info { flex: 1; }
        .char-name { font-family: var(--font-display); font-size: 16px; color: var(--text); margin-bottom: 2px; }
        .char-owner { font-size: 12px; color: var(--text-muted); font-style: italic; }
        .char-desc { font-size: 14px; color: var(--text-muted); margin-top: 6px; line-height: 1.5; }
        .char-meta { margin-top: 8px; }
        .tribute-count { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-faint); }
        .char-actions { display: flex; flex-direction: column; gap: 6px; align-items: center; }
        .tribute-btn {
          font-size: 22px; background: none; border: 1px solid var(--border);
          border-radius: var(--radius); padding: 6px 8px;
          transition: all 0.15s; line-height: 1;
        }
        .tribute-btn:hover:not(:disabled) { border-color: var(--crimson-bright); transform: scale(1.1); }
        .tribute-btn.tributed { border-color: var(--crimson); background: rgba(139,32,32,0.1); }
        .tribute-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .char-delete-btn { background: none; border: none; color: var(--text-faint); padding: 4px; transition: color 0.15s; }
        .char-delete-btn:hover { color: var(--crimson-bright); }
      `}</style>
    </div>
  );
}

function CreateCharModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/cemetery', form);
      onCreated?.();
      onClose?.();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in">
        <div className="modal-header">
          <h2>🪦 Adicionar ao Cemitério</h2>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group">
            <label>Nome do Personagem *</label>
            <input value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} required placeholder="Ex: Thorin Pedraescura" />
          </div>
          <div className="form-group">
            <label>Epitáfio</label>
            <textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} placeholder="Como o herói caiu..." rows={3} />
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adicionando...' : 'Adicionar ao Cemitério'}
          </button>
        </form>
      </div>

      <style>{`
        .modal-overlay {
          position: fixed; inset: 0; z-index: 200;
          background: rgba(0,0,0,0.8); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .modal {
          background: var(--bg-elevated); border: 1px solid var(--border-bright);
          border-radius: var(--radius-lg); padding: 24px;
          width: 100%; max-width: 440px;
          box-shadow: var(--shadow-lg);
        }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .modal-header h2 { font-family: var(--font-display); font-size: 16px; color: var(--gold); letter-spacing: 1px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
        .submit-btn {
          background: var(--crimson); color: #f0d0d0;
          font-family: var(--font-display); font-size: 12px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          padding: 10px; border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.3);
          margin-top: 4px; transition: all 0.15s;
        }
        .submit-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .submit-btn:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}

export default function CemeteryPage() {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.get('/cemetery').catch(() => []);
    setCharacters(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="cemetery-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">🪦 Cemitério</h1>
          <p className="page-subtitle">Em memória dos heróis caídos</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="create-btn">
          <Plus size={13} /> Adicionar
        </button>
      </div>

      <div className="tribute-legend">
        <span>🌹 1–4 rosas</span>
        <span>💐 5 buquê</span>
        <span>👑 10 coroa</span>
        <span style={{ color: 'var(--text-faint)', fontSize: '12px' }}>Tributos decaem após 5 dias de inatividade</span>
      </div>

      <div className="chars-list">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '90px' }} />)
        ) : characters.length === 0 ? (
          <div className="empty-state">
            <span>🕊️ Nenhum herói aqui... por enquanto.</span>
          </div>
        ) : (
          characters.map(c => <CharacterCard key={c.id} char={c} onUpdate={load} />)
        )}
      </div>

      {showCreate && <CreateCharModal onClose={() => setShowCreate(false)} onCreated={load} />}

      <style>{`
        .cemetery-page { max-width: 700px; margin: 0 auto; }
        .page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
        .page-title { font-family: var(--font-display); font-size: 20px; color: var(--gold); letter-spacing: 3px; text-transform: uppercase; }
        .page-subtitle { font-size: 13px; color: var(--text-muted); font-style: italic; margin-top: 4px; }
        .tribute-legend {
          display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
          padding: 10px 14px; margin-bottom: 20px;
          background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
          font-size: 13px; color: var(--text-muted);
        }
        .chars-list { display: flex; flex-direction: column; gap: 10px; }
        .create-btn {
          display: flex; align-items: center; gap: 5px;
          background: var(--crimson); color: #f0d0d0;
          font-family: var(--font-display); font-size: 11px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          padding: 7px 14px; border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.3);
          transition: all 0.15s;
        }
        .create-btn:hover { background: var(--crimson-bright); }
        .empty-state {
          text-align: center; padding: 48px; color: var(--text-muted);
          border: 1px dashed var(--border); border-radius: var(--radius-lg);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
