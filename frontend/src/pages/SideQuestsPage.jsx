import { useState } from 'react';
import { useRole } from '../contexts/AuthContext.jsx';
import SideQuestList from '../modules/activities/player/SideQuestList.jsx';
import SideQuestDashboard from '../modules/activities/gm/SideQuestDashboard.jsx';

export default function SideQuestsPage() {
  const { isGM } = useRole();
  const [viewMode, setViewMode] = useState(isGM ? 'gm' : 'player');

  return (
    <div className="sidequests-page animate-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '24px', letterSpacing: '2px', textTransform: 'uppercase' }}>
          {viewMode === 'gm' ? 'Painel de Atividades (Mestre)' : 'Side Quests disponíveis'}
        </h1>
        
        {isGM && (
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-elevated)', padding: '4px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setViewMode('player')}
              style={{
                padding: '6px 12px',
                borderRadius: '2px',
                fontSize: '11px',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                letterSpacing: '0.5px',
                background: viewMode === 'player' ? 'rgba(201,168,76,0.15)' : 'none',
                color: viewMode === 'player' ? 'var(--gold-bright)' : 'var(--text-muted)'
              }}
            >
              Ver como Jogador
            </button>
            <button
              onClick={() => setViewMode('gm')}
              style={{
                padding: '6px 12px',
                borderRadius: '2px',
                fontSize: '11px',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                letterSpacing: '0.5px',
                background: viewMode === 'gm' ? 'rgba(201,168,76,0.15)' : 'none',
                color: viewMode === 'gm' ? 'var(--gold-bright)' : 'var(--text-muted)'
              }}
            >
              Painel do Mestre
            </button>
          </div>
        )}
      </div>

      {viewMode === 'gm' ? <SideQuestDashboard /> : <SideQuestList />}
    </div>
  );
}
