import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SideQuestCard from './SideQuestCard.jsx';

const STATUS_FILTERS = [
  { label: 'Ativas', value: 'WAITING,RUNNING' },
  { label: 'Encerradas', value: 'FINISHED,FAILED,CANCELLED' },
  { label: 'Todas', value: '' }
];

export default function SideQuestList() {
  const [activities, setActivities] = useState([]);
  const [myCharacterIds, setMyCharacterIds] = useState([]);
  const [filter, setFilter] = useState(STATUS_FILTERS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch activities with status filter
      let url = '/sidequests';
      if (filter.value) {
        url += `?status=${filter.value}`;
      }
      const data = await api.get(url);
      setActivities(data);

      // 2. Fetch my characters to match joined status
      const chars = await api.get('/me/characters').catch(() => []);
      setMyCharacterIds(chars.map(c => c.id));
    } catch (err) {
      setError('Erro ao carregar atividades.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filter]);

  return (
    <div className="sidequest-list-container">
      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
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

      {error && (
        <div style={{
          color: 'var(--crimson-bright)', background: 'rgba(125,36,36,0.1)',
          border: '1px solid rgba(166,58,52,0.3)', padding: '12px',
          borderRadius: 'var(--radius)', marginBottom: '20px'
        }}>
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '20px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: '200px', borderRadius: 'var(--radius-lg)' }} />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '64px 24px', color: 'var(--text-muted)',
          border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
          fontStyle: 'italic', background: 'var(--bg-card)'
        }}>
          Nenhuma atividade encontrada para esta categoria.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '24px' }}>
          {activities.map(act => (
            <SideQuestCard
              key={act.id}
              activity={act}
              myCharacterIds={myCharacterIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}
