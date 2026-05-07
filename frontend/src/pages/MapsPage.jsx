import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Upload, Download, Trash2, Map } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { optimizeImageFile } from '../lib/imageOptimization.js';

export default function MapsPage() {
  const { user } = useAuth();
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();
  const [uploadForm, setUploadForm] = useState({ title: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.get('/maps').catch(() => []);
    setMaps(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return alert('Selecione um arquivo');

    setUploading(true);
    try {
      const uploadFile = await optimizeImageFile(file);
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('title', uploadForm.title || file.name);
      fd.append('description', uploadForm.description);

      const created = await api.uploadMap(fd);
      setUploadForm({ title: '', description: '' });
      fileRef.current.value = '';
      const optimisticMap = { ...created, uploader_name: user?.displayName || user?.name || created.uploader_name };
      setMaps(prev => prev.some(m => m.id === created.id) ? prev : [optimisticMap, ...prev]);
    } catch (e) { alert(e.message); }
    setUploading(false);
  };

  const del = async (id) => {
    if (!confirm('Remover este mapa?')) return;
    try {
      await api.delete(`/maps/${id}`);
      load();
    } catch (e) { alert(e.message); }
  };

  const isGM = user?.role === 'GM';

  return (
    <div className="maps-page">
      <div className="page-header">
        <h1 className="page-title">🗺 Mapas</h1>
      </div>

      {isGM && (
        <div className="upload-section">
          <h2 className="section-title">Enviar Mapa</h2>
          <form onSubmit={upload} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="form-row">
              <div className="form-group">
                <label>Título</label>
                <input value={uploadForm.title} onChange={e => setUploadForm(p => ({...p, title: e.target.value}))} placeholder="Nome do mapa" />
              </div>
              <div className="form-group">
                <label>Arquivo *</label>
                <input type="file" ref={fileRef} accept="image/*,.pdf" required style={{ padding: '6px' }} />
              </div>
            </div>
            <div className="form-group">
              <label>Descrição</label>
              <input value={uploadForm.description} onChange={e => setUploadForm(p => ({...p, description: e.target.value}))} placeholder="Opcional..." />
            </div>
            <button type="submit" disabled={uploading} className="upload-btn">
              <Upload size={14} /> {uploading ? 'Enviando...' : 'Enviar Mapa'}
            </button>
          </form>
        </div>
      )}

      <div className="maps-grid">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '80px' }} />)
        ) : maps.length === 0 ? (
          <div className="empty-state">
            <Map size={32} style={{ opacity: 0.2 }} />
            <span>Nenhum mapa disponível</span>
          </div>
        ) : (
          maps.map(m => (
            <div key={m.id} className="map-card animate-in">
              <div className="map-icon">🗺</div>
              <div className="map-info">
                <h3 className="map-title">{m.title}</h3>
                {m.description && <p className="map-desc">{m.description}</p>}
                <span className="map-meta">
                  por {m.uploader_name} · {format(new Date(m.created_at), "dd/MM/yyyy", { locale: ptBR })}
                </span>
              </div>
              <div className="map-actions">
                <a href={m.file_url} download={m.file_name} className="download-btn" title="Baixar">
                  <Download size={14} />
                </a>
                {isGM && (
                  <button onClick={() => del(m.id)} className="map-delete-btn">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        .maps-page { max-width: 800px; margin: 0 auto; }
        .page-header { margin-bottom: 20px; }
        .page-title { font-family: var(--font-display); font-size: 20px; color: var(--gold); letter-spacing: 3px; text-transform: uppercase; }
        .upload-section {
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 20px; margin-bottom: 24px;
        }
        .section-title { font-family: var(--font-display); font-size: 13px; color: var(--text-muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 14px; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
        .upload-btn {
          display: flex; align-items: center; gap: 8px;
          background: var(--crimson); color: #f0d0d0;
          font-family: var(--font-display); font-size: 12px; font-weight: 600;
          letter-spacing: 1px; text-transform: uppercase;
          padding: 9px 20px; border-radius: var(--radius);
          border: 1px solid rgba(196,48,48,0.3);
          align-self: flex-start; transition: all 0.15s;
        }
        .upload-btn:hover:not(:disabled) { background: var(--crimson-bright); }
        .upload-btn:disabled { opacity: 0.5; }
        .maps-grid { display: flex; flex-direction: column; gap: 10px; }
        .map-card {
          background: var(--bg-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 14px;
          display: flex; gap: 14px; align-items: center;
          transition: border-color 0.15s;
        }
        .map-card:hover { border-color: var(--border-bright); }
        .map-icon { font-size: 24px; flex-shrink: 0; }
        .map-info { flex: 1; }
        .map-title { font-family: var(--font-display); font-size: 15px; color: var(--text); font-weight: 600; }
        .map-desc { font-size: 13px; color: var(--text-muted); margin-top: 2px; }
        .map-meta { font-size: 12px; color: var(--text-faint); margin-top: 4px; display: block; }
        .map-actions { display: flex; gap: 6px; align-items: center; }
        .download-btn {
          display: flex; align-items: center; justify-content: center;
          padding: 6px 10px; border-radius: var(--radius);
          background: rgba(42,138,88,0.1); color: var(--emerald-bright);
          border: 1px solid rgba(42,138,88,0.3); transition: all 0.15s;
        }
        .download-btn:hover { background: rgba(42,138,88,0.2); }
        .map-delete-btn { background: none; border: none; color: var(--text-faint); padding: 4px; transition: color 0.15s; }
        .map-delete-btn:hover { color: var(--crimson-bright); }
        .empty-state {
          display: flex; flex-direction: column; align-items: center; gap: 12px;
          padding: 48px; color: var(--text-muted);
          border: 1px dashed var(--border); border-radius: var(--radius-lg);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
