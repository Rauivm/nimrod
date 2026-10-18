import { useEffect, useRef, useState } from 'react';
import { CharacterRoster } from './CharacterRoster';
import type { RosterState } from './CharacterRoster';
import type { LoadCharacters, ObserveCharacters } from './hubCharacters';

export function useHubCharacters(accountId: string, load: LoadCharacters, observe: ObserveCharacters, connected: boolean) {
  const roster = useRef<CharacterRoster | null>(null);
  const [state, setState] = useState<RosterState>({ status: 'loading', characters: [], selectedId: null, error: null });
  useEffect(() => {
    const current = new CharacterRoster(accountId, load, setState);
    roster.current = current;
    const stop = observe(current.invalidate);
    const visible = () => { if (!document.hidden) current.invalidate(); };
    document.addEventListener('visibilitychange', visible);
    void current.refresh();
    return () => {
      current.dispose(); stop(); document.removeEventListener('visibilitychange', visible);
      if (roster.current === current) roster.current = null;
    };
  }, [accountId, load, observe]);
  useEffect(() => { if (connected) void roster.current?.refresh(); }, [connected]);

  return { ...state,
    selected: state.status === 'ready' ? state.characters.find(character => character.id === state.selectedId) ?? null : null,
    select: (id: string) => roster.current?.select(id),
    refresh: () => { void roster.current?.refresh(); },
  };
}
