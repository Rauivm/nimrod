import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { InteractionId } from '../world/tavernMap';
import { hubConfig } from '../config/hubConfig';

const details: Record<InteractionId, { title: string; description: string }> = {
  bar: { title: 'Balcão', description: 'Um ponto de encontro junto às bebidas da taverna. Atendimento por NPCs ainda não está disponível.' },
  music: { title: 'Recanto dos músicos', description: 'O palco está preparado com instrumentos. Músicos e interações musicais ainda não estão disponíveis.' },
  fire: { title: 'Lareira', description: 'A lareira ilumina o salão. Este é um espaço de convivência, sem combate ou efeitos sobre atributos do personagem.' },
  missions: { title: 'Mural de missões', description: 'Consulte as aventuras no quadro existente do Nimrod. Detalhes, vagas e inscrições continuam seguindo suas regras e permissões atuais.' },
  entrance: { title: 'Portal do Foundry', description: 'A passagem leva à sua mesa no Foundry VTT. O acesso usa a integração e as permissões já existentes da sua conta Nimrod. A seleção na taverna não troca automaticamente o Actor controlado na mesa.' },
};

export function HubInteraction({ id, onClose, foundryAction }: { id: InteractionId; onClose: () => void; foundryAction: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [id]);
  const detail = details[id];
  return <section className="social-hub-interaction" aria-labelledby="hub-interaction-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }}>
    <header><h2 ref={heading} tabIndex={-1} id="hub-interaction-title">{detail.title}</h2>
      <button type="button" aria-label="Fechar interação" onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
    <p>{detail.description}</p>
    {id === 'missions' && <Link className="ui-button ui-button-secondary" to={hubConfig.routes.missions}>Abrir missões do Nimrod</Link>}
    {id === 'entrance' && <div className="social-hub-interaction-actions">{foundryAction}
      <Link to={hubConfig.routes.foundryConnection}>Gerenciar conexão com Foundry</Link></div>}
  </section>;
}
