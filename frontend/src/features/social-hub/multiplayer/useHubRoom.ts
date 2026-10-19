import { useEffect, useState, useSyncExternalStore } from 'react';
import { HubRoom } from './HubRoom';
import type { HubTransport, RoomAdmission } from './protocol';

export function useHubRoom(characterId: string, transport: HubTransport, connected: boolean, admission: RoomAdmission) {
  const [room] = useState(() => new HubRoom(transport, characterId, undefined, undefined, admission));
  const state = useSyncExternalStore(room.subscribe, room.getSnapshot);
  useEffect(() => {
    room.start();
    const visibility = () => room.setAway(document.hidden);
    const leave = () => room.stop();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { room.start(); room.setAway(document.hidden); } };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', restore); room.stop(); };
  }, [room]);
  useEffect(() => { room.setConnected(connected); room.setAway(document.hidden); }, [room, connected]);
  return { room, state };
}
