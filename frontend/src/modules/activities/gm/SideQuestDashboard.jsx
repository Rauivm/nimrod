import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SideQuestForm from './SideQuestForm.jsx';
import SideQuestDetail from './SideQuestDetail.jsx';

const STATUS_FILTERS = [
  { label: 'Ativas', value: 'WAITING,RUNNING' },
  { label: 'Encerradas', value: 'FINISHED,FAILED' },
  { label: 'Canceladas', value: 'CANCELLED' },
  { label: 'Todas', value: '' }
];

export default function SideQuestDashboard() {
  const [activities, setActivities] = useState([]);
  const [filter, setFilter] = useState(STATUS_FILTERS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Navigation states
  const [activeView, setActiveView] = useState('list'); // 'list' | 'create' | 'detail'
  const [selectedActivityId, setSelectedActivityId] = useState(null);

  const loadActivities = async () => {
    setLoading(true);
    setError('');
    try {
      let url = '/sidequests';
      if (filter.value) {
        url += `?status=${filter.value}`;
      }
      const data = await api.get(url);
      setActivities(data);
    } catch (err) {
      setError('Erro ao carregar atividades.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeView === 'list') {
      loadActivities();
    }
  }, [filter, activeView]);

  const handleCreated = () => {
    setActiveView('list');
  };

  const handleRowClick = (id) => {
    setSelectedActivityId(id);
    setActiveView('detail');
  };

  if (activeView === 'create') {
    return <SideQuestForm onCreated={handleCreated} onCancel={() => setActiveView('list')} />;
  }

  if (activeView === 'detail') {
    return (
      <SideQuestDetail
        activityId={selectedActivityId}
        onBack={() => setActiveView('list')}
        onUpdate={() => {}}
      />
    );
  }

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Filters & Action button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f)}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius)',
                background: filter.value === f.value ? 'rgba(201,168,76,0.1)' : 'var(--bg-card)',
                color: filter.value === f.value ? 'var(--gold)' : 'var(--text-muted)',
                fontSize: '13px',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                border: filter.value === f.value ? '1px solid var(--gold-dim)' : '1px solid var(--border)'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setActiveView('create')}
          style={{
            background: 'var(--gold)', color: 'var(--bg)', padding: '10px 20px',
            borderRadius: 'var(--radius)', fontSize: '13px', fontFamily: 'var(--font-display)',
            fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase'
          }}
        >
          + Nova Atividade
        </button>
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

      {/* Grid or Table listing */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: '60px', borderRadius: 'var(--radius)' }} />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)',
          border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
          fontStyle: 'italic', background: 'var(--bg-card)'
        }}>
          Nenhuma atividade criada ou cadastrada nesta categoria.
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', background: 'var(--bg-soft)' }}>
                  <th style={{ padding: '14px 16px' }}>Título</th>
                  <th style={{ padding: '14px 16px' }}>Atributo</th>
                  <th style={{ padding: '14px 16px' }}>Meta</th>
                  <th style={{ padding: '14px 16px' }}>Participantes</th>
                  <th style={{ padding: '14px 16px' }}>Início</th>
                  <th style={{ padding: '14px 16px' }}>Fim</th>
                  <th style={{ padding: '14px 16px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {activities.map(act => (
                  <tr
                    key={act.id}
                    onClick={() => handleRowClick(act.id)}
                    style={{
                      borderBottom: '1px solid var(--border-bright)',
                      cursor: 'pointer',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                  >
                    <td style={{ padding: '14px 16px', fontWeight: 600 }}>{act.title}</td>
                    <td style={{ padding: '14px 16px', textTransform: 'uppercase' }}>{act.rules?.attribute}</td>
                    <td style={{ padding: '14px 16px' }}>{act.progress} / {act.goal}</td>
                    <td style={{ padding: '14px 16px' }}>{act.participantCount ?? 0}</td>
                    <td style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(act.startsAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(act.endsAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        fontSize: '11px', padding: '2px 8px', borderRadius: '2px',
                        background: act.status === 'FINISHED' ? 'rgba(42,138,88,0.1)' : 'rgba(201,168,76,0.1)',
                        color: act.status === 'FINISHED' ? 'var(--emerald-bright)' : 'var(--gold)'
                      }}>
                        {act.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
