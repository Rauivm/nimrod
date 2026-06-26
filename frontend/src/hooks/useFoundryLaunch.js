import { useState, useCallback } from 'react';
import { api } from '../lib/api.js';

/**
 * useFoundryLaunch
 *
 * Resolves the user's Foundry launch URL from the backend and opens
 * Foundry VTT in a new tab.
 *
 * Usage:
 *   const { launch, loading, error } = useFoundryLaunch();
 *   <button onClick={launch} disabled={loading}>Start Adventure</button>
 */
export function useFoundryLaunch() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const launch = useCallback(async (options = {}) => {
    setLoading(true);
    setError(null);

    try {
      const sessionId = options.sessionId ? `?sessionId=${encodeURIComponent(options.sessionId)}` : '';
      const data = await api.get(`/foundry/launch${sessionId}`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err.message ?? 'Could not launch Foundry.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { launch, loading, error };
}
