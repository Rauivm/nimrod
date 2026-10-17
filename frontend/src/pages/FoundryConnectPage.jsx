import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, Link2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../lib/api.js';
import { Badge, Button, PageHeader, StatePanel, useToast } from '../components/ui.jsx';

export default function FoundryConnectPage() {
  const { user } = useAuth();
  const notify = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const proofId = new URLSearchParams(window.location.search).get('proofId');
  const [proof, setProof] = useState(null);
  const [links, setLinks] = useState([]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rows, request] = await Promise.all([
        api.get('/foundry/identity-links'),
        proofId ? api.get(`/foundry/identity/${encodeURIComponent(proofId)}`) : Promise.resolve(null),
      ]);
      setLinks(rows); setProof(request);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [proofId]);
  useEffect(() => { load(); setApproved(false); }, [load]);
  const approve = async () => {
    setBusy(true); setError('');
    try {
      await api.post(`/foundry/identity/${encodeURIComponent(proofId)}/approve`, {});
      setApproved(true); notify('Associação aprovada. Volte ao Foundry para concluir.');
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const revoke = async worldId => {
    if (!window.confirm('Revogar esta associação e invalidar seus acessos pelo módulo Foundry?')) return;
    setBusy(true); setError('');
    try {
      await api.delete(`/foundry/identity-links/${encodeURIComponent(worldId)}`);
      setLinks(previous => previous.filter(row => row.world_id !== worldId));
      notify('Associação revogada.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="foundry-connect-page">
    <PageHeader eyebrow="Uma ponte para sua aventura" title="Conexão com Foundry" description="Associe sua conta com segurança e mantenha seus acessos reunidos." />
    {error && <StatePanel kind="error" title="Não foi possível concluir a operação" action={<Button onClick={load} disabled={busy}>Tentar novamente</Button>}>{error}</StatePanel>}
    <section className="integration-panel" aria-labelledby="foundry-identity-title"><ShieldCheck size={28} aria-hidden="true" /><h2 id="foundry-identity-title">Sua identidade, verificada</h2>
      <p>Conta NIMROD: <strong>{user?.displayName || user?.name}</strong>. O vínculo não altera suas permissões no Foundry.</p>
      {loading ? <p role="status">Conferindo associações…</p> : proof ? <>
        <p>Confirme apenas se você abriu esta solicitação no seu painel NIMROD dentro do Foundry.</p>
        <dl className="integration-details"><div><dt>Mundo</dt><dd>{proof.world_id}</dd></div><div><dt>Conta Foundry</dt><dd>{proof.foundry_user_id}</dd></div><div><dt>Papel solicitado</dt><dd>{proof.requested_gm ? 'Narrador' : 'Jogador'}</dd></div></dl>
        {approved ? <p role="status" className="integration-success">Associação aprovada. Volte ao Foundry para concluir.</p> : <Button variant="primary" disabled={busy} onClick={approve}>{busy ? 'Confirmando…' : 'Confirmar associação com minha conta'}</Button>}
      </> : !error && <p>Para associar uma conta, abra o painel NIMROD dentro do Foundry e inicie o vínculo por lá. A confirmação aparecerá aqui.</p>}
    </section>
    <section className="integration-panel" aria-labelledby="foundry-links-title"><h2 id="foundry-links-title"><Link2 size={20} /> Associações verificadas</h2>
      {!loading && !error && !links.length && <p>Nenhuma associação concluída.</p>}
      <ul className="integration-links">{links.map(link => <li key={link.world_id}><div><strong>Mundo {link.world_id}</strong><p>Conta Foundry: {link.foundry_user_id}</p></div><Badge tone="success">Verificada</Badge><Button variant="danger" disabled={busy} onClick={() => revoke(link.world_id)}>Revogar associação</Button></li>)}</ul>
    </section>
  </section>;
}
