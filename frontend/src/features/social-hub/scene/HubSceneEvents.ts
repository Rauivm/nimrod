import type { InteractionId } from '../world/tavernMap';

export interface HubSceneEvents {
  onInteraction: (id: InteractionId | null) => void;
  onNotice: (message: string) => void;
}
