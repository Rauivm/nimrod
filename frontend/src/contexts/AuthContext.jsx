import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';

/**
 * User shape retornado por /me:
 * {
 *   id:          string
 *   email:       string   (mascarado: "pla***@example.com")
 *   role:        'PLAYER' | 'GM' | 'GM_PRINCIPAL'
 *   displayName: string | null
 *   avatarUrl:   string | null
 *   lgpdConsent: boolean
 * }
 *
 * Hierarquia de permissões (do menor para o maior):
 *   PLAYER < GM < GM_PRINCIPAL
 *
 * GM_PRINCIPAL herda TODAS as permissões de GM e PLAYER.
 * GM herda TODAS as permissões de PLAYER.
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

// ─── Helpers de role ──────────────────────────────────────────────────────────
// Fonte única de verdade para verificações de role no frontend.
// Nunca compare role === 'GM' diretamente nos componentes.

/** Retorna true para GM e GM_PRINCIPAL. */
export function isGM(user)          { return user?.role === 'GM' || user?.role === 'GM_PRINCIPAL'; }

/** Retorna true apenas para GM_PRINCIPAL. */
export function isGMPrincipal(user) { return user?.role === 'GM_PRINCIPAL'; }

/** Retorna true para qualquer usuário autenticado. */
export function isPlayer(user)      { return !!user?.role; }

/** Retorna true se o usuário pode administrar personagens de outros. */
export function isAdmin(user)       { return isGM(user); }

/**
 * Hook de conveniência que retorna flags de role para o usuário atual.
 * Uso: const { isGM, isGMPrincipal, isPlayer } = useRole();
 */
export function useRole() {
  const { user } = useAuth();
  return {
    user,
    isGM:          isGM(user),
    isGMPrincipal: isGMPrincipal(user),
    isPlayer:      isPlayer(user),
    isAdmin:       isAdmin(user),
    role:          user?.role ?? null,
  };
}

/** Label de exibição para um role. */
export function roleLabel(role) {
  switch (role) {
    case 'GM_PRINCIPAL': return 'Mestre Principal';
    case 'GM':           return 'Mestre';
    case 'PLAYER':       return 'Jogador';
    default:             return role ?? 'Desconhecido';
  }
}