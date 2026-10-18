/** Existing GET /me/characters projection. No inventory or appearance is inferred. */
export interface HubCharacter {
  id: string;
  name: string;
  level: number | null;
  classe: string | null;
  race: string | null;
  foundryActorId: string | null;
  tokenImg: string | null;
  portraitImg: string | null;
  lastSyncedAt: string | null;
}

export interface HubAccount { id: string; displayName: string | null }
export type LoadCharacters = () => Promise<unknown>;
export type ObserveCharacters = (invalidate: () => void) => () => void;

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/** The server scopes the query to req.user.id; reject inconsistent rows defensively. */
export function readHubCharacters(response: unknown, accountId: string): HubCharacter[] {
  if (!Array.isArray(response)) throw new Error('Resposta de personagens incompatível com o Nimrod.');
  const counts = new Map<string, number>();
  for (const row of response) {
    if (row && typeof row.id === 'string') counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }
  return response.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    const id = text(value.id), name = text(value.name);
    if (!id || !name || counts.get(id) !== 1 || !accountId || value.userId !== accountId
      || value.active !== true || value.retired !== false || value.dead !== false) return [];
    const synced = text(value.lastSyncedAt);
    return [{
      id, name,
      level: typeof value.level === 'number' && Number.isInteger(value.level) && value.level > 0 ? value.level : null,
      classe: text(value.classe), race: text(value.race), foundryActorId: text(value.foundryActorId),
      tokenImg: text(value.tokenImg), portraitImg: text(value.portraitImg),
      lastSyncedAt: synced && Number.isFinite(Date.parse(synced)) ? synced : null,
    }];
  });
}

/** Match the existing CharacterCard proxy contract, never fetch a supplied external host. */
export function characterImageUrl(value: string | null): string | null {
  if (!value || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return null;
  let path = value;
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.username || url.password) return null;
      path = url.pathname;
    } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  if (path.split('/').some(part => part === '..' || /%2e/i.test(part))) return null;
  if (path.startsWith('/uploads/')) return path;
  return `/api/foundry/assets?path=${encodeURIComponent(path)}`;
}
