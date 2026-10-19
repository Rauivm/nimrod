import { cfAuthMiddleware } from '../middleware/auth.js';
import { registerClient } from './broadcast.js';
import { handleTavernMessage, handleTavernSocketClose } from '../services/tavernRoom.js';
import { socialHubRoom } from '../services/socialHub/index.js';

/** Same session and one connection for classic events, legacy tavern and HTML5. */
export async function connectNimrodSocket(connection, req, log) {
  const socket = connection.socket ?? connection;
  try {
    const fakeReply = { code: () => ({ send: () => {} }) };
    await cfAuthMiddleware(req, fakeReply);
    if (!req.user) { socket.close(1008, 'Unauthorized'); return; }
    if (socket.readyState !== 1) return;
    registerClient(socket, req.user.id);
    const detachHub = socialHubRoom.attach(socket, req.user);
    socket.on('close', detachHub);
    socket.on('close', () => handleTavernSocketClose(socket));
    socket.on('message', (raw, binary) => {
      try {
        if (socialHubRoom.accept(socket, raw, binary)) return;
        handleTavernMessage(req.user, socket, raw.toString()).catch(err => log.error({ err }, '[tavern] message failed'));
      } catch (err) { log.error({ err }, '[social-hub] message failed'); socket.close(1011, 'Room unavailable'); }
    });
    // Only now may the existing WsProvider report the connection as authenticated.
    socket.send(JSON.stringify({ type: 'CONNECTED', ts: Date.now() }));
  } catch { socket.close(1008, 'Unauthorized'); }
}
