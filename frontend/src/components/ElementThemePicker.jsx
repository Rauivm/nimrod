import { useId } from 'react';
import { Compass, Flame, Droplets, Mountain, Wind, Sun, MoonStar, Check } from 'lucide-react';
import { ELEMENT_THEMES } from '../config/elementThemes.js';
import { useElementTheme } from '../contexts/ElementThemeContext.jsx';
import BrandSeal from './BrandSeal.jsx';
import { Button, Modal } from './ui.jsx';

const ICONS = { compass: Compass, flame: Flame, water: Droplets, mountain: Mountain, wind: Wind, sun: Sun, moon: MoonStar };
export function ElementIcon({ icon, size = 18, ...props }) {
  const Icon = ICONS[icon] || Compass;
  return <Icon size={size} aria-hidden="true" {...props} />;
}

export default function ElementThemePicker({ onClose }) {
  const { theme, chooseTheme, persisted } = useElementTheme();
  const groupId = useId();
  return <Modal title="Sua afinidade elemental" onClose={onClose} wide>
    <div className="element-picker-intro"><BrandSeal /><p>Uma comunidade, muitas formas de pertencer. Escolha o elemento que acompanha sua jornada.</p></div>
    <fieldset className="element-picker-fieldset" aria-describedby={`${groupId}-help`}>
      <legend>Escolha seu tema</legend>
      <p id={`${groupId}-help`} className="ui-form-help">A mudança aparece imediatamente. O tema NIMROD preserva a assinatura original.</p>
      <div className="element-options">{ELEMENT_THEMES.map(option => <label key={option.id} className="element-option" data-element={option.id}>
        <input type="radio" name={groupId} value={option.id} aria-label={option.name} checked={theme.id === option.id} onChange={() => chooseTheme(option.id)} aria-describedby={`${groupId}-${option.id}-description`} />
        <span className="element-option-glyph">{option.id === 'nimrod' ? <BrandSeal /> : <ElementIcon icon={option.icon} size={26} />}</span>
        <span className="element-option-copy"><strong>{option.name}</strong><span>{option.epithet}</span></span>
        <span className="element-option-check" aria-hidden="true"><Check size={16} /></span>
        <span className="element-option-description" id={`${groupId}-${option.id}-description`}>{option.description}</span>
      </label>)}</div>
    </fieldset>
    <p className="element-preference-status" role="status" aria-live="polite">{persisted ? `${theme.name} ativo. Sua escolha é lembrada nesta conta e navegador.` : `${theme.name} aplicado nesta sessão. O navegador não permitiu salvar sua preferência.`}</p>
    <div className="ui-dialog-footer"><Button variant="primary" onClick={onClose}>Continuar a jornada</Button></div>
  </Modal>;
}
