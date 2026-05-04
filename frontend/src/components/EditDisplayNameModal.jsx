import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

/**
 * EditDisplayNameModal
 *
 * Inline modal to update the user's display name.
 * On success: patches AuthContext user so the header updates immediately.
 *
 * Props:
 *   onClose: () => void
 */
export default function EditDisplayNameModal({ onClose }) {
  const { user, setUser } = useAuth();
  const [value, setValue]   = useState(user?.displayName ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed) { setError('Nome não pode ser vazio.'); return; }
    if (trimmed.length > 40) { setError('Máximo 40 caracteres.'); return; }

    setLoading(true);
    setError(null);
    try {
      const updated = await api.patch('/me', { displayName: trimmed });
      setUser(prev => ({ ...prev, ...updated }));
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao salvar.');
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="ednm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ednm-modal animate-in">
        <div className="ednm-header">
          <span className="ednm-title">Editar Nome</span>
          <button onClick={onClose} className="ednm-close"><X size={16} /></button>
        </div>

        <div className="ednm-body">
          <label className="ednm-label">Nome de exibição</label>
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKey}
            maxLength={40}
            placeholder="Seu apelido na taverna"
            className="ednm-input"
          />
          <span className="ednm-counter">{value.length}/40</span>
          {error && <p className="ednm-error">{error}</p>}
        </div>

        <div className="ednm-footer">
          <button onClick={onClose} className="ednm-btn-cancel">Cancelar</button>
          <button onClick={save} disabled={loading} className="ednm-btn-save">
            <Check size={14} />
            {loading ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      <style>{`
        .ednm-overlay {
          position: fixed; inset: 0; z-index: 500;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .ednm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-bright);
          border-radius: var(--radius-lg);
          padding: 20px;
          width: 100%; max-width: 360px;
          box-shadow: var(--shadow-lg);
          display: flex; flex-direction: column; gap: 16px;
        }
        .ednm-header {
          display: flex; justify-content: space-between; align-items: center;
        }
        .ednm-title {
          font-family: var(--font-display);
          font-size: 14px; font-weight: 700;
          color: var(--gold); letter-spacing: 1.5px; text-transform: uppercase;
        }
        .ednm-close {
          background: none; color: var(--text-muted);
          padding: 2px;
        }
        .ednm-close:hover { color: var(--text); }

        .ednm-body { display: flex; flex-direction: column; gap: 6px; }
        .ednm-label {
          font-size: 11px; text-transform: uppercase;
          letter-spacing: 0.5px; color: var(--text-muted);
        }
        .ednm-input { font-size: 15px; }
        .ednm-counter {
          font-size: 11px; color: var(--text-faint);
          text-align: right;
        }
        .ednm-error { font-size: 12px; color: var(--crimson-bright); }

        .ednm-footer { display: flex; gap: 8px; justify-content: flex-end; }

        .ednm-btn-cancel {
          background: var(--bg-card);
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-size: 13px; padding: 7px 16px;
          border-radius: var(--radius);
        }
        .ednm-btn-cancel:hover { color: var(--text); border-color: var(--border-bright); }

        .ednm-btn-save {
          display: flex; align-items: center; gap: 6px;
          background: var(--crimson); color: #f0d0d0;
          font-family: var(--font-display);
          font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
          padding: 7px 16px; border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.3);
          transition: all 0.15s;
        }
        .ednm-btn-save:hover:not(:disabled) { background: var(--crimson-bright); }
        .ednm-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
