import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';

const ExperienceContext = createContext(null);
const MODES = new Set(['classic', 'game']);
const keyFor = userId => `nimrod:experience:${userId}`;

function readMode(userId) {
  if (!userId) return null;
  try {
    const stored = localStorage.getItem(keyFor(userId));
    return MODES.has(stored) ? stored : null;
  } catch { return null; }
}

export function ExperienceProvider({ children }) {
  const { user } = useAuth();
  const [choices, setChoices] = useState({});
  const userId = user?.id;
  const mode = useMemo(() => userId ? choices[userId] ?? readMode(userId) : null, [choices, userId]);

  const chooseMode = useCallback(next => {
    if (!userId || !MODES.has(next)) return;
    setChoices(previous => ({ ...previous, [userId]: next }));
    try { localStorage.setItem(keyFor(userId), next); } catch { /* This session still remembers the choice. */ }
  }, [userId]);

  return <ExperienceContext.Provider value={{ mode, chooseMode }}>{children}</ExperienceContext.Provider>;
}

export const useExperience = () => useContext(ExperienceContext);
