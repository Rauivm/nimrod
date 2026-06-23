/**
 * PatchNotesPage.jsx
 */

import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  Plus, ExternalLink, FileText, BookOpen,
  Trash2, Eye, EyeOff, X, Upload, Link as LinkIcon,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ── Mapa de ícones por seção ──────────────────────────────────────────────────
// Cada seção tem: ícone emoji padrão + mapa de entries para SVG (quando existir).
// A chave do SECTION_MAP deve bater com section.title (case-insensitive trim).
// A chave do entries map deve bater com entry.name (case-insensitive trim).

const SECTION_MAP = {
  classes: {
    sectionIcon: '⚔',
    folder: 'classes',
    entries: {
      paladino: 'paladin',
      guerreiro: 'fighter',
      feiticeiro: 'sorcerer',
      bruxo: 'warlock',
      mago: 'wizard',
      clerigo: 'cleric',
      barbaro: 'barbarian',
      druida: 'druid',
      monge: 'monk',
      bardo: 'bard',
      ranger: 'ranger',
      ladino: 'rogue',
    },
  },

  magias: {
    sectionIcon: '✨',
    folder: 'spells',
    entries: {},
  },

  itens: {
    sectionIcon: '🛡',
    folder: 'items',
    entries: {},
  },

  sistemas: {
    sectionIcon: '⚙',
    folder: 'systems',
    entries: {},
  },

  racas: {
    sectionIcon: '🧬',
    folder: 'races',
    entries: {},
  },

  guilda: {
    sectionIcon: '🏰',
    folder: 'guild',
    entries: {},
  },

  correcoes: {
    sectionIcon: '🐛',
    folder: null,
    entries: {},
  },

  ajustes: {
    sectionIcon: '↔',
    folder: null,
    entries: {},
  },

  destaques: {
    sectionIcon: '⚡',
    folder: null,
    entries: {},
  },
};

function normalizeKey(value = '') {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}


// Resolve a definição de uma seção pelo título (case-insensitive)
function getSectionDef(title = '') {
  const key = normalizeKey(title);
  return SECTION_MAP[key] ?? { icon: '📜', folder: null, entries: {} };
}

// Resolve o caminho de ícone SVG de um entry dentro de uma seção.
// Retorna string (path) se houver SVG mapeado, null caso contrário.
function getEntryIconPath(sectionTitle, entryName = '') {
  const def  = getSectionDef(sectionTitle);
  if (!def.folder) return null;
  const slug = def.entries[normalizeKey(entryName)];
  if (!slug) return null;
  return `/${def.folder}/${slug}.svg`;
}

// ── EntryIcon ─────────────────────────────────────────────────────────────────
// Tenta carregar o SVG. Se falhar (404 ou não mapeado), mostra a inicial do nome.
function EntryIcon({ sectionTitle, entryName }) {
  const [failed, setFailed] = useState(false);
  const path = getEntryIconPath(sectionTitle, entryName);
  const initial = (entryName?.[0] ?? '?').toUpperCase();

  if (!path || failed) {
    return (
      <div className="pn-entry-icon pn-entry-icon-fallback">
        {initial}
      </div>
    );
  }

  return (
    <img
      src={path}
      alt=""
      className="pn-entry-icon pn-entry-icon-svg"
      onError={() => setFailed(true)}
    />
  );
}

// ── HomebrewPreview ───────────────────────────────────────────────────────────
function HomebrewPreview({ url, title }) {
  const [open, setOpen]     = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="hb-preview">
      <button
        className={`hb-preview-toggle ${open ? 'hb-preview-toggle-open' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <BookOpen size={13} />
        {open ? 'Fechar documento' : 'Visualizar no Homebrewery'}
      </button>

      {open && (
        <div className="hb-frame-wrap">
          {!loaded && (
            <div className="hb-loading">
              <div className="hb-spinner" />
              <span>Carregando documento...</span>
            </div>
          )}
          <iframe
            src={url}
            title={title}
            className="hb-frame"
            style={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoaded(true)}
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        </div>
      )}
    </div>
  );
}

// ── PatchNoteCard ─────────────────────────────────────────────────────────────
function PatchNoteCard({ note, isGM, onDeleted, onTogglePublish }) {
  const [deleting, setDeleting]   = useState(false);
  const [toggling, setToggling]   = useState(false);
  const [openSections, setOpenSections] = useState({});
  const [openEntries,  setOpenEntries]  = useState({});

  // Conta buffs / nerfs / ajustes somando todos os entries de todas as seções
  const stats = (note.content?.sections ?? []).reduce(
    (acc, section) => {
      (section.entries ?? []).forEach(entry => {
        const t = (entry.type ?? '').toUpperCase();
        if (t === 'BUFF')  acc.buffs++;
        else if (t === 'NERF') acc.nerfs++;
        else acc.adjustments++;
      });
      return acc;
    },
    { buffs: 0, nerfs: 0, adjustments: 0 },
  );

  const toggleSection = (key) =>
    setOpenSections(p => ({ ...p, [key]: !p[key] }));

  const toggleEntry = (key) =>
    setOpenEntries(p => ({ ...p, [key]: !p[key] }));

  const del = async () => {
    if (!confirm(`Excluir "${note.title}"?`)) return;
    setDeleting(true);
    try {
      await api.delete(`/patch-notes/${note.id}`);
      onDeleted?.(note.id);
    } catch (e) { alert(e.message); }
    setDeleting(false);
  };

  const togglePublish = async () => {
    setToggling(true);
    try {
      const updated = await api.patch(`/patch-notes/${note.id}`, { published: !note.published });
      onTogglePublish?.(updated);
    } catch (e) { alert(e.message); }
    setToggling(false);
  };

  const hasSections = (note.content?.sections?.length ?? 0) > 0;

  return (
    <article className={`pn-card animate-in ${!note.published ? 'pn-card-draft' : ''}`}>

      {/* Cabeçalho */}
      <div className="pn-card-header">
        <div className="pn-card-meta">
          <span className="pn-version">{note.version}</span>
          {!note.published && <span className="pn-draft-badge">Rascunho</span>}
        </div>
        <span className="pn-date" title={format(new Date(note.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}>
          {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true, locale: ptBR })}
        </span>
      </div>

      <h3 className="pn-title">{note.title}</h3>

      {note.summary && <p className="pn-summary">{note.summary}</p>}

      {/* Badges de resumo */}
      {(stats.buffs > 0 || stats.nerfs > 0 || stats.adjustments > 0) && (
        <div className="pn-stats">
          {stats.buffs       > 0 && <span className="pn-stat pn-stat-buff">↑ {stats.buffs} Buff{stats.buffs > 1 ? 's' : ''}</span>}
          {stats.nerfs       > 0 && <span className="pn-stat pn-stat-nerf">↓ {stats.nerfs} Nerf{stats.nerfs > 1 ? 's' : ''}</span>}
          {stats.adjustments > 0 && <span className="pn-stat pn-stat-adjust">↔ {stats.adjustments} Ajuste{stats.adjustments > 1 ? 's' : ''}</span>}
        </div>
      )}

      {/* Seções estilo Riot */}
      {hasSections && (
        <div className="pn-riot-preview">
          {note.content.sections.map(section => {
            const def        = getSectionDef(section.title);
            const sectionKey = section.title;
            const isOpen     = openSections[sectionKey] ?? false;
            const count      = section.entries?.length ?? 0;

            return (
              <div key={sectionKey} className="pn-section">

                {/* Toggle da seção */}
                <button
                  className="pn-section-toggle"
                  onClick={() => toggleSection(sectionKey)}
                >
                  <span className="pn-section-toggle-left">
                    {isOpen
                      ? <ChevronDown size={12} />
                      : <ChevronRight size={12} />
                    }
                    <span className="pn-section-icon">{def.icon}</span>
                    {section.title.toUpperCase()}
                  </span>
                  <span className="pn-section-count">{count}</span>
                </button>

                {/* Entries */}
                {isOpen && (
                  <div className="pn-entries">
                    {(section.entries ?? []).map(entry => {
                      const entryKey  = `${sectionKey}-${entry.name}`;
                      const entryOpen = openEntries[entryKey] ?? false;
                      const tag       = (entry.type ?? '').toUpperCase();

                      return (
                        <div key={entryKey} className="pn-entry">
                          {/* Toggle do entry */}
                          <button
                            className="pn-entry-toggle"
                            onClick={() => toggleEntry(entryKey)}
                          >
                            <span className="pn-entry-toggle-left">
                              <EntryIcon
                                sectionTitle={section.title}
                                entryName={entry.name}
                              />
                              <span className="pn-entry-name">{entry.name}</span>
                            </span>
                            <span className={`pn-tag pn-tag-${tag.toLowerCase()}`}>
                              {tag}
                            </span>
                          </button>

                          {/* Mudanças */}
                          {entryOpen && entry.changes?.length > 0 && (
                            <div className="pn-entry-body">
                              {entry.context && (
                                <p className="pn-entry-context">{entry.context}</p>
                              )}
                              <div className="pn-changes">
                                {entry.changes.map((ch, i) => (
                                  <div key={i} className="pn-change">
                                    <span className="pn-change-label">{ch.label}</span>
                                    <span className="pn-old">{ch.old}</span>
                                    <span className="pn-arrow">→</span>
                                    <span className="pn-new">{ch.new}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Homebrewery + arquivo */}
      <div className="pn-sources">
        {note.homebrewUrl && (
          <HomebrewPreview url={note.homebrewUrl} title={note.title} />
        )}
        {note.fileUrl && (
          <a href={note.fileUrl} target="_blank" rel="noopener noreferrer" className="pn-file-link">
            <FileText size={13} />
            {note.fileUrl.endsWith('.pdf') ? 'Abrir PDF' : 'Ver arquivo'}
            <ExternalLink size={11} style={{ opacity: 0.6 }} />
          </a>
        )}
        {note.homebrewUrl && (
          <a href={note.homebrewUrl} target="_blank" rel="noopener noreferrer" className="pn-external-link">
            <ExternalLink size={11} /> Abrir no Homebrewery
          </a>
        )}
      </div>

      {/* Rodapé */}
      <div className="pn-footer">
        <span className="pn-author">por {note.author.displayName}</span>
        {isGM && (
          <div className="pn-gm-actions">
            <button onClick={togglePublish} disabled={toggling} className="pn-action-btn"
              title={note.published ? 'Despublicar' : 'Publicar'}>
              {note.published ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button onClick={del} disabled={deleting} className="pn-action-btn pn-action-btn-danger"
              title="Excluir">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      <style>{`
        /* ── Card base ── */
        .pn-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; display: flex; flex-direction: column; gap: 12px; transition: border-color 0.15s; }
        .pn-card:hover { border-color: var(--border-bright); }
        .pn-card-draft { opacity: 0.7; border-style: dashed; }
        .pn-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .pn-card-meta { display: flex; align-items: center; gap: 8px; }
        .pn-version { font-family: var(--font-display); font-size: 11px; font-weight: 700; color: var(--gold); background: rgba(201,168,76,0.1); border: 1px solid var(--gold-dim); border-radius: var(--radius); padding: 2px 8px; letter-spacing: 1px; text-transform: uppercase; }
        .pn-draft-badge { font-family: var(--font-display); font-size: 9px; color: var(--text-faint); border: 1px dashed var(--border); border-radius: var(--radius); padding: 2px 6px; letter-spacing: 1px; text-transform: uppercase; }
        .pn-date { font-size: 11px; color: var(--text-faint); white-space: nowrap; }
        .pn-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: 0.3px; line-height: 1.3; margin: 0; }
        .pn-summary { font-size: 14px; color: var(--text-muted); line-height: 1.65; margin: 0; }

        /* ── Badges de resumo ── */
        .pn-stats { display: flex; gap: 8px; flex-wrap: wrap; }
        .pn-stat { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .5px; }
        .pn-stat-buff   { background: rgba(40,167,69,.12);  color: #6ddf7a; border: 1px solid rgba(40,167,69,.25); }
        .pn-stat-nerf   { background: rgba(220,53,69,.12);  color: #ff7272; border: 1px solid rgba(220,53,69,.25); }
        .pn-stat-adjust { background: rgba(255,193,7,.12);  color: #f6d56c; border: 1px solid rgba(255,193,7,.25); }

        /* ── Seções estilo Riot ── */
        .pn-riot-preview { display: flex; flex-direction: column; gap: 8px; }
        .pn-section { display: flex; flex-direction: column; }

        .pn-section-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: rgba(201,168,76,.05); border: 1px solid var(--gold-dim); color: var(--gold); padding: 9px 14px; border-radius: var(--radius); cursor: pointer; font-family: var(--font-display); font-size: 12px; letter-spacing: 1px; text-transform: uppercase; transition: background 0.15s; }
        .pn-section-toggle:hover { background: rgba(201,168,76,.10); }
        .pn-section-toggle-left { display: flex; align-items: center; gap: 7px; }
        .pn-section-icon { font-size: 14px; line-height: 1; }
        .pn-section-count { font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); background: rgba(255,255,255,.05); border: 1px solid var(--border); border-radius: 3px; padding: 0 6px; }

        /* ── Entries ── */
        .pn-entries { display: flex; flex-direction: column; gap: 6px; padding: 8px 0 2px; }

        .pn-entry { border: 1px solid rgba(201,168,76,.1); border-radius: 6px; background: rgba(255,255,255,.01); overflow: hidden; transition: border-color 0.15s; }
        .pn-entry:hover { border-color: rgba(201,168,76,.2); }

        .pn-entry-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: var(--text); padding: 10px 14px; cursor: pointer; font: inherit; transition: background 0.15s; }
        .pn-entry-toggle:hover { background: rgba(255,255,255,.02); }
        .pn-entry-toggle-left { display: flex; align-items: center; gap: 10px; }
        .pn-entry-name { font-size: 14px; font-weight: 600; color: var(--text); font-family: var(--font-display); letter-spacing: 0.3px; }

        /* Ícone SVG de classe */
        .pn-entry-icon { width: 26px; height: 26px; flex-shrink: 0; }
        .pn-entry-icon-svg { object-fit: contain; filter: brightness(0) invert(1) drop-shadow(0 0 1px rgba(201,168,76,.6)); }
        /* Fallback: círculo com inicial */
        .pn-entry-icon-fallback { display: flex; align-items: center; justify-content: center; border-radius: 4px; background: linear-gradient(135deg, var(--bg-elevated), var(--bg-card)); border: 1px solid var(--border-bright); font-family: var(--font-display); font-size: 12px; font-weight: 700; color: var(--gold); }

        /* Corpo do entry (mudanças) */
        .pn-entry-body { padding: 10px 14px 12px; border-top: 1px solid rgba(201,168,76,.08); display: flex; flex-direction: column; gap: 8px; }
        .pn-entry-context { font-size: 12px; color: var(--text-muted); line-height: 1.6; font-style: italic; margin: 0; padding: 8px 10px; border-left: 2px solid var(--gold-dim); background: rgba(201,168,76,.04); border-radius: 0 4px 4px 0; }

        .pn-changes { display: flex; flex-direction: column; }
        .pn-change { display: grid; grid-template-columns: 140px 1fr 18px 1fr; align-items: center; gap: 0 10px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.04); font-size: 13px; }
        .pn-change:last-child { border-bottom: none; }
        .pn-change-label { color: var(--text-faint); font-size: 12px; }
        .pn-old  { color: #c66; text-decoration: line-through; font-family: var(--font-mono); font-size: 12px; text-align: right; }
        .pn-arrow { color: var(--text-faint); text-align: center; opacity: .6; }
        .pn-new  { color: #6ccf7c; font-weight: 700; font-family: var(--font-mono); font-size: 13px; }

        /* Tags BUFF / NERF / AJUSTE / NOVO */
        .pn-tag { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; flex-shrink: 0; }
        .pn-tag-buff   { background: rgba(40,167,69,.12);  border: 1px solid rgba(40,167,69,.3);  color: #6ddf7a; }
        .pn-tag-nerf   { background: rgba(220,53,69,.12);  border: 1px solid rgba(220,53,69,.3);  color: #ff7272; }
        .pn-tag-ajuste,
        .pn-tag-adjust { background: rgba(255,193,7,.12);  border: 1px solid rgba(255,193,7,.3);  color: #f6d56c; }
        .pn-tag-novo,
        .pn-tag-new    { background: rgba(139,92,246,.12); border: 1px solid rgba(139,92,246,.3); color: #b39cf0; }

        /* Fontes Homebrewery / arquivo */
        .pn-sources { display: flex; flex-direction: column; gap: 8px; }
        .pn-file-link { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius); padding: 5px 10px; transition: all 0.15s; align-self: flex-start; text-decoration: none; }
        .pn-file-link:hover { color: var(--text); border-color: var(--border-bright); }
        .pn-external-link { display: inline-flex; align-items: center; gap: 4px; color: var(--text-faint); font-size: 11px; font-family: var(--font-display); letter-spacing: 0.3px; text-decoration: none; transition: color 0.15s; align-self: flex-start; }
        .pn-external-link:hover { color: var(--gold); }

        /* Homebrewery iframe */
        .hb-preview { display: flex; flex-direction: column; gap: 8px; }
        .hb-preview-toggle { display: flex; align-items: center; gap: 6px; background: rgba(201,168,76,0.08); color: var(--gold); border: 1px solid var(--gold-dim); border-radius: var(--radius); padding: 6px 12px; font-size: 12px; font-family: var(--font-display); letter-spacing: 0.6px; text-transform: uppercase; transition: all 0.15s; align-self: flex-start; cursor: pointer; }
        .hb-preview-toggle:hover, .hb-preview-toggle-open { background: rgba(201,168,76,0.15); }
        .hb-frame-wrap { position: relative; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border-bright); background: var(--bg-elevated); }
        .hb-frame { width: 100%; height: 640px; border: none; display: block; transition: opacity 0.3s; }
        .hb-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-faint); font-size: 13px; }
        .hb-spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--gold); border-radius: 50%; animation: hb-spin 0.8s linear infinite; }
        @keyframes hb-spin { to { transform: rotate(360deg); } }

        /* Rodapé do card */
        .pn-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 8px; border-top: 1px solid var(--border); }
        .pn-author { font-size: 12px; color: var(--text-faint); }
        .pn-gm-actions { display: flex; align-items: center; gap: 6px; }
        .pn-action-btn { display: flex; align-items: center; background: none; color: var(--text-faint); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 8px; transition: all 0.15s; }
        .pn-action-btn:hover:not(:disabled) { color: var(--text); border-color: var(--border-bright); }
        .pn-action-btn-danger:hover:not(:disabled) { color: var(--crimson-bright); border-color: var(--crimson); }
        .pn-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </article>
  );
}

// ── PatchNoteForm ─────────────────────────────────────────────────────────────
// Todas as seções disponíveis — o GM escolhe quais usar.
const AVAILABLE_SECTIONS = [
  { title: 'Classes',    icon: '⚔' },
  { title: 'Magias',     icon: '✨' },
  { title: 'Itens',      icon: '🛡' },
  { title: 'Raças',      icon: '🧬' },
  { title: 'Sistemas',   icon: '⚙' },
  { title: 'Guilda',     icon: '🏰' },
  { title: 'Correções',  icon: '🐛' },
  { title: 'Ajustes',    icon: '↔' },
];

const ENTRY_TYPES = ['BUFF', 'NERF', 'AJUSTE', 'NOVO'];

function emptyEntry()  { return { name: '', type: 'BUFF',  context: '', changes: [{ label: '', old: '', new: '' }] }; }
function emptyChange() { return { label: '', old: '', new: '' }; }

function PatchNoteForm({ onClose, onCreate }) {
  const [title,       setTitle]      = useState('');
  const [version,     setVersion]    = useState('');
  const [summary,     setSummary]    = useState('');
  const [homebrewUrl, setHomebrew]   = useState('');
  const [file,        setFile]       = useState(null);
  const [published,   setPublished]  = useState(true);
  const [urlError,    setUrlError]   = useState('');
  const [submitting,  setSubmitting] = useState(false);
  const fileRef = useRef();

  // Seções adicionadas à nota — começa com uma vazia
  const [sections, setSections] = useState([
    { title: 'Classes', entries: [emptyEntry()] },
  ]);

  // ── Helpers de mutação ──────────────────────────────────────────────────
  const updateSection = (si, patch) =>
    setSections(s => s.map((sec, i) => i === si ? { ...sec, ...patch } : sec));

  const addSection = (sectionTitle) => {
    if (sections.find(s => s.title === sectionTitle)) return; // sem duplicata
    setSections(s => [...s, { title: sectionTitle, entries: [emptyEntry()] }]);
  };

  const removeSection = (si) =>
    setSections(s => s.filter((_, i) => i !== si));

  const addEntry = (si) =>
    updateSection(si, { entries: [...sections[si].entries, emptyEntry()] });

  const removeEntry = (si, ei) =>
    updateSection(si, { entries: sections[si].entries.filter((_, i) => i !== ei) });

  const updateEntry = (si, ei, patch) =>
    updateSection(si, {
      entries: sections[si].entries.map((e, i) => i === ei ? { ...e, ...patch } : e),
    });

  const addChange = (si, ei) =>
    updateEntry(si, ei, { changes: [...sections[si].entries[ei].changes, emptyChange()] });

  const removeChange = (si, ei, ci) =>
    updateEntry(si, ei, {
      changes: sections[si].entries[ei].changes.filter((_, i) => i !== ci),
    });

  const updateChange = (si, ei, ci, patch) =>
    updateEntry(si, ei, {
      changes: sections[si].entries[ei].changes.map((c, i) => i === ci ? { ...c, ...patch } : c),
    });

  // ── Validação de URL ────────────────────────────────────────────────────
  const validateUrl = (raw) => {
    if (!raw.trim()) { setUrlError(''); return; }
    try {
      const u = new URL(raw.trim());
      if (u.origin !== 'https://homebrewery.naturalcrit.com') {
        setUrlError('Use um link de homebrewery.naturalcrit.com');
      } else if (!u.pathname.startsWith('/share/') && !u.pathname.startsWith('/source/')) {
        setUrlError('Use o link /share/...');
      } else { setUrlError(''); }
    } catch { setUrlError('URL inválida'); }
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!title.trim() || !version.trim()) return;
    if (!homebrewUrl.trim() && !file) return;
    if (urlError) return;

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title',        title.trim());
      fd.append('version',      version.trim());
      fd.append('summary',      summary.trim());
      fd.append('homebrew_url', homebrewUrl.trim());
      fd.append('published',    String(published));
      fd.append('content',      JSON.stringify({ sections }));
      if (file) fd.append('file', file);

      const res = await fetch('/api/patch-notes', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Erro ao criar nota');
      }
      onCreate?.(await res.json());
      onClose?.();
    } catch (e) { alert(e.message); }
    setSubmitting(false);
  };

  const canSubmit = title.trim() && version.trim()
    && (homebrewUrl.trim() || file) && !urlError && !submitting;

  const unusedSections = AVAILABLE_SECTIONS.filter(
    s => !sections.find(sec => sec.title === s.title)
  );

  return (
    <div className="pnf-overlay" role="presentation">
      <div className="pnf-modal animate-in">

        <div className="pnf-header">
          <h3 className="pnf-title">Nova Nota de Patch</h3>
          <button onClick={onClose} className="pnf-close"><X size={16} /></button>
        </div>

        <div className="pnf-body">

          {/* ── Metadados básicos ── */}
          <div className="pnf-row-2">
            <div className="pnf-field">
              <label>Título *</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="ex: Balanceamento das Classes" maxLength={120} />
            </div>
            <div className="pnf-field">
              <label>Versão *</label>
              <input value={version} onChange={e => setVersion(e.target.value)}
                placeholder="ex: v1.2" maxLength={30} />
            </div>
          </div>

          <div className="pnf-field">
            <label>Resumo <span className="pnf-optional">(opcional)</span></label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)}
              placeholder="Descreva brevemente as mudanças..." maxLength={500} rows={2} />
            <span className="pnf-char-count">{summary.length}/500</span>
          </div>

          {/* ── Seções de conteúdo ── */}
          <div className="pnf-divider">Conteúdo estruturado</div>

          {sections.map((section, si) => {
            const def = getSectionDef(section.title);
            return (
              <div key={si} className="pnf-section">
                <div className="pnf-section-header">
                  <span className="pnf-section-label">
                    {def.icon} {section.title.toUpperCase()}
                  </span>
                  <button onClick={() => removeSection(si)} className="pnf-icon-btn pnf-btn-danger"
                    title="Remover seção"><X size={12} /></button>
                </div>

                {section.entries.map((entry, ei) => (
                  <div key={ei} className="pnf-entry">
                    <div className="pnf-entry-header">
                      <div className="pnf-row-3">
                        <div className="pnf-field">
                          <label>Nome</label>
                          <input value={entry.name}
                            onChange={e => updateEntry(si, ei, { name: e.target.value })}
                            placeholder={section.title === 'Classes' ? 'ex: Guerreiro' : 'ex: Fireball'} />
                        </div>
                        <div className="pnf-field">
                          <label>Tipo</label>
                          <select value={entry.type}
                            onChange={e => updateEntry(si, ei, { type: e.target.value })}>
                            {ENTRY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
                          <button onClick={() => removeEntry(si, ei)} className="pnf-icon-btn pnf-btn-danger"
                            disabled={section.entries.length === 1}><X size={12} /></button>
                        </div>
                      </div>

                      <div className="pnf-field">
                        <label>Contexto <span className="pnf-optional">(opcional)</span></label>
                        <input value={entry.context}
                          onChange={e => updateEntry(si, ei, { context: e.target.value })}
                          placeholder="Explicação narrativa da mudança..." maxLength={300} />
                      </div>
                    </div>

                    {/* Mudanças numéricas */}
                    <div className="pnf-changes-editor">
                      {entry.changes.map((ch, ci) => (
                        <div key={ci} className="pnf-change-row">
                          <input placeholder="Atributo" value={ch.label}
                            onChange={e => updateChange(si, ei, ci, { label: e.target.value })} />
                          <input placeholder="Antes" value={ch.old}
                            onChange={e => updateChange(si, ei, ci, { old: e.target.value })} />
                          <span className="pnf-arrow">→</span>
                          <input placeholder="Depois" value={ch.new}
                            onChange={e => updateChange(si, ei, ci, { new: e.target.value })} />
                          <button onClick={() => removeChange(si, ei, ci)}
                            className="pnf-icon-btn pnf-btn-danger"
                            disabled={entry.changes.length === 1}><X size={10} /></button>
                        </div>
                      ))}
                      <button onClick={() => addChange(si, ei)} className="pnf-add-btn">
                        + mudança
                      </button>
                    </div>
                  </div>
                ))}

                <button onClick={() => addEntry(si)} className="pnf-add-entry-btn">
                  <Plus size={11} /> Adicionar {section.title === 'Classes' ? 'classe' : 'entrada'}
                </button>
              </div>
            );
          })}

          {/* Adicionar nova seção */}
          {unusedSections.length > 0 && (
            <div className="pnf-add-section">
              <span className="pnf-add-section-label">+ Adicionar seção:</span>
              <div className="pnf-section-chips">
                {unusedSections.map(s => (
                  <button key={s.title} onClick={() => addSection(s.title)}
                    className="pnf-section-chip">
                    {s.icon} {s.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Fonte do documento ── */}
          <div className="pnf-divider">Documento de regras <span className="pnf-optional">(ao menos um)</span></div>

          <div className="pnf-field">
            <label><LinkIcon size={11} /> Link do Homebrewery</label>
            <input value={homebrewUrl}
              onChange={e => { setHomebrew(e.target.value); validateUrl(e.target.value); }}
              placeholder="https://homebrewery.naturalcrit.com/share/..." type="url" />
            {urlError && <span className="pnf-error">{urlError}</span>}
            {homebrewUrl && !urlError && <span className="pnf-hint">✓ Link válido</span>}
          </div>

          <div className="pnf-field">
            <label><Upload size={11} /> Arquivo (PDF / imagem)</label>
            <div className={`pnf-dropzone ${file ? 'pnf-dropzone-filled' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}>
              {file
                ? <><FileText size={14} /> {file.name}
                    <button onClick={e => { e.stopPropagation(); setFile(null); }} className="pnf-remove-file"><X size={11} /></button></>
                : <><Upload size={14} /> Clique ou arraste um PDF / imagem</>
              }
            </div>
            <input ref={fileRef} type="file" accept=".pdf,image/jpeg,image/png,image/webp"
              style={{ display: 'none' }} onChange={e => setFile(e.target.files[0] || null)} />
          </div>

          <label className="pnf-checkbox-row">
            <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
            <span>Publicar imediatamente</span>
          </label>

        </div>

        <div className="pnf-footer">
          <button onClick={onClose} className="pnf-btn-cancel">Cancelar</button>
          <button onClick={handleSubmit} disabled={!canSubmit} className="pnf-btn-submit">
            {submitting ? 'Publicando...' : published ? 'Publicar nota' : 'Salvar rascunho'}
          </button>
        </div>

      </div>

      <style>{`
        .pnf-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .pnf-modal { background: var(--bg-modal); border: 1px solid var(--border-bright); border-radius: var(--radius-lg); width: min(100%, 600px); max-height: 92vh; overflow-y: auto; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
        .pnf-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; position: sticky; top: 0; background: var(--bg-modal); z-index: 1; }
        .pnf-title { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--gold); letter-spacing: 1px; }
        .pnf-close { background: none; color: var(--text-muted); border: none; padding: 2px; cursor: pointer; transition: color 0.15s; }
        .pnf-close:hover { color: var(--text); }
        .pnf-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
        .pnf-field { display: flex; flex-direction: column; gap: 4px; }
        .pnf-field label { display: flex; align-items: center; gap: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-family: var(--font-display); }
        .pnf-optional { font-size: 9px; color: var(--text-faint); text-transform: none; letter-spacing: 0; font-weight: 400; }
        .pnf-char-count { font-size: 10px; color: var(--text-faint); text-align: right; }
        .pnf-error { font-size: 11px; color: var(--crimson-bright); }
        .pnf-hint  { font-size: 11px; color: #5a9a5a; }
        .pnf-row-2 { display: grid; grid-template-columns: 1fr 140px; gap: 10px; }
        .pnf-row-3 { display: grid; grid-template-columns: 1fr 100px 24px; gap: 8px; align-items: end; }
        .pnf-divider { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-family: var(--font-display); padding: 6px 0 2px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 6px; }

        /* Seções no form */
        .pnf-section { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
        .pnf-section-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(201,168,76,.05); border-bottom: 1px solid var(--border); }
        .pnf-section-label { font-family: var(--font-display); font-size: 11px; font-weight: 700; color: var(--gold); letter-spacing: 1px; text-transform: uppercase; }
        .pnf-entry { padding: 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
        .pnf-entry:last-of-type { border-bottom: none; }
        .pnf-entry-header { display: flex; flex-direction: column; gap: 6px; }

        /* Mudanças no form */
        .pnf-changes-editor { display: flex; flex-direction: column; gap: 5px; padding-left: 8px; border-left: 2px solid var(--border); }
        .pnf-change-row { display: grid; grid-template-columns: 1fr 1fr 14px 1fr 20px; gap: 6px; align-items: center; }
        .pnf-change-row input { font-size: 12px; padding: 4px 7px; }
        .pnf-arrow { text-align: center; color: var(--text-faint); font-size: 12px; }

        .pnf-add-btn { background: none; color: var(--text-faint); font-size: 11px; border: 1px dashed var(--border); border-radius: var(--radius); padding: 3px 8px; cursor: pointer; transition: all 0.15s; align-self: flex-start; margin-top: 2px; }
        .pnf-add-btn:hover { color: var(--gold); border-color: var(--gold-dim); }

        .pnf-add-entry-btn { display: flex; align-items: center; gap: 4px; background: none; color: var(--text-faint); font-size: 11px; padding: 8px 12px; border: none; border-top: 1px solid var(--border); width: 100%; cursor: pointer; transition: color 0.15s; font-family: var(--font-display); letter-spacing: 0.5px; }
        .pnf-add-entry-btn:hover { color: var(--gold); background: rgba(201,168,76,.04); }

        /* Chips de seção */
        .pnf-add-section { display: flex; flex-direction: column; gap: 6px; }
        .pnf-add-section-label { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.5px; font-family: var(--font-display); }
        .pnf-section-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .pnf-section-chip { background: none; border: 1px dashed var(--border); border-radius: var(--radius); color: var(--text-faint); font-size: 11px; padding: 4px 10px; cursor: pointer; transition: all 0.15s; font-family: var(--font-display); }
        .pnf-section-chip:hover { color: var(--gold); border-color: var(--gold-dim); background: rgba(201,168,76,.05); }

        /* Upload */
        .pnf-dropzone { display: flex; align-items: center; gap: 8px; border: 1px dashed var(--border); border-radius: var(--radius); padding: 10px 12px; color: var(--text-faint); font-size: 13px; cursor: pointer; transition: all 0.15s; }
        .pnf-dropzone:hover { border-color: var(--border-bright); color: var(--text); }
        .pnf-dropzone-filled { border-color: var(--gold-dim); color: var(--text); }
        .pnf-remove-file { background: none; color: var(--text-faint); border: none; padding: 0; margin-left: auto; cursor: pointer; }
        .pnf-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); cursor: pointer; }

        /* Botões de ação */
        .pnf-icon-btn { display: flex; align-items: center; justify-content: center; background: none; border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; cursor: pointer; color: var(--text-faint); transition: all 0.15s; flex-shrink: 0; }
        .pnf-icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .pnf-btn-danger:hover:not(:disabled) { color: var(--crimson-bright); border-color: var(--crimson); }

        .pnf-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); flex-shrink: 0; position: sticky; bottom: 0; background: var(--bg-modal); }
        .pnf-btn-cancel { background: none; color: var(--text-faint); border: 1px solid var(--border); border-radius: var(--radius); padding: 7px 16px; font-size: 13px; transition: all 0.15s; cursor: pointer; }
        .pnf-btn-cancel:hover { color: var(--text); border-color: var(--border-bright); }
        .pnf-btn-submit { background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 7px 20px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s; cursor: pointer; }
        .pnf-btn-submit:hover:not(:disabled) { background: var(--crimson-bright); }
        .pnf-btn-submit:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

// ── PatchNotesPage ─────────────────────────────────────────────────────────────
export default function PatchNotesPage() {
  const { user }   = useAuth();
  const isGM       = user?.role === 'GM';
  const [notes,    setNotes]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(isGM ? '/patch-notes/all' : '/patch-notes')
      .then(setNotes).catch(console.error)
      .finally(() => setLoading(false));
  }, [isGM]);

  return (
    <div className="pn-page">
      <div className="pn-page-header">
        <div>
          <h2 className="pn-page-title">📜 Atualizações de Regras</h2>
          <p className="pn-page-sub">Notas de patch e documentos de regras da campanha</p>
        </div>
        {isGM && (
          <button onClick={() => setShowForm(true)} className="pn-new-btn">
            <Plus size={14} /> Nova nota
          </button>
        )}
      </div>

      {loading ? (
        <div className="pn-loading">
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 140, borderRadius: 'var(--radius-lg)' }} />)}
        </div>
      ) : notes.length === 0 ? (
        <div className="pn-empty">
          <BookOpen size={32} style={{ opacity: 0.3 }} />
          <p>Nenhuma nota de patch publicada ainda.</p>
          {isGM && <button onClick={() => setShowForm(true)} className="pn-empty-cta">Criar a primeira nota</button>}
        </div>
      ) : (
        <div className="pn-list">
          {notes.map(note => (
            <PatchNoteCard key={note.id} note={note} isGM={isGM}
              onDeleted={id => setNotes(p => p.filter(n => n.id !== id))}
              onTogglePublish={updated => setNotes(p => p.map(n => n.id === updated.id ? updated : n))}
            />
          ))}
        </div>
      )}

      {showForm && (
        <PatchNoteForm
          onClose={() => setShowForm(false)}
          onCreate={note => setNotes(p => [note, ...p])}
        />
      )}

      <style>{`
        .pn-page { display: flex; flex-direction: column; gap: 20px; max-width: 760px; margin: 0 auto; padding: 24px 16px; }
        .pn-page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .pn-page-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--text); margin: 0 0 4px; }
        .pn-page-sub { font-size: 13px; color: var(--text-faint); margin: 0; }
        .pn-new-btn { display: flex; align-items: center; gap: 6px; background: var(--crimson); color: #f0d0d0; font-family: var(--font-display); font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 8px 16px; border-radius: var(--radius); border: 1px solid rgba(196,48,48,0.3); transition: all 0.15s; white-space: nowrap; cursor: pointer; }
        .pn-new-btn:hover { background: var(--crimson-bright); }
        .pn-loading { display: flex; flex-direction: column; gap: 12px; }
        .pn-list { display: flex; flex-direction: column; gap: 16px; }
        .pn-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 0; color: var(--text-faint); text-align: center; }
        .pn-empty p { font-size: 14px; margin: 0; }
        .pn-empty-cta { background: none; color: var(--gold); border: 1px solid var(--gold-dim); border-radius: var(--radius); padding: 7px 16px; font-size: 13px; font-family: var(--font-display); transition: all 0.15s; cursor: pointer; }
        .pn-empty-cta:hover { background: rgba(201,168,76,0.08); }
      `}</style>
    </div>
  );
}