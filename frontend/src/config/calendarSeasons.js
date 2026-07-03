/**
 * src/config/calendarSeasons.js
 *
 * Fonte única de verdade para tudo que é VISUAL/apresentacional sobre as
 * estações no frontend (cores, imagens, ícone, efeitos de lore).
 *
 * A ordem cronológica e o cálculo de ano/semana/sessão continuam vindo do
 * backend (CalendarService) — este arquivo não decide "que estação é agora",
 * só como desenhar a estação que a API retornou.
 *
 * Nenhum componente deve ter `if (season === 'Inverno')` espalhado pelo
 * código. Toda decisão visual passa pelos helpers deste arquivo.
 *
 * Para trocar a arte de uma estação: troque o arquivo em
 * `public/images/seasons/` ou o caminho abaixo — nenhum componente React
 * precisa ser tocado.
 *
 * Para o futuro (clima, FXMaster, modificadores de regra): adicione campos
 * novos aqui dentro do objeto da estação (ex: `weatherProfile`,
 * `foundryPlaylist`, `ruleModifiers`) — o componente continua só consumindo.
 */

import {
  Snowflake, Flower2, Sun, Leaf,
  Footprints, ShieldAlert, Coins, Home,
  Bug, PartyPopper, CloudRain, Heart, Wheat,
} from 'lucide-react';

// ── Quantas semanas de estação usam a arte "early" antes de trocar pra "late" ──
// Estação tem 12 semanas (regra do CalendarService). 1–6 → early, 7–12 → late.
export const SEASON_STAGE_THRESHOLD = 6;

// ── Configuração por estação ─────────────────────────────────────────────────
export const SEASONS = {
  WINTER: {
    key: 'WINTER',
    name: 'Inverno',
    accentColor: '#7ec8e3',
    textColor: '#bcdcef',
    cardBackground: 'linear-gradient(180deg, #0d1830 0%, #16233f 40%, #1c2c48 100%)',
    groundTint: 'rgba(210,225,240,0.14)',
    icon: Snowflake,
    tagline: 'Frio intenso. Rastreio e sobrevivência mais difíceis; alimento e pousada custam mais.',
    images: {
      early: '/images/seasons/winter-early.webp',
      late: '/images/seasons/winter-late.webp',
    },
    effects: [
      { icon: Footprints, text: 'Aumento da dificuldade de rastreio' },
      { icon: ShieldAlert, text: 'Aumento da dificuldade de sobrevivência' },
      { icon: Coins, text: 'Alimentos mais caros' },
      { icon: Home, text: 'Estadia mais cara' },
    ],
  },

  SPRING: {
    key: 'SPRING',
    name: 'Primavera',
    accentColor: '#7dd68a',
    textColor: '#cdeed2',
    cardBackground: 'linear-gradient(180deg, #142a1c 0%, #1c3a26 40%, #24462e 100%)',
    groundTint: 'rgba(140,220,150,0.14)',
    icon: Flower2,
    tagline: 'Início do ano. Mais bestas e doenças no ar, mas o custo de alimentos cai — época de festas de colheita.',
    images: {
      early: '/images/seasons/spring-early.webp',
      late: '/images/seasons/spring-late.webp',
    },
    effects: [
      { icon: Bug, text: 'Aumento no número de bestas e doenças' },
      { icon: Coins, text: 'Redução no custo de alimentos' },
      { icon: PartyPopper, text: 'Início do ano — festas de colheita' },
    ],
  },

  SUMMER: {
    key: 'SUMMER',
    name: 'Verão',
    accentColor: '#e8c56a',
    textColor: '#f6e6ac',
    cardBackground: 'linear-gradient(180deg, #2c2410 0%, #3d3216 40%, #4a3d1c 100%)',
    groundTint: 'rgba(232,197,106,0.16)',
    icon: Sun,
    tagline: 'Calor forte e tempestades. Rastreio mais fácil — é a época de reprodução da maioria das bestas.',
    images: {
      early: '/images/seasons/summer-early.webp',
      late: '/images/seasons/summer-late.webp',
    },
    effects: [
      { icon: CloudRain, text: 'Calor intenso e chuvas fortes' },
      { icon: Footprints, text: 'Facilidade de rastreio' },
      { icon: Heart, text: 'Época de reprodução das bestas' },
    ],
  },

  AUTUMN: {
    key: 'AUTUMN',
    name: 'Outono',
    accentColor: '#d98e4a',
    textColor: '#f0cba0',
    cardBackground: 'linear-gradient(180deg, #241408 0%, #331c0c 40%, #402410 100%)',
    groundTint: 'rgba(217,142,74,0.16)',
    icon: Leaf,
    tagline: 'Fim do ano. Escassez de alimentos e dificuldade moderada em rastreio e sobrevivência.',
    images: {
      early: '/images/seasons/autumn-early.webp',
      late: '/images/seasons/autumn-late.webp',
    },
    effects: [
      { icon: Wheat, text: 'Escassez de alimentos' },
      { icon: Footprints, text: 'Dificuldade moderada de rastreio' },
      { icon: ShieldAlert, text: 'Dificuldade moderada de sobrevivência' },
    ],
  },
};

// ── Índice reverso: nome pt-BR retornado pela API → chave de SEASONS ──────────
// O CalendarService (backend) retorna `season: 'Inverno' | 'Primavera' | ...`.
// Esse índice é a ÚNICA ponte entre o nome da API e a chave de configuração.
const KEY_BY_NAME = Object.fromEntries(
  Object.values(SEASONS).map((s) => [s.name, s.key]),
);

/**
 * Resolve a configuração de uma estação a partir do nome retornado pela API
 * (ex: "Inverno") ou diretamente pela chave (ex: "WINTER").
 *
 * @param {string} seasonNameOrKey
 * @returns {typeof SEASONS[keyof typeof SEASONS]}
 */
export function getSeasonConfig(seasonNameOrKey) {
  const key = KEY_BY_NAME[seasonNameOrKey] ?? seasonNameOrKey;
  const season = SEASONS[key];
  if (!season) {
    throw new Error(`Estação desconhecida na configuração visual: "${seasonNameOrKey}"`);
  }
  return season;
}

/**
 * Decide automaticamente qual estágio de arte usar ('early' | 'late') com
 * base na semana da estação (1–12). Centraliza a única regra de progressão
 * visual do módulo — nenhum componente deve reimplementar esse corte.
 *
 * @param {number} weekOfSeason — 1..12
 * @returns {'early'|'late'}
 */
export function getSeasonStage(weekOfSeason) {
  return weekOfSeason <= SEASON_STAGE_THRESHOLD ? 'early' : 'late';
}

/**
 * Atalho: resolve direto a URL da imagem certa para a estação + semana atual.
 *
 * @param {string} seasonNameOrKey
 * @param {number} weekOfSeason
 * @returns {string}
 */
export function getSeasonImage(seasonNameOrKey, weekOfSeason) {
  const season = getSeasonConfig(seasonNameOrKey);
  const stage = getSeasonStage(weekOfSeason);
  return season.images[stage];
}