import { memo, useState, useCallback } from 'react';
import { Sword, Scroll, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Modal, useToast } from './ui.jsx';
import '../styles/mission-board.css';

const MISSION_DESCRIPTION_TEMPLATE = `Resumo da aventura:

Objetivo do grupo:

Classificação indicativa:

Temas sensíveis e combinados da mesa:`;

const todayInputValue = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const sanitizeDateInput = (value) => (
  String(value).replace(/[^\d-]/g, '').replace(/^(\d{4})\d+/, '$1').slice(0, 10)
);

const sanitizeTimeInput = (value) => String(value).replace(/[^\d:]/g, '').slice(0, 5);

const isValidDateValue = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
};

const isValidTimeValue = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const normalizeMissionDateTime = ({ date, time }) => {
  const resolvedDate = date?.trim();
  const resolvedTime = time?.trim();
  if (!resolvedDate && !resolvedTime) return null;
  if (!resolvedDate || !resolvedTime) throw new Error('Informe data e hora ou deixe ambas vazias.');
  if (!isValidDateValue(resolvedDate)) throw new Error('Informe uma data válida no formato AAAA-MM-DD.');
  if (!isValidTimeValue(resolvedTime)) throw new Error('Informe um horário válido no formato HH:MM.');
  return `${resolvedDate}T${resolvedTime}`;
};

export const CreateMissionModal = memo(function CreateMissionModal({ onClose, onCreated }) {
  const [kind, setKind] = useState('MISSION');
  const [form, setForm] = useState({
    title: '', description: MISSION_DESCRIPTION_TEMPLATE,
    date: '', time: '', reward: '', level: '', minPlayers:'',maxPlayers:4,maxReserves:2,minLevel:'',maxLevel:'',approvalRequired:false,registrationDeadline:'',
  });
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const body = { kind, ...form };
      if (kind === 'NOTICE') {
        delete body.date;
        delete body.time;
        delete body.datetime;
        delete body.reward;
        delete body.level;
        delete body.maxPlayers;
        delete body.maxReserves;
      } else {
        body.date = sanitizeDateInput(form.date);
        body.time = sanitizeTimeInput(form.time);
        const schedule=normalizeMissionDateTime(body);
        body.datetime=schedule?new Date(schedule).toISOString():null;
        delete body.date;delete body.time;
        body.registrationDeadline = form.registrationDeadline ? new Date(form.registrationDeadline).toISOString() : null;
      }
      if (pollEnabled && pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2) {
        body.pollQuestion = pollQuestion.trim();
        body.pollOptions = pollOptions.filter(o => o.trim());
      }
      const created = await api.post('/missions', body);
      notify(kind === 'MISSION' ? 'Missão criada. Convide um narrador para preparar a aventura.' : 'Aviso publicado no quadro.');
      onCreated?.(created);
      onClose?.();
    } catch (err) { setError(err.message); }
    setLoading(false);
  }, [form, kind, onClose, onCreated, pollEnabled, pollOptions, pollQuestion, notify]);

  const set = useCallback((k, v) => setForm(p => ({ ...p, [k]: v })), []);
  const setKindPreservingDescription = useCallback((nextKind) => {
    setKind(nextKind);
    setForm(p => {
      if (nextKind === 'MISSION' && !p.description.trim()) {
        return { ...p, description: MISSION_DESCRIPTION_TEMPLATE };
      }
      return p;
    });
  }, []);
  const setOpt = useCallback((i, v) => setPollOptions(opts => opts.map((o, idx) => idx === i ? v : o)), []);
  const addOpt = useCallback(() => setPollOptions(o => o.length < 8 ? [...o, ''] : o), []);
  const removeOpt = useCallback((i) => setPollOptions(o => o.length > 2 ? o.filter((_, idx) => idx !== i) : o), []);

  return <Modal title="Publicar no Quadro de Avisos" onClose={onClose} dismissible={!loading} wide>
    <div className="mission-create">
      <p className="ui-form-help">Reúna seu grupo para uma aventura ou compartilhe um aviso com a comunidade.</p>
      <div className="ui-tabs" role="group" aria-label="Tipo de publicação">
        <Button aria-pressed={kind === 'MISSION'} onClick={() => setKindPreservingDescription('MISSION')} disabled={loading}><Sword size={16} /> Missão</Button>
        <Button aria-pressed={kind === 'NOTICE'} onClick={() => setKindPreservingDescription('NOTICE')} disabled={loading}><Scroll size={16} /> Aviso</Button>
      </div>
      <form onSubmit={submit} aria-busy={loading}>
        <fieldset disabled={loading} className="mission-create-fields">
          <label htmlFor="mission-title">Título <span className="ui-form-help">Obrigatório</span></label>
          <input id="mission-title" value={form.title} onChange={e => set('title', e.target.value)} required placeholder={kind === 'MISSION' ? 'Dê um nome à aventura' : 'O que a comunidade precisa saber?'} />
          <label htmlFor="mission-description">Descrição <span className="ui-form-help">Obrigatória</span></label>
          <textarea id="mission-description" value={form.description} onChange={e => set('description', e.target.value)} required rows={6} />
          {kind === 'MISSION' && <>
            <fieldset className="ui-form-section"><legend>O grupo de aventureiros</legend>
              <div className="ui-form-row">
                <label>Nível mínimo<input type="number" min="1" value={form.minLevel} onChange={e => set('minLevel', e.target.value)} required /></label>
                <label>Nível máximo<input type="number" min={form.minLevel || 1} value={form.maxLevel} onChange={e => set('maxLevel', e.target.value)} required /></label>
              </div>
              <div className="ui-form-row">
                <label>Mínimo de jogadores<input type="number" min="1" max={form.maxPlayers} value={form.minPlayers} onChange={e => set('minPlayers', e.target.value)} required /></label>
                <label>Máximo de jogadores<input type="number" min="1" max="20" value={form.maxPlayers} onChange={e => set('maxPlayers', parseInt(e.target.value))} /></label>
              </div>
              <label>Vagas na lista de espera<input type="number" min="0" max="10" value={form.maxReserves} onChange={e => set('maxReserves', parseInt(e.target.value))} /></label>
              <p className="ui-form-help">O narrador será designado após aceitar um convite ou ter sua candidatura aprovada.</p>
            </fieldset>
            <fieldset className="ui-form-section"><legend>Quando e como participar</legend>
              <p id="mission-schedule-help" className="ui-form-help">A agenda é opcional. Preencha data e hora juntas. Horário local do seu dispositivo.</p>
              <div className="ui-form-row">
                <label>Data<input type="text" inputMode="numeric" maxLength={10} value={form.date} onChange={e => set('date', sanitizeDateInput(e.target.value))} placeholder={todayInputValue()} aria-describedby="mission-schedule-help" /></label>
                <label>Hora<input type="text" inputMode="numeric" maxLength={5} value={form.time} onChange={e => set('time', sanitizeTimeInput(e.target.value))} placeholder="20:00" aria-describedby="mission-schedule-help" /></label>
              </div>
              <label className="ui-check"><input type="checkbox" checked={form.approvalRequired} onChange={e => set('approvalRequired', e.target.checked)} /> Inscrições sujeitas à aprovação</label>
              <label>Prazo de inscrição <span className="ui-form-help">Opcional</span><input type="datetime-local" value={form.registrationDeadline} onChange={e => set('registrationDeadline', e.target.value)} /></label>
              <label>Recompensa <span className="ui-form-help">Opcional</span><input value={form.reward} onChange={e => set('reward', e.target.value)} placeholder="Experiência, tesouro ou itens…" /></label>
            </fieldset>
          </>}
          <fieldset className="ui-form-section"><legend>Enquete opcional</legend>
            <label className="ui-check"><input type="checkbox" checked={pollEnabled} onChange={e => setPollEnabled(e.target.checked)} /> Adicionar uma enquete à publicação</label>
            {pollEnabled && <>
              <label>Pergunta<input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} required={pollEnabled} /></label>
              {pollOptions.map((opt, i) => <div key={i} className="mission-poll-row"><label>Opção {i + 1}<input value={opt} onChange={e => setOpt(i, e.target.value)} /></label>{pollOptions.length > 2 && <Button variant="ghost" aria-label={'Remover opção ' + (i + 1)} onClick={() => removeOpt(i)}><X size={18} /></Button>}</div>)}
              {pollOptions.length < 8 && <Button onClick={addOpt}>Adicionar opção</Button>}
            </>}
          </fieldset>
        </fieldset>
        {error && <p role="alert" className="ui-error">{error}</p>}
        <div className="ui-dialog-footer"><Button onClick={onClose} disabled={loading}>Cancelar</Button><Button type="submit" variant="primary" disabled={loading}>{loading ? 'Publicando…' : kind === 'MISSION' ? 'Criar missão' : 'Publicar aviso'}</Button></div>
      </form>
    </div>
  </Modal>;
});
