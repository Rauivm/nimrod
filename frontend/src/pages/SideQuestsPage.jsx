import { Button, PageHeader } from '../components/ui.jsx';
import { useState } from 'react';
import { useRole } from '../contexts/AuthContext.jsx';
import SideQuestList from '../modules/activities/player/SideQuestList.jsx';
import SideQuestDashboard from '../modules/activities/gm/SideQuestDashboard.jsx';

export default function SideQuestsPage() {
  const { isGM } = useRole();
  const [viewMode, setViewMode] = useState(isGM ? 'gm' : 'player');

  return (
    <div className="sidequests-page animate-in">
      <PageHeader eyebrow="Aventuras entre encontros" title="Side Quests" description="Acompanhe atividades e o progresso dos seus personagens entre as sessões." action={isGM && <div className="ui-tabs" role="group" aria-label="Visão das atividades"><Button aria-pressed={viewMode === 'player'} onClick={() => setViewMode('player')}>Ver como jogador</Button><Button aria-pressed={viewMode === 'gm'} onClick={() => setViewMode('gm')}>Painel do mestre</Button></div>} />

      {viewMode === 'gm' ? <SideQuestDashboard /> : <SideQuestList />}
    </div>
  );
}
