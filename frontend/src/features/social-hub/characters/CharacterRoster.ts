import { readHubCharacters } from './hubCharacters';
import type { HubCharacter, LoadCharacters } from './hubCharacters';

export interface RosterState {
  status: 'loading' | 'ready' | 'error';
  characters: HubCharacter[];
  selectedId: string | null;
  error: string | null;
}

/** Per-mount/account state. Selection is memory-only and cannot authorize a server join. */
export class CharacterRoster {
  state: RosterState = { status: 'loading', characters: [], selectedId: null, error: null };
  private preferred: string | null = null;
  private running = false;
  private queued = false;
  private disposed = false;

  constructor(private readonly accountId: string, private readonly load: LoadCharacters, private readonly publish: (state: RosterState) => void) {}

  private update(state: RosterState) { this.state = state; if (!this.disposed) this.publish(state); }

  refresh = async (invalidateInFlight = false): Promise<void> => {
    if (this.disposed) return;
    if (this.running) { this.queued ||= invalidateInFlight; return; }
    this.running = true;
    // Suspend the old identity and scene while authority is being re-read.
    this.update({ status: 'loading', characters: [], selectedId: null, error: null });
    try {
      const response = await this.load();
      if (this.disposed || this.queued) return;
      const characters = readHubCharacters(response, this.accountId);
      const selectedId = characters.some(character => character.id === this.preferred)
        ? this.preferred : characters.length === 1 ? characters[0].id : null;
      this.preferred = selectedId;
      this.update({ status: 'ready', characters, selectedId, error: null });
    } catch (error) {
      if (!this.disposed && !this.queued) this.update({ status: 'error', characters: [], selectedId: null,
        error: error instanceof Error ? error.message : 'Serviço de personagens indisponível.' });
    } finally {
      this.running = false;
      if (this.queued && !this.disposed) { this.queued = false; void this.refresh(); }
    }
  };

  invalidate = () => { void this.refresh(true); };

  select(id: string) {
    if (this.disposed || this.state.status !== 'ready') return;
    this.preferred = this.state.characters.some(character => character.id === id) ? id : null;
    this.update({ ...this.state, selectedId: this.preferred });
  }

  dispose() { this.disposed = true; this.queued = false; this.preferred = null; }
}
