/**
 * pages/SessionsPage.jsx
 *
 * Painel exclusivo para GM_PRINCIPAL e GM.
 * Rota: /gm/sessions
 *
 * Seções:
 *   • Sidebar: lista de sessões com filtros
 *   • Painel central: log de eventos em tempo real
 *   • Drawer lateral: formulário de entrada manual de recurso
 *
 * Funcionalidades:
 *   • Abre/fecha sessão (GM_PRINCIPAL)
 *   • Registra eventos manualmente (GM e GM_PRINCIPAL)
 *   • Filtra log por jogador, tipo de recurso e fonte
 *   • WS: atualização em tempo real via SESSION_EVENT_CREATED
 *   • Edição e cancelamento de eventos (GM_PRINCIPAL, com motivo obrigatório)
 */

import {
  useState, useEffect, useCallback, useRef, useMemo, memo,
} from 'react';
import {
  BookOpen, Plus, X, ChevronDown, ChevronUp,
  Scroll, Coins, Star, Beaker, Zap, Heart, Package,
  Pencil, Trash2, Filter, AlertCircle,
  CheckCircle, Lock,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWs } from '../contexts/WsContext.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const RESOURCE_TYPES = [
  { value: 'gold',       label: 'Ouro',          icon: Coins,   color: '#c9a84c' },
  { value: 'xp',         label: 'XP',            icon: Star,    color: '#7fb3e8' },
  { value: 'potion',     label: 'Poção',          icon: Beaker,  color: '#7ecba1' },
  { value: 'spell_slot', label: 'Espaço de Magia',icon: Zap,     color: '#b07fe8' },
  { value: 'item',       label: 'Item',           icon: Package, color: '#d4956a' },
  { value: 'hp',         label: 'HP',             icon: Heart,   color: '#e87f7f' },
  { value: 'custom',     label: 'Personalizado',  icon: Scroll,  color: '#8a9ba8' },
];

const STATUS_LABELS = { open: 'Aberta', closed: 'Encerrada', archived: 'Arquivada' };

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDelta(delta, resourceType) {
  const sign  = delta > 0 ? '+' : '';
  const color = delta > 0 ? 'var(--emerald-bright)' : 'var(--crimson-bright)';
  const unit  = resourceType === 'gold' ? ' po' : resourceType === 'xp' ? ' xp' : '';
  return { text: `${sign}${delta}${unit}`, color };
}

function resourceMeta(type) {
  return RESOURCE_TYPES.find(r => r.value === type) ?? RESOURCE_TYPES[6];
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useSessionList
// ─────────────────────────────────────────────────────────────────────────────

function useSessionList() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const { on } = useWs();

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.get('/sessions').catch(() => []);
    setSessions(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const upsert = (s) => setSessions(prev => {
      const next = prev.filter(x => x.id !== s.id);
      return [s, ...next].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    });
    const u1 = on('SESSION_CREATED', upsert);
    const u2 = on('SESSION_CLOSED',  upsert);
    return () => { u1(); u2(); };
  }, [on]);

  return { sessions, loading, reload: load };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useSessionEvents
// ─────────────────────────────────────────────────────────────────────────────

function useSessionEvents(sessionId) {
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(false);
  const { on } = useWs();

  const load = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    const data = await api.get(`/sessions/${id}/events`).catch(() => []);
    setEvents(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(sessionId); }, [load, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const u1 = on('SESSION_EVENT_CREATED', ({ sessionId: sid, event }) => {
      if (sid !== sessionId) return;
      setEvents(prev => [event, ...prev.filter(e => e.id !== event.id)]);
    });
    const u2 = on('SESSION_EVENT_UPDATED', ({ sessionId: sid, event }) => {
      if (sid !== sessionId) return;
      setEvents(prev => prev.map(e => e.id === event.id ? event : e));
    });
    const u3 = on('SESSION_EVENT_DELETED', ({ sessionId: sid, eventId }) => {
      if (sid !== sessionId) return;
      setEvents(prev => prev.filter(e => e.id !== eventId));
    });
    return () => { u1(); u2(); u3(); };
  }, [on, sessionId]);

  return { events, loading, reload: () => load(sessionId) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: SessionBadge — status da sessão
// ─────────────────────────────────────────────────────────────────────────────

function SessionBadge({ status }) {
  const cfg = {
    open:     { color: 'var(--emerald-bright)', bg: 'rgba(26,92,58,0.25)',  dot: true  },
    closed:   { color: 'var(--text-muted)',      bg: 'rgba(42,37,24,0.5)',   dot: false },
    archived: { color: 'var(--text-faint)',      bg: 'rgba(30,26,18,0.5)',   dot: false },
  }[status] ?? { color: 'var(--text-muted)', bg: 'transparent', dot: false };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontFamily: 'var(--font-display)',
      letterSpacing: '0.8px', textTransform: 'uppercase',
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}33`,
      borderRadius: 3, padding: '2px 7px',
    }}>
      {cfg.dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: cfg.color, animation: 'pulse 1.5s infinite',
          flexShrink: 0,
        }} />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: SessionItem — item na lista lateral
// ─────────────────────────────────────────────────────────────────────────────

const SessionItem = memo(function SessionItem({ session, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left',
        padding: '12px 14px',
        background: active ? 'rgba(201,168,76,0.07)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--gold)' : 'transparent'}`,
        borderBottom: '1px solid var(--border)',
        transition: 'all 0.15s',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: 13, color: active ? 'var(--gold)' : 'var(--text)',
          fontFamily: 'var(--font-display)', letterSpacing: '0.3px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {session.title}
        </span>
        <SessionBadge status={session.status} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          {fmtDate(session.startedAt)}
        </span>
        {session.eventCount > 0 && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted)',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 3, padding: '1px 5px',
          }}>
            {session.eventCount} evento{session.eventCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {session.campaign && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {session.campaign}
        </span>
      )}
    </button>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Componente: EventRow — linha do log
// ─────────────────────────────────────────────────────────────────────────────

const EventRow = memo(function EventRow({ event, isGMPrincipal, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const meta   = resourceMeta(event.resourceType);
  const Icon   = meta.icon;
  const delta  = fmtDelta(event.delta, event.resourceType);
  const isDeleted = !!event.deletedAt;
  const isEdited  = !!event.editedAt;

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      opacity: isDeleted ? 0.45 : 1,
      transition: 'opacity 0.15s',
    }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr auto auto',
          alignItems: 'center',
          gap: 10, padding: '10px 14px',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Ícone do recurso */}
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: `${meta.color}18`,
          border: `1px solid ${meta.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={13} style={{ color: meta.color }} />
        </div>

        {/* Texto principal */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
              {event.actorName}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {meta.label}
            </span>
            {isEdited && (
              <span style={{ fontSize: 10, color: 'var(--gold-dim)', fontStyle: 'italic' }}>
                editado
              </span>
            )}
            {isDeleted && (
              <span style={{ fontSize: 10, color: 'var(--crimson-bright)', fontStyle: 'italic' }}>
                cancelado
              </span>
            )}
          </div>
          {event.description && (
            <div style={{
              fontSize: 12, color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {event.description}
            </div>
          )}
        </div>

        {/* Delta */}
        <span style={{
          fontSize: 14, fontFamily: 'var(--font-mono)',
          fontWeight: 600, color: delta.color,
          flexShrink: 0,
        }}>
          {delta.text}
        </span>

        {/* Hora */}
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, minWidth: 36 }}>
          {fmtTime(event.occurredAt)}
        </span>
      </div>

      {/* Linha expandida */}
      {expanded && (
        <div style={{
          padding: '8px 14px 12px 54px',
          background: 'var(--bg-elevated)',
          borderTop: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', marginBottom: 8 }}>
            {event.valueBefore != null && (
              <DetailPill label="Antes" value={event.valueBefore} />
            )}
            {event.valueAfter != null && (
              <DetailPill label="Depois" value={event.valueAfter} />
            )}
            <DetailPill label="Fonte" value={
              event.source === 'foundry' ? '🎲 Foundry' :
              event.source === 'manual'  ? '✍️ Manual'  : '⚙️ Sistema'
            } />
            <DetailPill label="Registrado por" value={event.registeredByName ?? '—'} />
            {event.playerName && (
              <DetailPill label="Jogador" value={event.playerName} />
            )}
          </div>

          {event.deltaMeta && Object.keys(event.deltaMeta).length > 0 && (
            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 3, padding: '4px 8px', marginBottom: 8,
            }}>
              {JSON.stringify(event.deltaMeta)}
            </div>
          )}

          {isGMPrincipal && !isDeleted && (
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionBtn icon={Pencil} label="Editar" onClick={() => onEdit(event)} />
              <ActionBtn icon={Trash2} label="Cancelar" danger onClick={() => onDelete(event)} />
            </div>
          )}

          {event.editReason && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
              Motivo da edição: {event.editReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function DetailPill({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick, danger = false }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 3,
        fontSize: 11, fontFamily: 'var(--font-display)',
        letterSpacing: '0.5px', textTransform: 'uppercase',
        background: danger ? 'rgba(125,36,36,0.15)' : 'rgba(201,168,76,0.08)',
        border: `1px solid ${danger ? 'var(--crimson)' : 'var(--gold-dim)'}`,
        color: danger ? 'var(--crimson-bright)' : 'var(--gold)',
        transition: 'all 0.15s',
      }}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: EventFilters
// ─────────────────────────────────────────────────────────────────────────────

function EventFilters({ filter, onChange, playerOptions }) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '10px 14px',
      borderBottom: '1px solid var(--border)',
      flexWrap: 'wrap', alignItems: 'center',
    }}>
      <Filter size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />

      <select
        value={filter.resourceType}
        onChange={e => onChange({ ...filter, resourceType: e.target.value })}
        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
      >
        <option value="">Todos os recursos</option>
        {RESOURCE_TYPES.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      <select
        value={filter.playerId}
        onChange={e => onChange({ ...filter, playerId: e.target.value })}
        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
      >
        <option value="">Todos os jogadores</option>
        {playerOptions.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <select
        value={filter.source}
        onChange={e => onChange({ ...filter, source: e.target.value })}
        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
      >
        <option value="">Todas as fontes</option>
        <option value="manual">Manual</option>
        <option value="foundry">Foundry</option>
        <option value="system">Sistema</option>
      </select>

      {(filter.resourceType || filter.playerId || filter.source) && (
        <button
          onClick={() => onChange({ resourceType: '', playerId: '', source: '' })}
          style={{
            fontSize: 11, color: 'var(--text-muted)',
            background: 'none', padding: '3px 8px',
            border: '1px solid var(--border)', borderRadius: 3,
          }}
        >
          Limpar
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: NewSessionModal
// ─────────────────────────────────────────────────────────────────────────────

function NewSessionModal({ onClose, onCreated }) {
  const [form, setForm]   = useState({ title: '', campaign: '', gmNotes: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Nome da sessão é obrigatório.'); return; }
    setBusy(true); setError('');
    try {
      const session = await api.post('/sessions', {
        title:    form.title.trim(),
        campaign: form.campaign.trim() || null,
        gmNotes:  form.gmNotes.trim() || null,
      });
      onCreated(session);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao criar sessão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ModalHeader title="Nova Sessão" icon={BookOpen} onClose={onClose} />

        <FormField label="Nome da sessão *" htmlFor="s-title">
          <input
            id="s-title" ref={titleRef}
            value={form.title} onChange={set('title')}
            placeholder="Sessão 12 — A Cripta Esquecida"
            maxLength={200}
          />
        </FormField>

        <FormField label="Campanha" htmlFor="s-campaign">
          <input
            id="s-campaign"
            value={form.campaign} onChange={set('campaign')}
            placeholder="Liga Nimrod"
          />
        </FormField>

        <FormField label="Notas privadas (só para GMs)" htmlFor="s-notes">
          <textarea
            id="s-notes"
            value={form.gmNotes} onChange={set('gmNotes')}
            placeholder="Informações secretas sobre a sessão..."
            rows={3}
          />
        </FormField>

        {error && <ErrorMsg>{error}</ErrorMsg>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <GhostBtn onClick={onClose} disabled={busy}>Cancelar</GhostBtn>
          <PrimaryBtn type="submit" disabled={busy}>{busy ? 'Criando...' : 'Abrir Sessão'}</PrimaryBtn>
        </div>
      </form>
    </ModalOverlay>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: CloseSessionModal
// ─────────────────────────────────────────────────────────────────────────────

function CloseSessionModal({ session, onClose, onClosed }) {
  const [summary, setSummary] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const closed = await api.post(`/sessions/${session.id}/close`, {
        summary: summary.trim() || null,
      });
      onClosed(closed);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao encerrar sessão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ModalHeader title="Encerrar Sessão" icon={Lock} onClose={onClose} />

        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Encerrar <strong style={{ color: 'var(--text)' }}>{session.title}</strong>?
          Após encerrada, novos eventos não poderão ser registrados.
        </p>

        <FormField label="Resumo da sessão (opcional)" htmlFor="cl-summary">
          <textarea
            id="cl-summary"
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="Os heróis derrotaram o dragão e recuperaram o artefato..."
            rows={4}
          />
        </FormField>

        {error && <ErrorMsg>{error}</ErrorMsg>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <GhostBtn onClick={onClose} disabled={busy}>Cancelar</GhostBtn>
          <DangerBtn type="submit" disabled={busy}>{busy ? 'Encerrando...' : 'Encerrar Sessão'}</DangerBtn>
        </div>
      </form>
    </ModalOverlay>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: EventFormDrawer — formulário de entrada manual
// ─────────────────────────────────────────────────────────────────────────────

function EventFormDrawer({ session, players, onClose, onCreated }) {
  const EMPTY = {
    playerId: '', actorName: '', resourceType: 'gold',
    delta: '', description: '', deltaMeta: '',
    source: 'manual',
  };
  const [form, setForm]   = useState(EMPTY);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk]       = useState(false);

  const set = (k) => (e) => {
    setError(''); setOk(false);
    setForm(f => ({ ...f, [k]: e.target.value }));
  };

  // Preenche actorName ao selecionar jogador
  function selectPlayer(e) {
    const id = e.target.value;
    const p  = players.find(x => x.id === id);
    setForm(f => ({ ...f, playerId: id, actorName: p?.actorName ?? f.actorName }));
  }

  async function submit(e) {
    e.preventDefault();
    const deltaNum = parseFloat(form.delta);
    if (!form.playerId)           { setError('Selecione um jogador.'); return; }
    if (!form.actorName.trim())   { setError('Nome do personagem é obrigatório.'); return; }
    if (!form.delta || isNaN(deltaNum) || deltaNum === 0) { setError('Delta deve ser um número diferente de zero.'); return; }

    let parsedMeta = {};
    if (form.deltaMeta.trim()) {
      try { parsedMeta = JSON.parse(form.deltaMeta); }
      catch { setError('Metadados inválidos — use JSON válido.'); return; }
    }

    setBusy(true); setError('');
    try {
      const event = await api.post(`/sessions/${session.id}/events`, {
        playerId:     form.playerId,
        actorName:    form.actorName.trim(),
        resourceType: form.resourceType,
        delta:        deltaNum,
        description:  form.description.trim() || null,
        deltaMeta:    parsedMeta,
        source:       'manual',
      });
      onCreated(event);
      setOk(true);
      setForm(f => ({ ...EMPTY, playerId: f.playerId, actorName: f.actorName }));
    } catch (err) {
      setError(err.message || 'Erro ao registrar evento.');
    } finally {
      setBusy(false);
    }
  }

  const meta = resourceMeta(form.resourceType);
  const Icon = meta.icon;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 340, background: 'var(--bg-modal)',
      borderLeft: '1px solid var(--border)',
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
      zIndex: 200, animation: 'slideInRight 0.2s ease-out',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 18px', borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <div style={{
            fontSize: 12, fontFamily: 'var(--font-display)',
            letterSpacing: '1px', textTransform: 'uppercase',
            color: 'var(--gold)', marginBottom: 2,
          }}>
            Registrar Evento
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 220,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', color: 'var(--text-muted)', padding: 4,
          borderRadius: 3, display: 'flex',
        }}>
          <X size={16} />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={submit} style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>

        <FormField label="Jogador *" htmlFor="ev-player">
          <select id="ev-player" value={form.playerId} onChange={selectPlayer}>
            <option value="">Selecione...</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Personagem *" htmlFor="ev-actor">
          <input
            id="ev-actor" value={form.actorName} onChange={set('actorName')}
            placeholder="Nome do personagem"
          />
        </FormField>

        <FormField label="Tipo de recurso *" htmlFor="ev-type">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {RESOURCE_TYPES.map(r => {
              const RIcon = r.icon;
              const active = form.resourceType === r.value;
              return (
                <button
                  key={r.value} type="button"
                  onClick={() => { setForm(f => ({ ...f, resourceType: r.value })); setError(''); }}
                  title={r.label}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 4, padding: '8px 4px', borderRadius: 4,
                    background: active ? `${r.color}18` : 'var(--bg-field)',
                    border: `1px solid ${active ? r.color + '60' : 'var(--border-field)'}`,
                    color: active ? r.color : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  <RIcon size={14} />
                  <span style={{ fontSize: 9, letterSpacing: '0.3px', textAlign: 'center', lineHeight: 1.1 }}>
                    {r.label}
                  </span>
                </button>
              );
            })}
          </div>
        </FormField>

        <FormField label="Delta (+ ganho / − gasto) *" htmlFor="ev-delta">
          <div style={{ position: 'relative' }}>
            <input
              id="ev-delta" type="number" step="any"
              value={form.delta} onChange={set('delta')}
              placeholder="-50 ou +100"
              style={{ paddingLeft: 36 }}
            />
            <Icon size={14} style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)',
              color: meta.color, pointerEvents: 'none',
            }} />
          </div>
        </FormField>

        <FormField label="Descrição" htmlFor="ev-desc">
          <input
            id="ev-desc" value={form.description} onChange={set('description')}
            placeholder="Pagou hospedagem na taverna..."
          />
        </FormField>

        <FormField label="Metadados (JSON opcional)" htmlFor="ev-meta">
          <input
            id="ev-meta" value={form.deltaMeta} onChange={set('deltaMeta')}
            placeholder='{"slot_level": 3}'
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
          />
        </FormField>

        {error && <ErrorMsg>{error}</ErrorMsg>}
        {ok    && <SuccessMsg>Evento registrado!</SuccessMsg>}

        <PrimaryBtn type="submit" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? 'Registrando...' : 'Registrar Evento'}
        </PrimaryBtn>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: EditEventModal
// ─────────────────────────────────────────────────────────────────────────────

function EditEventModal({ event, onClose, onEdited }) {
  const [form, setForm] = useState({
    delta:      String(event.delta),
    description: event.description ?? '',
    editReason: '',
  });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.editReason.trim()) { setError('Motivo da edição é obrigatório.'); return; }
    const deltaNum = parseFloat(form.delta);
    if (isNaN(deltaNum) || deltaNum === 0) { setError('Delta deve ser um número diferente de zero.'); return; }
    setBusy(true); setError('');
    try {
      const updated = await api.patch(`/sessions/${event.sessionId}/events/${event.id}`, {
        delta:       deltaNum,
        description: form.description.trim() || null,
        editReason:  form.editReason.trim(),
      });
      onEdited(updated);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao editar evento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ModalHeader title="Editar Evento" icon={Pencil} onClose={onClose} />

        <div style={{
          padding: '8px 12px', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 4,
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          {event.actorName} — {resourceMeta(event.resourceType).label} — {fmtDate(event.occurredAt)}
        </div>

        <FormField label="Novo delta *" htmlFor="ed-delta">
          <input id="ed-delta" type="number" step="any" value={form.delta} onChange={set('delta')} />
        </FormField>

        <FormField label="Nova descrição" htmlFor="ed-desc">
          <input id="ed-desc" value={form.description} onChange={set('description')} />
        </FormField>

        <FormField label="Motivo da edição *" htmlFor="ed-reason">
          <textarea
            id="ed-reason" value={form.editReason} onChange={set('editReason')}
            placeholder="Ex: valor cobrado pela taverna era diferente"
            rows={2}
          />
        </FormField>

        {error && <ErrorMsg>{error}</ErrorMsg>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <GhostBtn onClick={onClose} disabled={busy}>Cancelar</GhostBtn>
          <PrimaryBtn type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar Edição'}</PrimaryBtn>
        </div>
      </form>
    </ModalOverlay>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente: DeleteEventModal
// ─────────────────────────────────────────────────────────────────────────────

function DeleteEventModal({ event, onClose, onDeleted }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) { setError('Motivo do cancelamento é obrigatório.'); return; }
    setBusy(true); setError('');
    try {
      await fetch(`/api/sessions/${event.sessionId}/events/${event.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteReason: reason.trim() }),
      }).then(async r => {
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Erro'); }
      });
      onDeleted(event.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao cancelar evento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ModalHeader title="Cancelar Evento" icon={Trash2} onClose={onClose} />

        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Cancela o evento de <strong style={{ color: 'var(--text)' }}>{event.actorName}</strong> ({resourceMeta(event.resourceType).label}: {event.delta}).
          O registro permanece no histórico marcado como cancelado.
        </p>

        <FormField label="Motivo do cancelamento *" htmlFor="del-reason">
          <textarea
            id="del-reason" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Ex: evento registrado por engano"
            rows={2}
          />
        </FormField>

        {error && <ErrorMsg>{error}</ErrorMsg>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <GhostBtn onClick={onClose} disabled={busy}>Voltar</GhostBtn>
          <DangerBtn type="submit" disabled={busy}>{busy ? 'Cancelando...' : 'Confirmar Cancelamento'}</DangerBtn>
        </div>
      </form>
    </ModalOverlay>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos de UI
// ─────────────────────────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300, padding: 24,
      }}
    >
      <div style={{
        background: 'var(--bg-modal)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 24, width: '100%', maxWidth: 460,
        boxShadow: 'var(--shadow-lg)',
        animation: 'fadeIn 0.15s ease-out',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, icon: Icon, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={15} style={{ color: 'var(--gold)' }} />
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: 14,
          letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--gold)',
        }}>
          {title}
        </h2>
      </div>
      <button onClick={onClose} style={{ background: 'none', color: 'var(--text-muted)', padding: 4 }}>
        <X size={16} />
      </button>
    </div>
  );
}

function FormField({ label, htmlFor, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label htmlFor={htmlFor} style={{
        fontSize: 11, color: 'var(--text-muted)',
        fontFamily: 'var(--font-display)', letterSpacing: '0.6px',
        textTransform: 'uppercase',
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorMsg({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '8px 12px', borderRadius: 4,
      background: 'rgba(125,36,36,0.15)',
      border: '1px solid var(--crimson)',
      fontSize: 12, color: 'var(--crimson-bright)',
    }}>
      <AlertCircle size={13} /> {children}
    </div>
  );
}

function SuccessMsg({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '8px 12px', borderRadius: 4,
      background: 'rgba(26,92,58,0.15)',
      border: '1px solid var(--emerald)',
      fontSize: 12, color: 'var(--emerald-bright)',
    }}>
      <CheckCircle size={13} /> {children}
    </div>
  );
}

function PrimaryBtn({ children, style: sx, ...props }) {
  return (
    <button {...props} style={{
      padding: '9px 18px', borderRadius: 4,
      background: 'linear-gradient(135deg, #8b6914 0%, #5a420a 100%)',
      border: '1px solid var(--gold-dim)',
      color: 'var(--gold-bright)',
      fontFamily: 'var(--font-display)', fontSize: 12,
      letterSpacing: '1px', textTransform: 'uppercase',
      boxShadow: '0 2px 12px rgba(201,168,76,0.2)',
      opacity: props.disabled ? 0.5 : 1,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      ...sx,
    }}>
      {children}
    </button>
  );
}

function DangerBtn({ children, ...props }) {
  return (
    <button {...props} style={{
      padding: '9px 18px', borderRadius: 4,
      background: 'linear-gradient(135deg, #8b2020 0%, #5a1010 100%)',
      border: '1px solid var(--crimson)',
      color: '#f0d0d0',
      fontFamily: 'var(--font-display)', fontSize: 12,
      letterSpacing: '1px', textTransform: 'uppercase',
      opacity: props.disabled ? 0.5 : 1,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
    }}>
      {children}
    </button>
  );
}

function GhostBtn({ children, ...props }) {
  return (
    <button {...props} style={{
      padding: '9px 18px', borderRadius: 4,
      background: 'transparent',
      border: '1px solid var(--border)',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-display)', fontSize: 12,
      letterSpacing: '1px', textTransform: 'uppercase',
      opacity: props.disabled ? 0.5 : 1,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
    }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal: SessionsPage
// ─────────────────────────────────────────────────────────────────────────────

export default function SessionsPage() {
  const { user }                          = useAuth();
  const isGMPrincipal                     = user?.role === 'GM_PRINCIPAL';
  const isGM                              = user?.role === 'GM' || isGMPrincipal;

  // Guarda de role — mostra tela de acesso negado para PLAYER
  if (!isGM) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '60vh', gap: 12,
      }}>
        <Lock size={32} style={{ color: 'var(--text-faint)' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: 'var(--font-display)',
          letterSpacing: '1px', textTransform: 'uppercase' }}>
          Acesso restrito a Mestres
        </p>
      </div>
    );
  }

  const { sessions, loading: loadingSessions } = useSessionList();

  const [activeId,      setActiveId]      = useState(null);
  const [filter,        setFilter]        = useState({ resourceType: '', playerId: '', source: '' });
  const [showNewModal,  setShowNewModal]  = useState(false);
  const [showCloseModal,setShowCloseModal]= useState(false);
  const [showDrawer,    setShowDrawer]    = useState(false);
  const [editEvent,     setEditEvent]     = useState(null);
  const [deleteEvent,   setDeleteEvent]   = useState(null);
  const [sidebarOpen,   setSidebarOpen]   = useState(true);

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const { events, loading: loadingEvents } = useSessionEvents(activeId);

  // Seleciona a sessão mais recente aberta ao carregar
  useEffect(() => {
    if (activeId || !sessions.length) return;
    const open = sessions.find(s => s.status === 'open') ?? sessions[0];
    if (open) setActiveId(open.id);
  }, [sessions, activeId]);

  // Filtra eventos
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (filter.resourceType && e.resourceType !== filter.resourceType) return false;
      if (filter.playerId     && e.playerId     !== filter.playerId)     return false;
      if (filter.source       && e.source       !== filter.source)       return false;
      return true;
    });
  }, [events, filter]);

  // Lista de jogadores únicos nos eventos (para o filtro)
  const playerOptions = useMemo(() => {
    const seen = new Map();
    events.forEach(e => {
      if (!seen.has(e.playerId)) seen.set(e.playerId, e.playerName ?? e.actorName);
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [events]);

  // Handlers de modal
  function handleCreated(session) { setActiveId(session.id); }
  function handleClosed(session)  { /* WS cuida da atualização */ }
  function handleEventCreated()   { /* WS cuida do append */ }
  function handleEdited(event)    { /* WS cuida do update */ }
  function handleDeleted(id)      { /* WS cuida da remoção */ }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>

      {/* ── Sidebar: lista de sessões ─────────────────────────────────── */}
      <aside style={{
        width: sidebarOpen ? 260 : 0, flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', transition: 'width 0.2s ease',
        background: 'var(--bg-elevated)',
      }}>
        {/* Header sidebar */}
        <div style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 11,
            letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--gold)',
          }}>
            Sessões
          </span>
          {isGMPrincipal && (
            <button
              onClick={() => setShowNewModal(true)}
              title="Nova sessão"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 3,
                background: 'rgba(201,168,76,0.08)',
                border: '1px solid var(--gold-dim)',
                color: 'var(--gold)', fontSize: 11,
                fontFamily: 'var(--font-display)', letterSpacing: '0.5px',
              }}
            >
              <Plus size={11} /> Nova
            </button>
          )}
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingSessions ? (
            [1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ height: 60, margin: '6px 10px', borderRadius: 4 }} />
            ))
          ) : sessions.length === 0 ? (
            <div style={{
              padding: 24, textAlign: 'center',
              color: 'var(--text-faint)', fontSize: 12, fontStyle: 'italic',
            }}>
              {isGMPrincipal ? 'Abra a primeira sessão.' : 'Nenhuma sessão disponível.'}
            </div>
          ) : (
            sessions.map(s => (
              <SessionItem
                key={s.id}
                session={s}
                active={s.id === activeId}
                onClick={() => { setActiveId(s.id); setShowDrawer(false); }}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Painel central ─────────────────────────────────────────────── */}
      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', minWidth: 0,
      }}>
        {/* Toolbar */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: 'var(--bg-elevated)',
        }}>
          {/* Toggle sidebar */}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? 'Recolher lista' : 'Mostrar lista'}
            style={{
              background: 'none', color: 'var(--text-muted)',
              padding: 6, borderRadius: 3, display: 'flex',
              border: '1px solid var(--border)',
            }}
          >
            {sidebarOpen ? <ChevronDown size={13} style={{ transform: 'rotate(90deg)' }} /> : <ChevronUp size={13} style={{ transform: 'rotate(90deg)' }} />}
          </button>

          {activeSession ? (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 14,
                    color: 'var(--text)', letterSpacing: '0.3px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {activeSession.title}
                  </span>
                  <SessionBadge status={activeSession.status} />
                </div>
                {activeSession.campaign && (
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{activeSession.campaign}</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {/* Registrar evento — qualquer GM em sessão aberta */}
                {activeSession.status === 'open' && (
                  <button
                    onClick={() => setShowDrawer(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 4,
                      background: showDrawer ? 'rgba(201,168,76,0.1)' : 'rgba(201,168,76,0.06)',
                      border: `1px solid ${showDrawer ? 'var(--gold)' : 'var(--gold-dim)'}`,
                      color: showDrawer ? 'var(--gold-bright)' : 'var(--gold)',
                      fontFamily: 'var(--font-display)', fontSize: 11,
                      letterSpacing: '0.8px', textTransform: 'uppercase',
                    }}
                  >
                    <Plus size={12} /> Evento
                  </button>
                )}

                {/* Encerrar — só GM_PRINCIPAL em sessão aberta */}
                {isGMPrincipal && activeSession.status === 'open' && (
                  <button
                    onClick={() => setShowCloseModal(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 4,
                      background: 'rgba(125,36,36,0.12)',
                      border: '1px solid var(--crimson)',
                      color: 'var(--crimson-bright)',
                      fontFamily: 'var(--font-display)', fontSize: 11,
                      letterSpacing: '0.8px', textTransform: 'uppercase',
                    }}
                  >
                    <Lock size={11} /> Encerrar
                  </button>
                )}
              </div>
            </>
          ) : (
            <span style={{ color: 'var(--text-faint)', fontSize: 13, fontStyle: 'italic' }}>
              Selecione uma sessão
            </span>
          )}
        </div>

        {/* Filtros do log */}
        {activeSession && (
          <EventFilters
            filter={filter}
            onChange={setFilter}
            playerOptions={playerOptions}
          />
        )}

        {/* Log de eventos */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!activeSession ? (
            <EmptyState
              icon={BookOpen}
              title="Nenhuma sessão selecionada"
              sub={isGMPrincipal ? 'Abra uma nova sessão ou selecione uma existente.' : 'Selecione uma sessão na lista.'}
            />
          ) : loadingEvents ? (
            [1, 2, 3, 4].map(i => (
              <div key={i} className="skeleton" style={{ height: 52, margin: '4px 8px', borderRadius: 4 }} />
            ))
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              icon={Scroll}
              title="Sem eventos"
              sub={events.length > 0 ? 'Nenhum evento corresponde aos filtros.' : activeSession.status === 'open' ? 'Registre o primeiro evento desta sessão.' : 'Esta sessão não tem eventos registrados.'}
            />
          ) : (
            filteredEvents.map(event => (
              <EventRow
                key={event.id}
                event={event}
                isGMPrincipal={isGMPrincipal}
                onEdit={setEditEvent}
                onDelete={setDeleteEvent}
              />
            ))
          )}
        </div>

        {/* Contagem */}
        {activeSession && filteredEvents.length > 0 && (
          <div style={{
            padding: '6px 14px', borderTop: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-faint)',
            background: 'var(--bg-elevated)', flexShrink: 0,
          }}>
            {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''}
            {filter.resourceType || filter.playerId || filter.source ? ' (filtrados)' : ''}
          </div>
        )}
      </main>

      {/* ── Drawer: formulário de evento ──────────────────────────────── */}
      {showDrawer && activeSession && (
        <EventFormDrawer
          session={activeSession}
          players={playerOptions}
          onClose={() => setShowDrawer(false)}
          onCreated={handleEventCreated}
        />
      )}

      {/* ── Modais ────────────────────────────────────────────────────── */}
      {showNewModal  && <NewSessionModal   onClose={() => setShowNewModal(false)}   onCreated={handleCreated} />}
      {showCloseModal && activeSession && (
        <CloseSessionModal
          session={activeSession}
          onClose={() => setShowCloseModal(false)}
          onClosed={handleClosed}
        />
      )}
      {editEvent   && <EditEventModal   event={editEvent}   onClose={() => setEditEvent(null)}   onEdited={handleEdited} />}
      {deleteEvent && <DeleteEventModal event={deleteEvent} onClose={() => setDeleteEvent(null)} onDeleted={handleDeleted} />}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 10,
      padding: 40, textAlign: 'center',
    }}>
      <Icon size={28} style={{ color: 'var(--text-faint)' }} />
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--text-muted)',
        letterSpacing: '0.5px', textTransform: 'uppercase' }}>
        {title}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-faint)', maxWidth: 260 }}>{sub}</div>}
    </div>
  );
}
