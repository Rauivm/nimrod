import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Bell } from 'lucide-react';
import { Badge, Button } from './ui.jsx';
export default function MissionNotifications() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setItems((await api.get('/notifications')).items);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);
  return <details className="mission-inbox"><summary><Bell size={16} /> Notificações do quadro <Badge>{items.filter(n => !n.read_at).length} não lidas</Badge></summary>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Carregando notificações…</p>}
    {!loading && !error && !items.length && <p>Sem novidades por aqui. Seus convites e alertas de vagas aparecerão neste espaço.</p>}
    <ul>{items.map(n => <li key={n.id}><span>{n.message}</span> {n.mission_id && <Link to={`/missions#mission-${n.mission_id}`}>Ver missão</Link>}
      {!n.read_at && <Button variant="ghost" onClick={async () => {
          try {
            await api.patch(`/notifications/${n.id}`, {});
            await load();
          } catch (e) {
            setError(e.message);
          }
        }}>Marcar como lida</Button>}
    </li>)}</ul>
  </details>;
}
