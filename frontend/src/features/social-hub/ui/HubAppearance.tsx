import { resolveAppearance } from '../appearance/resolveAppearance';

export function HubAppearance({ classe }: { classe: string | null }) {
  const appearance = resolveAppearance(classe);
  return <details className="social-hub-appearance">
    <summary>Aparência: {appearance.preset.label}{appearance.fallback ? ' (traje neutro)' : ''}</summary>
    <p>{appearance.fallback ? 'Classe ausente ou sem preset reconhecido. Usando traje neutro.' : `Preset visual de ${appearance.preset.label}.`} Peças ilustrativas: {appearance.preset.visualEquipment.join(', ')}.</p>
    <p>Essas peças não adicionam itens à ficha e não representam uma consulta ao inventário equipado.</p>
    {appearance.matchedClasses.length > 1 && <p>Multiclasse: {appearance.matchedClasses.map(preset => preset.label).join(', ')}. A primeira classe reconhecida no texto da ficha define o visual; não há níveis por classe para priorizar.</p>}
    <p>Corpo genérico do preset, sem personalização de raça ou gênero. O retrato da ficha é preservado.</p>
  </details>;
}
