import { useState } from 'react';
import { api } from '../../../lib/api.js';
import JoinModal from './JoinModal.jsx';
import { Gamepad2 } from 'lucide-react';

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

export default function SideQuestCard({ activity: initialActivity, myCharacterIds = [] }) {
  const [activity, setActivity] = useState(initialActivity);
  const [participants, setParticipants] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);
  const isMana = activity.rules?.execution_mode === 'mana';

  const launchGame = async (characterId) => {
    // Reserve the tab during the click so mobile browsers do not block it after the request.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setLaunching(true);
    setError('');
    try {
      const result = await api.post(`/sidequests/${activity.id}/launch`, { character_id: characterId });
      if (tab) tab.location.replace(result.url);
      else window.location.assign(result.url);
    } catch (err) {
      tab?.close();
      setError(err.message || 'Não foi possível entrar no jogo.');
    } finally { setLaunching(false); }
  };

  const fetchDetails = async () => {
    setLoadingDetails(true);
    setError('');
    try {
      const data = await api.get(`/sidequests/${activity.id}`);
      setActivity(data);
      setParticipants(data.participants || []);
    } catch (err) {
      setError('Erro ao carregar detalhes.');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleToggleExpand = () => {
    if (!expanded) {
      fetchDetails();
    }
    setExpanded(!expanded);
  };

  const handleJoined = () => {
    fetchDetails();
  };

  // Find if any of the current user's characters is in the participants list
  const joinedParticipant = participants.find(p => myCharacterIds.includes(p.characterId));

  const isClosed = ['FINISHED', 'FAILED', 'CANCELLED'].includes(activity.status);
  const availableNow = !isClosed && Date.now() >= Date.parse(activity.startsAt) && Date.now() < Date.parse(activity.endsAt);
  const progressPercent = Math.min(100, Math.round((Number(activity.progress) / Number(activity.goal)) * 100));

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className={`sidequest-card animate-in ${expanded ? 'expanded' : ''}`} style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px',
      transition: 'all 0.2s ease',
      boxShadow: 'var(--shadow)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <div>
          <span style={{
            fontSize: '10px',
            fontFamily: 'var(--font-display)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: 'var(--gold)',
            background: 'rgba(201,168,76,0.1)',
            padding: '2px 8px',
            borderRadius: '2px',
            marginRight: '8px',
            display: 'inline-flex', whiteSpace: 'nowrap'
          }}>
            {isMana ? 'Source of Mana' : ATTRIBUTE_LABELS[activity.rules?.attribute] || 'FOR'}
          </span>
          <span style={{
            fontSize: '10px',
            fontFamily: 'var(--font-display)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: isClosed ? 'var(--text-muted)' : 'var(--emerald-bright)',
            background: isClosed ? 'rgba(138,125,98,0.1)' : 'rgba(42,138,88,0.1)',
            padding: '2px 8px',
            borderRadius: '2px'
          }}>
            {isMana && availableNow ? 'Disponível' : STATUS_LABELS[activity.status] || activity.status}
          </span>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          ⏱ {formatDate(activity.startsAt)} - {formatDate(activity.endsAt)}
        </div>
      </div>

      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--text)', marginBottom: '8px' }}>
        {activity.title}
      </h3>

      <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px', WebkitLineClamp: expanded ? 'none' : '2', display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {activity.description}
      </p>

      {/* Progress Bar */}
      {!isMana && <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
          <span style={{ color: 'var(--text-muted)' }}>Progresso da Meta</span>
          <span style={{ color: 'var(--gold-bright)', fontWeight: 600 }}>{activity.progress} / {activity.goal} ({progressPercent}%)</span>
        </div>
        <div style={{ height: '8px', background: 'var(--bg-field)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: 'linear-gradient(90deg, var(--gold-dim), var(--gold-bright))',
            borderRadius: '4px',
            transition: 'width 0.4s ease'
          }} />
        </div>
      </div>

      }
      {/* Footer Info Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          👥 {activity.participantCount ?? participants.length} {activity.maxParticipants > 0 ? `/ ${activity.maxParticipants}` : ''} participantes
        </span>

        <button onClick={handleToggleExpand} style={{
          background: 'none', border: 'none', color: 'var(--gold)',
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '12px',
          textTransform: 'uppercase', letterSpacing: '0.5px'
        }}>
          {expanded ? '▲ Fechar Detalhes' : '▼ Ver Detalhes'}
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="animate-in" style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
          {loadingDetails ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '12px' }}>Carregando detalhes...</div>
          ) : error ? (
            <div style={{ color: 'var(--crimson-bright)', fontSize: '13px' }}>{error}</div>
          ) : (
            <div>
              {/* Joined Character summary if exists */}
              {joinedParticipant && (
                <div style={{
                  background: 'rgba(201,168,76,0.05)', border: '1px solid var(--gold-dim)',
                  padding: '12px', borderRadius: 'var(--radius)', marginBottom: '16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Seu Personagem Inscrito</div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{joinedParticipant.characterName}</div>
                  </div>
                  {!isMana && <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Contribuição</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--gold-bright)' }}>
                      {joinedParticipant.contributionCurrent} / {joinedParticipant.contribution}
                    </div>
                  </div>}
                </div>
              )}

              {/* Participants List */}
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Participantes
              </h4>
              {participants.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-faint)', fontStyle: 'italic', marginBottom: '16px' }}>Nenhum participante ainda.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', maxHeight: '180px', overflowY: 'auto' }}>
                  {participants.map(p => (
                    <div key={p.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'var(--bg-elevated)', padding: '8px 12px', borderRadius: 'var(--radius)',
                      fontSize: '13px'
                    }}>
                      <span>{p.characterName}</span>
                      <span style={{ color: 'var(--gold)' }}>
                        {isMana ? p.status === 'JOINED' ? 'Inscrito' : p.status : `Roll: ${p.total} (d20:${p.dice} + mod:${p.modifier}) | Contribuição: ${p.contributionCurrent}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              {isMana && availableNow && participants.filter(p => myCharacterIds.includes(p.characterId) && p.status === 'JOINED').map(p => (
                <button key={p.id} className="mana-launch" disabled={launching}
                  onClick={() => launchGame(p.characterId)} style={{ width: '100%', marginTop: '10px' }}>
                  <Gamepad2 size={16} /> <span>{launching ? 'Conectando...' : `Jogar com ${p.characterName}`}</span>
                </button>
              ))}
              {!isClosed && !joinedParticipant && (
                <button
                  onClick={() => setShowJoinModal(true)}
                  style={{
                    width: '100%', padding: '10px', background: 'var(--gold)', color: 'var(--bg)',
                    fontFamily: 'var(--font-display)', fontWeight: 700, borderRadius: 'var(--radius)',
                    letterSpacing: '1px', textTransform: 'uppercase', fontSize: '13px', marginTop: '10px'
                  }}
                >
                  Inscrever Personagem
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showJoinModal && (
        <JoinModal
          activity={activity}
          onClose={() => setShowJoinModal(false)}
          onJoined={handleJoined}
        />
      )}
    </div>
  );
}
