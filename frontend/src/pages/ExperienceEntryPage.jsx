import { useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Gamepad2, Scroll, Users, MessageCircle, Compass } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useExperience } from '../contexts/ExperienceContext.jsx';
import HomePage from './HomePage.jsx';
import '../styles/experience.css';

export default function ExperienceEntryPage() {
  const { user } = useAuth();
  const { mode, chooseMode } = useExperience();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const returnToClassic = params.get('experience') === 'classic';
  useEffect(() => {
    if (!returnToClassic || !user) return;
    chooseMode('classic');
    const next = new URLSearchParams(params);
    next.delete('experience');
    setParams(next, { replace: true });
  }, [returnToClassic, user, chooseMode, params, setParams]);
  if (returnToClassic || mode === 'classic') return <HomePage />;
  if (mode === 'game') return <Navigate to="/lobby" replace />;

  function enter(next) {
    chooseMode(next);
    if (next === 'game') navigate('/lobby');
  }

  return (
    <section className="experience-entry" aria-labelledby="experience-title">
      <header className="experience-heading">
        <span className="experience-eyebrow">A mesma comunidade. Duas formas de chegar.</span>
        <h1 id="experience-title">Seu próximo encontro<br />começa aqui.</h1>
        <p>Um lugar à mesa, uma boa conversa e histórias por vir. Escolha como entrar no Nimrod.</p>
      </header>
      <div className="experience-options">
        <article className="experience-card">
          <Scroll className="experience-card-icon" size={32} />
          <span className="experience-eyebrow">O Nimrod que você conhece</span>
          <h2>Modo Clássico</h2>
          <p>Acompanhe o mural, organize missões e cuide dos seus personagens nas páginas de sempre.</p>
          <ul><li>Mural da comunidade</li><li>Missões e calendário</li><li>Perfil e personagens</li></ul>
          <button className="experience-enter" onClick={() => enter('classic')} disabled={!user}>
            Continuar no modo clássico <ArrowRight size={17} />
          </button>
        </article>
        <article className="experience-card experience-card-game">
          <Gamepad2 className="experience-card-icon" size={32} />
          <span className="experience-eyebrow">Uma porta para a taverna</span>
          <h2>Modo Jogo</h2>
          <p>Entre com seu personagem em uma inn compartilhada. Encontre outros jogadores antes da próxima aventura.</p>
          <ul><li><Users size={15} /> Presença multiplayer</li><li><MessageCircle size={15} /> Conversa e convivência</li><li><Compass size={15} /> Mural de aventuras</li></ul>
          <button className="experience-enter" onClick={() => enter('game')} disabled={!user}>
            Conhecer a taverna <ArrowRight size={17} />
          </button>
        </article>
      </div>
      <p className="experience-preference">Sua escolha fica salva neste navegador, por conta. Você pode trocar de modo pelo menu a qualquer momento.</p>
      {!user && <p role="status">Entre na sua conta Nimrod para escolher sua experiência.</p>}
    </section>
  );
}
