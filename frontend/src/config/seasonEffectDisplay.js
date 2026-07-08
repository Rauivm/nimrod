/**
 * src/config/seasonEffectDisplay.js
 *
 * Único lugar que decide como um efeito de estação é desenhado (ícone e
 * texto do badge), a partir do `kind` retornado pela API
 * (`GET /world/calendar` ou `/world/calendar/effects/:seasonKey`).
 *
 * Os efeitos em si (perícia, vantagem/desvantagem, multiplicador de preço)
 * são dados do banco (season_effects), editáveis pelo GM — este arquivo só
 * cuida da apresentação, igual `calendarSeasons.js` cuida da apresentação
 * da estação.
 */

import { TrendingUp, TrendingDown, Coins, Sparkles } from 'lucide-react';

const ICON_BY_MODE = {
  advantage: TrendingUp,
  disadvantage: TrendingDown,
};

const MODE_LABEL = {
  advantage: 'Vantagem',
  disadvantage: 'Desvantagem',
};

/**
 * Ícone a usar para um efeito, de acordo com o `kind`:
 *  - 'check'  → seta de tendência (cima = vantagem, baixo = desvantagem)
 *  - 'price'  → moeda
 *  - 'custom' → estrela (efeito só de lore, sem mecânica)
 */
export function getEffectIcon(effect) {
  if (effect.kind === 'check') return ICON_BY_MODE[effect.mode] ?? Sparkles;
  if (effect.kind === 'price') return Coins;
  return Sparkles;
}

/**
 * Texto curto do "badge" ao lado do efeito:
 *  - 'check'  → "Vantagem" / "Desvantagem"
 *  - 'price'  → variação percentual, ex: "+30%" ou "-20%"
 *  - 'custom' → null (não tem badge, só o texto do efeito)
 */
export function getEffectBadge(effect) {
  if (effect.kind === 'check') return MODE_LABEL[effect.mode] ?? null;
  if (effect.kind === 'price' && typeof effect.priceMultiplier === 'number') {
    const pct = Math.round((effect.priceMultiplier - 1) * 100);
    return `${pct > 0 ? '+' : ''}${pct}%`;
  }
  return null;
}
