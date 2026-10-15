import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/index.js', () => ({ query: vi.fn() }));

describe('tavern backend packaging', () => {
  it('loads the WebSocket room with its packaged collision map and no external volume', async () => {
    // Production imports this module before listening. A missing JSON used to
    // crash the entire backend here, even when no one had joined the tavern.
    const room = await import('../src/services/tavernRoom.js');
    expect(room.handleTavernMessage).toBeTypeOf('function');
  });
});
