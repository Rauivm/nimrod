import { classPresets, travelerPreset } from './classPresets';
import type { ClassPreset } from './classPresets';

export type AvatarSlot = 'body' | 'outfit' | 'mainHand' | 'offHand' | 'accessory' | 'back';
export interface AvatarLayer {
  slot: AvatarSlot;
  preset: ClassPreset;
  frontOrder: number;
  backOrder: number;
}
export interface AvatarAppearance {
  preset: ClassPreset;
  matchedClasses: readonly ClassPreset[];
  fallback: boolean;
  equipmentSource: 'visual-preset';
  layers: readonly AvatarLayer[];
  subclassLabel: string | null;
}
export interface SubclassVisualRule { parentId: string; aliases: readonly string[]; preset: ClassPreset }

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** First recognized class in the API's text order; no class levels/subclass are invented. */
export function resolveAppearance(classe: string | null, catalog: readonly ClassPreset[] = classPresets, subclassRules: readonly SubclassVisualRule[] = []): AvatarAppearance {
  const source = ` ${normalize(classe ?? '')} `;
  const matched = catalog.flatMap(preset => {
    const positions = preset.aliases.map(alias => source.indexOf(` ${normalize(alias)} `)).filter(index => index >= 0);
    return positions.length ? [{ preset, position: Math.min(...positions) }] : [];
  }).sort((a, b) => a.position - b.position);
  const primary = matched[0]?.preset;
  const variant = subclassRules.find(rule => rule.parentId === primary?.id
    && rule.aliases.some(alias => source.includes(` ${normalize(alias)} `)));
  const preset = variant?.preset ?? primary ?? travelerPreset;
  return {
    preset, matchedClasses: matched.map(match => match.preset), fallback: matched.length === 0,
    // The current API has no equipped-item contract. Never read fictional inventory here.
    equipmentSource: 'visual-preset',
    subclassLabel: variant?.preset.label ?? null,
    layers: [{ slot: 'body', preset, frontOrder: 0, backOrder: 0 }],
  };
}
