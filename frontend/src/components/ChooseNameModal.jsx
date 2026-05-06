import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Feather } from 'lucide-react';

/**
 * ChooseNameModal
 *
 * Shown once after first login when user.displayName is null.
 * Does NOT block routes — renders on top of the app.
 *
 * Empty submission is valid: backend assigns a random fallback name.
 * No reload required — AuthContext.refresh() updates the user in place.
 */
export default function ChooseNameModal() {
  const { refresh } = useAuth();
  const [value, setValue]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      // Backend accepts empty string → assigns random fallback name
      await api.patch('/me/display-name', { displayName: value.trim() });
      await refresh();
      // After refresh, user.displayName will be set → this modal unmounts
    } catch (err) {
      setError(err.message || 'Erro ao salvar nome.');
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !loading) submit();
  };

  return (
    <div className="cn-overlay">
      <div className="cn-modal animate-in">
        <div className="cn-icon"><Feather size={28} strokeWidth={1.5} /></div>

        <h2 className="cn-title">Como quer ser chamado?</h2>
        <p className="cn-hint">
          Este será seu nome na taverna. Pode alterar depois.
          <br />Deixe em branco para receber um nome surpresa.
        </p>

        <input
          autoFocus
          className="cn-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          maxLength={40}
          placeholder="Seu nome de aventureiro..."
          disabled={loading}
        />

        {error && <p className="cn-error">{error}</p>}

        <button className="cn-btn" onClick={submit} disabled={loading}>
          {loading ? 'Salvando...' : 'Entrar na Taverna'}
        </button>
      </div>

      <style>{`
        .cn-overlay {
          position: fixed; inset: 0; z-index: 800;
          background: rgba(5,4,2,0.94);
          backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .cn-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-bright);
          border-radius: var(--radius-lg);
          padding: 36px 32px;
          max-width: 400px; width: 100%;
          box-shadow: var(--shadow-lg);
          display: flex; flex-direction: column;
          align-items: center; gap: 14px;
          text-align: center;
        }
        .cn-icon { color: var(--gold); opacity: 0.8; }
        .cn-title {
          font-family: var(--font-display);
          font-size: 18px; font-weight: 700;
          color: var(--gold); letter-spacing: 2px; text-transform: uppercase;
        }
        .cn-hint { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
        .cn-input {
          width: 100%; font-size: 16px;
          text-align: center;
          background: var(--bg-card);
          border: 1px solid var(--border-bright);
          border-radius: var(--radius);
          padding: 10px 14px;
          color: var(--text);
        }
        .cn-input:focus { border-color: var(--gold-dim); outline: none; }
        .cn-error { font-size: 12px; color: var(--crimson-bright); }
        .cn-btn {
          width: 100%;
          background: linear-gradient(135deg, var(--crimson) 0%, #5a1010 100%);
          color: #f0d8d8;
          font-family: var(--font-display);
          font-size: 13px; font-weight: 600;
          letter-spacing: 1.5px; text-transform: uppercase;
          padding: 12px;
          border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.4);
          transition: all 0.2s;
          margin-top: 4px;
        }
        .cn-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, var(--crimson-bright) 0%, #7a1818 100%);
          transform: translateY(-1px);
        }
        .cn-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      `}</style>
    </div>
  );
}
