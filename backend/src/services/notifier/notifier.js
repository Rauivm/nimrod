/**
 * notifier.js
 *
 * Domain-level notification functions.
 * Each function builds a Discord embed appropriate for its event and
 * delegates to sendDiscordMessage — all failures are silent.
 *
 * Colour palette (decimal):
 *   Gold    10161952  (#9B2335 → actually using theme colours below)
 *   Mission 13369344  (#CC0000 crimson-ish)
 *   Notice  16750848  (#FFAA00 amber)
 *   Post    5793266   (#586832 muted green)
 *   Poll    5592575   (#5555FF purple-blue)
 */

import { sendDiscordMessage } from './discord.js';

const COLOUR = {
  mission: 0xCC2222,  // crimson — mission created
  notice:  0xFFAA00,  // amber   — notice/aviso created
  post:    0x8B6820,  // gold    — tavern post created
  poll:    0x5555CC,  // indigo  — poll created
};

const FOUNDRY_URL = () => process.env.MISSIONS_URL?.replace(/\/$/, '') || null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(str, max = 200) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function footer() {
  return { text: 'Nimrod · Foundry VTT' };
}

function timestamp() {
  return new Date().toISOString();
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Notify when a new MISSION is created.
 *
 * @param {{ title: string, description: string, level?: string,
 *           reward?: string, datetime?: string,
 *           creator_name: string, id: string }} mission
 */
export async function notifyMissionCreated(mission) {
  const fields = [];

  if (mission.level) {
    fields.push({ name: '⚗ Nível',     value: mission.level,              inline: true });
  }
  if (mission.reward) {
    fields.push({ name: '💰 Recompensa', value: mission.reward,            inline: true });
  }
  if (mission.datetime) {
    const d = new Date(mission.datetime);
    fields.push({
      name:   '🗓 Data',
      value:  d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      inline: true,
    });
  }

  const url = MISSIONS_URL();

  void sendDiscordMessage({
    embeds: [{
      title:       `⚔ Nova Missão: ${mission.title}`,
      description: truncate(mission.description),
      color:       COLOUR.mission,
      fields,
      footer:      footer(),
      timestamp:   timestamp(),
      ...(url ? { url } : {}),
    }],
  }).catch(console.error);
}

/**
 * Notify when a new NOTICE (aviso) is created.
 *
 * @param {{ title: string, description: string, creator_name: string, id: string }} notice
 */
export async function notifyNoticeCreated(notice) {
  void sendDiscordMessage({
    embeds: [{
      title:       `📋 Novo Aviso: ${notice.title}`,
      description: truncate(notice.description),
      color:       COLOUR.notice,
      footer:      footer(),
      timestamp:   timestamp(),
    }],
  }).catch(console.error);
}

/**
 * Notify when a new top-level TAVERN POST is created.
 * Replies and entity-linked posts are intentionally excluded to avoid spam.
 *
 * @param {{ content: string, author: { displayName: string } }} post
 */
export async function notifyPostCreated(post) {
  void sendDiscordMessage({
    embeds: [{
      title:       '📜 Nova mensagem na Taverna',
      description: truncate(post.content, 300),
      color:       COLOUR.post,
      footer: {
        text: `${post.author?.displayName || 'Aventureiro'} · Nimrod`,
      },
      timestamp: timestamp(),
    }],
  }).catch(console.error);
}

/**
 * Notify when a new POLL is created.
 *
 * @param {{ question: string, options: Array<{ text: string }>,
 *           creator_name: string }} poll
 */
export async function notifyPollCreated(poll) {
  const optionList = (poll.options || [])
    .slice(0, 8)
    .map((o, i) => `${i + 1}. ${o.text}`)
    .join('\n');

  void sendDiscordMessage({
    embeds: [{
      title:       `📊 Nova Enquete`,
      description: `**${truncate(poll.question, 200)}**\n\n${optionList}`,
      color:       COLOUR.poll,
      footer:      footer(),
      timestamp:   timestamp(),
    }],
  }).catch(console.error);
}
