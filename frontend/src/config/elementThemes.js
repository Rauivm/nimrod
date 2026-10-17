export const DEFAULT_ELEMENT = 'nimrod';

// Identity and copy live here; palette values live only in elemental.css.
export const ELEMENT_THEMES = [
  { id: 'nimrod', name: 'NIMROD', epithet: 'O encontro dos elementos', description: 'Ouro antigo e equilíbrio. A assinatura original da comunidade.', icon: 'compass' },
  { id: 'fire', name: 'Fogo', epithet: 'A chama da coragem', description: 'Cobre e âmbar para quem abre novos caminhos.', icon: 'flame' },
  { id: 'water', name: 'Água', epithet: 'A memória das marés', description: 'Azul mineral e reflexos suaves de águas profundas.', icon: 'water' },
  { id: 'earth', name: 'Terra', epithet: 'As raízes da jornada', description: 'Oliva e pedra, como uma fortaleza entre antigas florestas.', icon: 'mountain' },
  { id: 'air', name: 'Ar', epithet: 'O chamado do horizonte', description: 'Prata e névoa para histórias que atravessam fronteiras.', icon: 'wind' },
  { id: 'light', name: 'Luz', epithet: 'A promessa da aurora', description: 'Marfim e ouro pálido, com a serenidade do amanhecer.', icon: 'sun' },
  { id: 'shadow', name: 'Sombra', epithet: 'Os segredos do crepúsculo', description: 'Ametista e violeta para os mistérios entre capítulos.', icon: 'moon' },
];

export function normalizeElement(value) {
  return ELEMENT_THEMES.some(theme => theme.id === value) ? value : DEFAULT_ELEMENT;
}

export const elementStorageKey = userId => `nimrod:element:${userId || 'guest'}`;

export function readElementPreference(storage, userId) {
  try { return normalizeElement(storage.getItem(elementStorageKey(userId))); }
  catch { return DEFAULT_ELEMENT; }
}

export function saveElementPreference(storage, userId, value) {
  if (normalizeElement(value) !== value) return false;
  try { storage.setItem(elementStorageKey(userId), value); return true; }
  catch { return false; }
}
