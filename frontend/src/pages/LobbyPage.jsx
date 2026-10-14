import { useCallback, useEffect, useState } from 'react';
import { Gamepad2, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function LobbyPage() {
  const { user } = useAuth();
  const [characters, setCharacters] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [failedImage, setFailedImage] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/me/characters').then(rows => {
      if (cancelled) return;
      const eligible = rows.filter(c => c.active && !c.retired && !c.dead);
      setCharacters(eligible);
      setSelected(previous => eligible.some(c => c.id === previous) ? previous : eligible.length === 1 ? eligible[0].id : '');
    }).catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, revision]);
  const launch = useCallback(async () => {
    if (!selected || launching) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setLaunching(true);
    setError('');
    try {
      const result = await api.post('/mana/launch', { character_id: selected });
      if (tab) tab.location.replace(result.url);
      else window.location.assign(result.url);
    } catch (err) { tab?.close(); setError(err.message); }
    finally { setLaunching(false); }
  }, [selected, launching]);
  const character = characters.find(c => c.id === selected);
  const image = character?.tokenImg || character?.portraitImg;
  return (
    <section className="lobby-entry animate-in" aria-labelledby="lobby-title">
      <header><h1 id="lobby-title">Saguão da Taverna</h1>
        <button className="btn btn-ghost" title="Atualizar personagens" aria-label="Atualizar personagens"
          disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={18} /></button></header>
      {error && <p role="alert" className="lobby-error">{error}</p>}
      {loading ? <p role="status">Carregando personagens...</p> : <>
        {!characters.length && !error && <p>Nenhum personagem elegível vinculado à sua conta. Vincule um personagem no Perfil.</p>}
        {!!characters.length && <div className="lobby-character">
          {image && failedImage !== image && <img src={image.startsWith('/') || image.startsWith('https://') ? image : `/api/foundry/assets?path=${encodeURIComponent(image)}`} alt={character.name} onError={() => setFailedImage(image)} />}
          <div><label htmlFor="lobby-character">Personagem</label>
            <select id="lobby-character" value={selected} disabled={launching} onChange={e => setSelected(e.target.value)}>
              <option value="" disabled>Selecione um personagem</option>
              {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {character && <p>{character.name} · Nível {character.level ?? 1}</p>}
            <button className="mana-launch" disabled={!selected || launching} onClick={launch}>
              <Gamepad2 size={18} /><span>{launching ? 'Entrando...' : character ? `Entrar como ${character.name}` : 'Entrar no saguão'}</span>
            </button>
          </div>
        </div>}
      </>}
    </section>
  );
}
