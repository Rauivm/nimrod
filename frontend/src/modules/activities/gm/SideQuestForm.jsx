import { useState } from 'react';
import { api } from '../../../lib/api.js';

export default function SideQuestForm({ onCreated, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [goal, setGoal] = useState(50);
  const [maxParticipants, setMaxParticipants] = useState(0);
  const [executionMode, setExecutionMode] = useState('dice');

  // Rules and formulas fields
  const [attribute, setAttribute] = useState('str');
  const [rewardFormula, setRewardFormula] = useState('proportional');
  const [xpMax, setXpMax] = useState(100);
  const [goldMax, setGoldMax] = useState(25);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Construct request body
    const body = {
      title,
      description,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      goal: Number(goal),
      max_participants: Number(maxParticipants),
      activity_type: 'SIDE_QUEST',
      rules: executionMode === 'mana' ? { execution_mode: 'mana' } : {
        attribute,
        rewardFormula,
        rewardParameters: {
          xp_max: Number(xpMax),
          gold_max: Number(goldMax)
        }
      }
    };

    try {
      const res = await api.post('/sidequests', body);
      onCreated(res);
    } catch (err) {
      setError(err.message || 'Erro ao criar atividade.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="animate-in" style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      padding: '24px', borderRadius: 'var(--radius-lg)', maxWidth: '600px',
      margin: '0 auto', boxShadow: 'var(--shadow-lg)'
    }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', marginBottom: '20px', fontSize: '20px' }}>
        Nova Side Quest / Atividade
      </h3>

      {error && (
        <div style={{
          color: 'var(--crimson-bright)', background: 'rgba(125,36,36,0.1)',
          border: '1px solid rgba(166,58,52,0.3)', padding: '12px',
          borderRadius: 'var(--radius)', marginBottom: '20px'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Title */}
      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="quest-mode">Modalidade</label>
        <select id="quest-mode" value={executionMode} onChange={e => setExecutionMode(e.target.value)}>
          <option value="dice">Atividade por rolagem</option>
          <option value="mana">Source of Mana — jogo 2D</option>
        </select>
      </div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
          Título

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Ex: Escolta do Mercador"
        /></label>
      </div>

      {/* Description */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
          Descrição

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          placeholder="Descreva a atividade, seus desafios e objetivos..."
        /></label>
      </div>

      {/* Dates */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Data de Início

          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          /></label>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Data de Término

          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          /></label>
        </div>
      </div>

      {/* Goal & Max Participants */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Meta Total (Goal)

          <input
            type="number"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            required
            min={1}
          /></label>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Máx. Participantes (0 = Sem Limite)

          <input
            type="number"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
            required
            min={0}
          /></label>
        </div>
      </div>

      {/* Rules System */}
      {executionMode !== 'mana' && <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '16px', marginBottom: '16px' }}>
        <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--gold)', marginBottom: '12px', textTransform: 'uppercase' }}>
          Configuração de Regras
        </h4>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Atributo Testado

            <select value={attribute} onChange={(e) => setAttribute(e.target.value)}>
              <option value="str">Força (FOR)</option>
              <option value="dex">Destreza (DES)</option>
              <option value="con">Constituição (CON)</option>
              <option value="int">Inteligência (INT)</option>
              <option value="wis">Sabedoria (SAB)</option>
              <option value="cha">Carisma (CAR)</option>
            </select></label>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Fórmula de Recompensas

            <select value={rewardFormula} onChange={(e) => setRewardFormula(e.target.value)}>
              <option value="proportional">Proporcional (Roll/20)</option>
              <option value="flat">Fixa (Flat)</option>
            </select></label>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
              XP Máximo

            <input
              type="number"
              value={xpMax}
              onChange={(e) => setXpMax(e.target.value)}
              required
              min={0}
            /></label>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Gold Máximo

            <input
              type="number"
              value={goldMax}
              onChange={(e) => setGoldMax(e.target.value)}
              required
              min={0}
            /></label>
          </div>
        </div>
      </div>

      }
      {/* Form Buttons */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          style={{
            background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)',
            padding: '10px 16px', borderRadius: 'var(--radius)', fontSize: '13px',
            fontFamily: 'var(--font-display)', fontWeight: 600
          }}
        >
          Cancelar
        </button>

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? 'var(--border)' : 'var(--gold)',
            color: loading ? 'var(--text-muted)' : 'var(--bg)',
            padding: '10px 24px', borderRadius: 'var(--radius)', fontSize: '13px',
            fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.5px'
          }}
        >
          {loading ? 'Salvando...' : 'Criar Atividade'}
        </button>
      </div>
    </form>
  );
}
