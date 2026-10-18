import { Outlet, NavLink, Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth, roleLabel, isGM } from '../contexts/AuthContext.jsx';
import { useWs } from '../contexts/WsContext.jsx';
import { useExperience } from '../contexts/ExperienceContext.jsx';
import { Sword, Skull, Map, Scroll, Wifi, WifiOff, ExternalLink, Pencil, UserCircle, BookOpen, Calendar, Compass, Gamepad2, Menu, X, Bell, Shield } from 'lucide-react';
import EditDisplayNameModal from './EditDisplayNameModal.jsx';
import { useFoundryLaunch } from '../hooks/useFoundryLaunch.js';
import { Button, useToast } from './ui.jsx';
import BrandSeal from './BrandSeal.jsx';
import ElementThemePicker, { ElementIcon } from './ElementThemePicker.jsx';
import { useElementTheme } from '../contexts/ElementThemeContext.jsx';
import '../styles/layout.css';
import { hubConfig } from '../features/social-hub/config/hubConfig';

const groups = [
  { title: 'Sua jornada', items: [
    { to: '/', label: 'Comunidade', icon: Scroll, mode: 'classic', end: true },
    { to: '/missions', label: 'Quadro de Avisos', icon: Sword },
    { to: '/sidequests', label: 'Side Quests', icon: Compass },
    { to: '/lobby', label: 'Taverna · Modo Jogo', icon: Gamepad2, mode: 'game', end: true },
    { to: hubConfig.routes.html5, label: 'Taverna HTML5 · Experimental', icon: Gamepad2, mode: 'game' },
  ] },
  { title: 'O mundo', items: [
    { to: '/calendar', label: 'Calendário', icon: Calendar },
    { to: '/maps', label: 'Mapas', icon: Map },
    { to: '/cemetery', label: 'Cemitério', icon: Skull },
    { to: '/patch-notes', label: 'Atualizações', icon: Bell },
  ] },
  { title: 'Sua conta', items: [
    { to: '/profile', label: 'Perfil e personagens', icon: UserCircle },
    { to: '/foundry-connect', label: 'Conexão com Foundry', icon: Shield },
    { to: '/gm/sessions', label: 'Sessões', icon: BookOpen, gm: true },
  ] },
];

export default function Layout() {
  const { user } = useAuth();
  const { connected } = useWs();
  const { chooseMode } = useExperience();
  const { launch, loading, error: launchError } = useFoundryLaunch();
  const notify = useToast();
  useEffect(() => { if (launchError) notify(launchError, 'error'); }, [launchError, notify]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const { theme } = useElementTheme();
  const location = useLocation();
  const menuButton = useRef(null);
  const sidebar = useRef(null);
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    setMenuOpen(false);
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    const frame = requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector('button')?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
      if (event.key === 'Tab') {
        const items = [...sidebar.current.querySelectorAll('button, a[href]')];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const handleResize = () => { if (window.innerWidth > 1024) setMenuOpen(false); };
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleResize);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); window.removeEventListener('resize', handleResize); };
  }, [menuOpen]);
  const closeMenu = () => { setMenuOpen(false); menuButton.current?.focus(); };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
    <header className="app-topbar">
      <button ref={menuButton} className="ui-button ui-button-ghost ui-icon-button mobile-menu-button" aria-label="Abrir navegação" aria-expanded={menuOpen} aria-controls="app-navigation" onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
      <Link className="app-brand" to="/" onClick={() => chooseMode('classic')} aria-label="Nimrod · Comunidade"><BrandSeal /><span>NIMROD<small>O encontro dos elementos</small></span></Link>
      <div className="app-topbar-actions">
        <span className={connected ? 'connection-status is-connected' : 'connection-status'} role="status" title={connected ? 'Atualizações em tempo real conectadas' : 'Reconectando atualizações'}>{connected ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{connected ? 'Ao vivo' : 'Reconectando'}</span></span>
        <Button variant="ghost" className="element-trigger" aria-label="Escolher tema elemental" data-tooltip={`Afinidade: ${theme.name}`} onClick={() => setShowThemes(true)}><ElementIcon icon={theme.icon} /><span>{theme.name}</span></Button>
        <Button variant="primary" className="app-foundry" aria-label={isGM(user) ? 'Iniciar aventura' : 'Entrar na aventura'} onClick={launch} disabled={loading}><Sword size={17} /><span className="app-foundry-label">{loading ? 'Abrindo…' : isGM(user) ? 'Iniciar aventura' : 'Entrar na aventura'}</span><span className="app-foundry-short" aria-hidden="true">{loading ? '…' : 'Jogar'}</span><ExternalLink size={14} /></Button>
      </div>
    </header>
    {menuOpen && <div className="app-menu-backdrop" aria-hidden="true" onClick={closeMenu} />}
    <aside ref={sidebar} id="app-navigation" className={menuOpen ? 'app-sidebar is-open' : 'app-sidebar'} role={menuOpen ? 'dialog' : undefined} aria-modal={menuOpen || undefined} aria-label="Navegação principal">
      <div className="app-sidebar-mobile-heading"><strong>Explorar NIMROD</strong><Button variant="ghost" className="ui-icon-button" aria-label="Fechar navegação" onClick={closeMenu}><X size={20} /></Button></div>
      <nav aria-label="Menu principal">{groups.map(group => <div className="app-nav-group" key={group.title}>
        <p>{group.title}</p>{group.items.filter(item => !item.gm || isGM(user)).map(({ to, label, icon: Icon, mode, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'app-nav-link active' : 'app-nav-link'} onClick={() => { if (mode) chooseMode(mode); setMenuOpen(false); }}><Icon size={18} /><span>{label}</span></NavLink>)}
      </div>)}</nav>
      {user && <div className="app-account"><span className="app-account-avatar">{(user.displayName || user.name || '?')[0]}</span><div><Link to="/profile">{user.displayName || user.name}</Link><small>{roleLabel(user.role)}</small></div><Button variant="ghost" className="ui-icon-button" aria-label="Editar nome de exibição" onClick={() => setShowEdit(true)}><Pencil size={15} /></Button></div>}
      <p className="app-sidebar-footnote"><span className="element-affinity-mark"><ElementIcon icon={theme.icon} size={14} /></span>{theme.epithet}</p>
    </aside>
    <div className="app-workspace" inert={menuOpen ? '' : undefined}><main id="main-content" className="site-main" tabIndex={-1}><Outlet /></main><footer className="app-footer"><span>NIMROD</span> Um mundo. Infinitas histórias.</footer></div>
    {showEdit && <EditDisplayNameModal onClose={() => setShowEdit(false)} />}
    {showThemes && <ElementThemePicker onClose={() => setShowThemes(false)} />}
  </div>;
}
