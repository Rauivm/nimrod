import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WsContext = createContext(null);

export function WsProvider({ children }) {
  const wsRef        = useRef(null);
  const listenersRef = useRef({});
  const retryRef     = useRef(0);           // reconnect attempt counter
  const timerRef     = useRef(null);
  const deadRef      = useRef(false);       // true if server said Unauthorized
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (deadRef.current) return;            // stop retrying if unauthorized
    if (wsRef.current && [WebSocket.OPEN, WebSocket.CONNECTING].includes(wsRef.current.readyState)) return;
    clearTimeout(timerRef.current);

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url   = `${proto}://${window.location.host}/ws`;
    const ws    = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;                 // reset backoff on success
      setConnected(true);
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      setConnected(false);
      if (deadRef.current) return;
      // Exponential backoff: 1s, 2s, 4s, 8s … cap at 30s
      const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        // Server closed connection due to auth failure — stop retrying
        if (msg.type === 'ERROR' && msg.error === 'Unauthorized') {
          deadRef.current = true;
          ws.close();
          return;
        }

        const handlers = listenersRef.current[msg.type] || new Set();
        handlers.forEach((fn) => fn(msg.data));
        const allHandlers = listenersRef.current['*'] || new Set();
        allHandlers.forEach((fn) => fn(msg));
      } catch {}
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      deadRef.current = true;              // prevent reconnect on unmount
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const on = useCallback((type, fn) => {
    if (!listenersRef.current[type]) listenersRef.current[type] = new Set();
    listenersRef.current[type].add(fn);
    return () => {
      listenersRef.current[type]?.delete(fn);
      if (listenersRef.current[type]?.size === 0) delete listenersRef.current[type];
    };
  }, []);

  return (
    <WsContext.Provider value={{ on, connected }}>
      {children}
    </WsContext.Provider>
  );
}

export const useWs = () => useContext(WsContext);
