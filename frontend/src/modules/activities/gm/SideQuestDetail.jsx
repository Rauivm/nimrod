import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

const ATTRIBUTE_LABELS = {
  str: 'FOR (Força)',
  dex: 'DES (Destreza)',
  con: 'CON (Constituição)',
  int: 'INT (Inteligência)',
  wis: 'SAB (Sabedoria)',
  cha: 'CAR (Carisma)'
};

const STATUS_LABELS = {
  WAITING: 'Aguardando',
  RUNNING: 'Em Progresso',
  FINISHED: 'Concluído',
  FAILED: 'Fracassado',
  CANCELLED: 'Cancelado'
};

export default function SideQuestDetail({ activityId, onBack, onUpdate }) {
  const [activity, setActivity] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Report view modal state
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/sidequests/${activityId}`);
      setActivity(data);
      setParticipants(data.participants || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar detalhes.');
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const handleCancel = async () => {
    if (!window.confirm('Tem certeza que deseja CANCELAR esta atividade?')) return;
    
    setActionLoading(true);
    setError('');
    try {
      const updated = await api.post(`/sidequests/${activityId}/cancel`);
      setActivity(updated);
      onUpdate && onUpdate(updated);
    } catch (err) {
      setError(err.message || 'Erro ao cancelar.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!window.confirm('Deseja ENCERRAR esta atividade agora? As recompensas serão calculadas e distribuídas com base no progresso.')) return;

    setActionLoading(true);
    setError('');
    try {
      const res = await api.post(`/sidequests/${activityId}/finish`);
      setActivity(res.activity);
      setParticipants(res.report?.participants || []);
      onUpdate && onUpdate(res.activity);
    } catch (err) {
      setError(err.message || 'Erro ao encerrar atividade.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewReport = async () => {
    setShowReport(true);
    setLoadingReport(true);
    try {
      const data = await api.get(`/sidequests/${activityId}/report`);
      setReportData(data.report);
    } catch (err) {
      setError(err.message || 'Erro ao carregar relatório.');
    } finally {
      setLoadingReport(false);
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>Carregando atividade...</div>;
  }

  if (!activity) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <p style={{ color: 'var(--crimson-bright)' }}>Atividade não encontrada.</p>
        <button onClick={onBack} className="btn-gold" style={{ marginTop: '16px', background: 'var(--gold)', padding: '8px 16px', borderRadius: 'var(--radius)' }}>Voltar</button>
      </div>
    );
  }

  const isClosed = ['FINISHED', 'FAILED', 'CANCELLED'].includes(activity.status);
  const progressPercent = Math.min(100, Math.round((Number(activity.progress) / Number(activity.goal)) * 100));

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', marginBottom: '8px', cursor: 'pointer' }}>
            ← Voltar para Painel
          </button>
          <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: '24px' }}>
            {activity.title}
          </h2>
        </div>

        {/* GM Action Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {!isClosed && (
            <>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                style={{
                  background: 'none', border: '1px solid var(--crimson)', color: 'var(--crimson-bright)',
                  padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: '13px',
                  fontFamily: 'var(--font-display)', fontWeight: 600
                }}
              >
                Cancelar Atividade
              </button>
              <button
                onClick={handleFinish}
                disabled={actionLoading}
                hidden={activity.rules?.execution_mode === 'mana'}
                style={{
                  background: 'var(--gold)', color: 'var(--bg)',
                  padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: '13px',
                  fontFamily: 'var(--font-display)', fontWeight: 700
                }}
              >
                Encerrar Atividade
              </button>
            </>
          )}

          {activity.status === 'FINISHED' && (
            <button
              onClick={handleViewReport}
              style={{
                background: 'rgba(201,168,76,0.1)', border: '1px solid var(--gold)', color: 'var(--gold-bright)',
                padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: '13px',
                fontFamily: 'var(--font-display)', fontWeight: 600
              }}
            >
              Ver Relatório Final
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          color: 'var(--crimson-bright)', background: 'rgba(125,36,36,0.1)',
          border: '1px solid rgba(166,58,52,0.3)', padding: '12px',
          borderRadius: 'var(--radius)'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Grid status & details */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
        {/* Info panel */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '20px', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold)', marginBottom: '16px', textTransform: 'uppercase' }}>
            Detalhes Gerais
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Status:</span>
              <strong style={{ color: 'var(--text)' }}>{STATUS_LABELS[activity.status] || activity.status}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>{activity.rules?.execution_mode === 'mana' ? 'Modalidade:' : 'Atributo Testado:'}</span>
              <strong>{activity.rules?.execution_mode === 'mana' ? 'Source of Mana' : ATTRIBUTE_LABELS[activity.rules?.attribute] || 'FOR'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>{activity.rules?.execution_mode === 'mana' ? 'Progressão:' : 'Fórmula:'}</span>
              <strong>{activity.rules?.execution_mode === 'mana' ? 'Independente de D&D' : activity.rules?.rewardFormula === 'proportional' ? 'Proporcional' : 'Fixa'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Período:</span>
              <span>{new Date(activity.startsAt).toLocaleString()} - {new Date(activity.endsAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Progress & Goals panel */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '20px', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--gold)', marginBottom: '16px', textTransform: 'uppercase' }}>
            Progresso & Recompensas Configuradas
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Meta:</span>
                <strong style={{ color: 'var(--gold-bright)' }}>{activity.progress} / {activity.goal} ({progressPercent}%)</strong>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-field)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                <div style={{ height: '100%', width: `${progressPercent}%`, background: 'var(--gold)', borderRadius: '4px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <span style={{ color: 'var(--text-muted)' }}>XP Máximo:</span>
              <strong>{activity.rules?.rewardParameters?.xp_max ?? 0} XP</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Gold Máximo:</span>
              <strong>{activity.rules?.rewardParameters?.gold_max ?? 0} Gold</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Participants Table */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', color: 'var(--gold)', marginBottom: '16px', textTransform: 'uppercase' }}>
          Personagens Inscritos ({participants.length})
        </h3>

        {participants.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
            Nenhum personagem inscrito até o momento.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px' }}>Personagem</th>
                  <th style={{ padding: '12px 8px' }}>Dado (d20)</th>
                  <th style={{ padding: '12px 8px' }}>Mod.</th>
                  <th style={{ padding: '12px 8px' }}>Total</th>
                  <th style={{ padding: '12px 8px' }}>Contribuição Final</th>
                  <th style={{ padding: '12px 8px' }}>Visual Current</th>
                  <th style={{ padding: '12px 8px' }}>Status</th>
                  {isClosed && <th style={{ padding: '12px 8px' }}>Recompensas</th>}
                </tr>
              </thead>
              <tbody>
                {participants.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-bright)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 600 }}>{p.characterName}</td>
                    <td style={{ padding: '12px 8px' }}>{p.dice}</td>
                    <td style={{ padding: '12px 8px' }}>+{p.modifier}</td>
                    <td style={{ padding: '12px 8px' }}>{p.total}</td>
                    <td style={{ padding: '12px 8px', color: 'var(--gold-bright)' }}>{p.contribution}</td>
                    <td style={{ padding: '12px 8px' }}>{p.contributionCurrent}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span style={{
                        fontSize: '11px', padding: '2px 6px', borderRadius: '2px',
                        background: p.status === 'COMPLETED' ? 'rgba(42,138,88,0.1)' : 'rgba(201,168,76,0.1)',
                        color: p.status === 'COMPLETED' ? 'var(--emerald-bright)' : 'var(--gold)'
                      }}>
                        {p.status}
                      </span>
                    </td>
                    {isClosed && (
                      <td style={{ padding: '12px 8px', color: 'var(--gold-bright)' }}>
                        {p.rewardData && p.rewardData.length > 0 ? (
                          p.rewardData.map(r => `${r.amount} ${r.type.toUpperCase()}`).join(', ')
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>Nenhuma</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Description card */}
      <div style={{ background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px' }}>
        <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
          Instruções de Narrativa
        </h4>
        <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
          {activity.description}
        </div>
      </div>

      {/* Report Modal */}
      {showReport && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="modal-content" style={{
            background: 'var(--bg-modal)', border: '1px solid var(--border-bright)',
            padding: '24px', borderRadius: 'var(--radius-lg)', width: '90%', maxWidth: '600px',
            maxHeight: '85vh', overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '18px' }}>
                Relatório Oficial da Atividade
              </h3>
              <button onClick={() => setShowReport(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px' }}>×</button>
            </div>

            {loadingReport ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>Carregando relatório...</div>
            ) : reportData ? (
              <div style={{ fontSize: '13px' }}>
                <pre style={{
                  background: 'var(--bg-field)', border: '1px solid var(--border)',
                  padding: '16px', borderRadius: 'var(--radius)', overflowX: 'auto',
                  fontFamily: 'var(--font-mono)', color: 'var(--text-muted)'
                }}>
                  {JSON.stringify(reportData, null, 2)}
                </pre>
              </div>
            ) : (
              <p style={{ color: 'var(--crimson-bright)' }}>Erro ao gerar relatório.</p>
            )}

            <button onClick={() => setShowReport(false)} className="btn-gold" style={{
              width: '100%', marginTop: '20px', padding: '10px', background: 'var(--gold)',
              color: 'var(--bg)', fontFamily: 'var(--font-display)', fontWeight: 700,
              borderRadius: 'var(--radius)'
            }}>
              Fechar Relatório
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
