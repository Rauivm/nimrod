import { Swords } from 'lucide-react';
import { useFoundryLaunch } from '../hooks/useFoundryLaunch.js';

/**
 * FoundryLaunchButton
 *
 * Drop-in button that resolves the user's Foundry URL and opens it in a
 * new tab.  Shows inline error feedback without blocking the rest of the UI.
 *
 * Props:
 *   className  – extra CSS classes to merge onto the button
 *   label      – button label (default: "Start Adventure")
 */
export function FoundryLaunchButton({ className = '', label = 'Start Adventure' }) {
  const { launch, loading, error } = useFoundryLaunch();

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem' }}>
      <button
        className={`btn btn-primary ${className}`}
        onClick={launch}
        disabled={loading}
        aria-busy={loading}
      >
        <Swords size={16} />
        {loading ? 'Launching…' : label}
      </button>

      {error && (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-error, #f87171)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
