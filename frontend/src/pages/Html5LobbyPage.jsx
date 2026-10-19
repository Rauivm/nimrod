import { useAuth } from '../contexts/AuthContext.jsx';
import { useExperience } from '../contexts/ExperienceContext.jsx';
import { SocialHub } from '../features/social-hub/SocialHub';
import { FoundryLaunchButton } from '../components/FoundryLaunchButton.jsx';
import { useCallback, useMemo } from 'react';
import { useWs } from '../contexts/WsContext.jsx';
import { api } from '../lib/api.js';

const loadCharacters = () => api.get('/me/characters');

// Keep existing JS contexts and session ownership outside the typed rendering feature.
export default function Html5LobbyPage() {
  const { user } = useAuth();
  const { chooseMode } = useExperience();
  const { on, send, connected } = useWs();
  const transport = useMemo(() => ({ send, observe: listener => on('*', listener) }), [on, send]);
  const observeCharacters = useCallback(refresh => {
    const stopUpdated = on('CHARACTER_UPDATED', data => { if (data?.userId === user?.id) refresh(); });
    const stopSynced = on('FOUNDRY_ACTORS_SYNCED', refresh);
    return () => { stopUpdated(); stopSynced(); };
  }, [on, user?.id]);
  return <SocialHub key={user?.id || 'guest'} account={user ? { id: user.id, displayName: user.displayName || user.name || null } : null}
    loadCharacters={loadCharacters} observeCharacters={observeCharacters} connected={connected} transport={transport}
    chooseClassic={() => chooseMode('classic')} chooseGame={() => chooseMode('game')}
    foundryAction={<FoundryLaunchButton className="ui-button ui-button-primary" label="Entrar no Foundry VTT" />} />;
}
