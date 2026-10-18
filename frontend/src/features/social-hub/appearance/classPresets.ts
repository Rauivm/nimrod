export type AvatarSheetId = 'martial' | 'arcane' | 'primal' | 'traveler';
export interface ClassPreset {
  id: string;
  label: string;
  aliases: readonly string[];
  sheet: AvatarSheetId;
  row: number;
  visualEquipment: readonly string[];
}

/** Data-only catalog: localized classes/subclass aliases can be extended here. */
export const classPresets: readonly ClassPreset[] = [
  { id: 'fighter', label: 'Guerreiro', aliases: ['guerreiro', 'guerreira', 'fighter'], sheet: 'martial', row: 0, visualEquipment: ['Armadura', 'Espada', 'Escudo'] },
  { id: 'paladin', label: 'Paladino', aliases: ['paladino', 'paladina', 'paladin'], sheet: 'martial', row: 1, visualEquipment: ['Armadura pesada', 'Símbolo sagrado', 'Espada e escudo'] },
  { id: 'ranger', label: 'Patrulheiro', aliases: ['patrulheiro', 'patrulheira', 'ranger'], sheet: 'martial', row: 2, visualEquipment: ['Arco', 'Aljava', 'Capa'] },
  { id: 'rogue', label: 'Ladino', aliases: ['ladino', 'ladina', 'rogue'], sheet: 'martial', row: 3, visualEquipment: ['Armadura leve', 'Capuz', 'Adagas'] },
  { id: 'wizard', label: 'Mago', aliases: ['mago', 'maga', 'wizard'], sheet: 'arcane', row: 0, visualEquipment: ['Túnica', 'Cajado'] },
  { id: 'sorcerer', label: 'Feiticeiro', aliases: ['feiticeiro', 'feiticeira', 'sorcerer'], sheet: 'arcane', row: 1, visualEquipment: ['Vestes arcanas', 'Foco visual'] },
  { id: 'warlock', label: 'Bruxo', aliases: ['bruxo', 'bruxa', 'warlock'], sheet: 'arcane', row: 2, visualEquipment: ['Vestimenta sombria', 'Foco arcano'] },
  { id: 'cleric', label: 'Clérigo', aliases: ['clerigo', 'cleriga', 'cleric'], sheet: 'arcane', row: 3, visualEquipment: ['Vestes religiosas', 'Símbolo sagrado', 'Livro'] },
  { id: 'druid', label: 'Druida', aliases: ['druida', 'druid'], sheet: 'primal', row: 0, visualEquipment: ['Vestes naturais', 'Cajado'] },
  { id: 'bard', label: 'Bardo', aliases: ['bardo', 'barda', 'bard'], sheet: 'primal', row: 1, visualEquipment: ['Vestes de artista', 'Instrumento musical'] },
  { id: 'barbarian', label: 'Bárbaro', aliases: ['barbaro', 'barbara', 'barbarian'], sheet: 'primal', row: 2, visualEquipment: ['Vestes rústicas', 'Machado embainhado'] },
  { id: 'monk', label: 'Monge', aliases: ['monge', 'monja', 'monk'], sheet: 'primal', row: 3, visualEquipment: ['Roupas leves', 'Faixas de tecido'] },
];

export const travelerPreset: ClassPreset = {
  id: 'traveler', label: 'Viajante', aliases: [], sheet: 'traveler', row: 0, visualEquipment: ['Traje neutro, sem arma ou armadura de classe'],
};
