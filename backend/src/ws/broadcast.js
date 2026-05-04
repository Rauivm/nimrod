// Map: userId (string) → Set of WebSocket connections
// A user may have multiple tabs open.
const userSockets = new Map();

export function registerClient(ws, userId) {
  const isFirstConnection = !userSockets.has(userId);

  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(ws);

  if (isFirstConnection) {
    broadcast('USER_ONLINE', { userId });
  }

  ws.on('close', () => {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        userSockets.delete(userId);
        broadcast('USER_OFFLINE', { userId });
      }
    }
  });
}

export function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const sockets of userSockets.values()) {
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}

export function getOnlineUserIds() {
  return Array.from(userSockets.keys());
}
