import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';

/**
 * User shape:
 * {
 *   id:          string
 *   email:       string   (masked: "pla***@example.com")
 *   role:        'GM' | 'PLAYER'
 *   displayName: string
 *   lgpdConsent: boolean
 * }
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Stable ref so WS callbacks see the latest user without recreating.
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  const refresh = useCallback(() => {
    return api.get('/me')
      .then(data => { setUser(data); return data; })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, refresh, userRef }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

/** Maps DB role values to Portuguese display strings. */
export function roleLabel(role) {
  return role === 'GM' ? 'Mestre' : 'Jogador';
}
