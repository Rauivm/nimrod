import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Shield } from 'lucide-react';

/**
 * LgpdConsentModal
 *
 * Blocks the entire app until the user explicitly accepts the data privacy
 * terms. Rendered in App.jsx before any other route content.
 *
 * On acceptance:
 *   POST /api/me/consent  → { consent: true }
 *   AuthContext.refresh() to update req.user.lgpdConsent
 */
export default function LgpdConsentModal() {
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const accept = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/me/consent', { consent: true });
      await refresh();
    } catch (err) {
      setError(err.message || 'Erro ao registrar consentimento.');
      setLoading(false);
    }
  };

  return (
    <div className="lgpd-overlay">
      <div className="lgpd-modal animate-in">
        <div className="lgpd-icon">
          <Shield size={32} strokeWidth={1.5} />
        </div>

        <h2 className="lgpd-title">Privacidade de Dados</h2>

        <p className="lgpd-body">
          Para continuar usando o <strong>Nimrod</strong>, precisamos do seu
          consentimento para armazenar seus dados de identificação (e-mail e
          nome) conforme a&nbsp;
          <strong>Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)</strong>.
        </p>

        <ul className="lgpd-list">
          <li>Seu e-mail é usado apenas para autenticação.</li>
          <li>Seu nome de exibição pode ser editado a qualquer momento.</li>
          <li>Não compartilhamos seus dados com terceiros.</li>
        </ul>

        {error && <p className="lgpd-error">{error}</p>}

        <button
          className="lgpd-accept-btn"
          onClick={async () => {
            localStorage.setItem('lgpd_seen', 'true');

            try {
              await accept();
            } finally {
              window.location.reload();
            }
          }}
          disabled={loading}
        >
          {loading ? 'Aguarde...' : 'Aceitar e Continuar'}
        </button>

      <style>{`
        .lgpd-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(5, 4, 2, 0.96);
          backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }

        .lgpd-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-bright);
          border-radius: var(--radius-lg);
          padding: 36px 32px;
          max-width: 480px; width: 100%;
          box-shadow: var(--shadow-lg);
          display: flex; flex-direction: column; align-items: center;
          gap: 16px; text-align: center;
        }

        .lgpd-icon {
          color: var(--gold);
          opacity: 0.8;
        }

        .lgpd-title {
          font-family: var(--font-display);
          font-size: 20px; font-weight: 700;
          color: var(--gold); letter-spacing: 2px;
          text-transform: uppercase;
        }

        .lgpd-body {
          font-size: 14px; color: var(--text-muted); line-height: 1.7;
          text-align: left;
        }

        .lgpd-list {
          font-size: 13px; color: var(--text-muted);
          text-align: left; padding-left: 18px;
          display: flex; flex-direction: column; gap: 6px;
          align-self: stretch;
        }

        .lgpd-list li::marker { color: var(--gold-dim); }

        .lgpd-error {
          font-size: 13px; color: var(--crimson-bright);
        }

        .lgpd-accept-btn {
          margin-top: 8px;
          background: linear-gradient(135deg, var(--crimson) 0%, #5a1010 100%);
          color: #f0d8d8;
          font-family: var(--font-display);
          font-size: 13px; font-weight: 600;
          letter-spacing: 1.5px; text-transform: uppercase;
          padding: 12px 32px;
          border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.4);
          box-shadow: 0 2px 12px rgba(139,32,32,0.3);
          transition: all 0.2s;
        }

        .lgpd-accept-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, var(--crimson-bright) 0%, #7a1818 100%);
          box-shadow: 0 4px 20px rgba(139,32,32,0.5);
          transform: translateY(-1px);
        }

        .lgpd-accept-btn:disabled {
          opacity: 0.5; cursor: not-allowed; transform: none;
        }
      `}</style>
    </div>
  );
}
