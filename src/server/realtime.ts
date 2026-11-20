import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { RealtimeEvent } from '../shared/types.ts';

interface ClientMeta {
  ws: WebSocket;
  restaurantId: number;
  sessionToken?: string;
}

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientMeta>();

  init(server: Server) {
    if (this.wss) return;
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname !== '/ws') {
          return;
        }
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit('connection', ws, req);
        });
      } catch {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws, req) => {
      try {
        const url = new URL(req.url || '/ws', 'http://localhost');
        const restaurantId = Number(url.searchParams.get('restaurantId') || '1');
        const sessionToken = url.searchParams.get('sessionToken') || undefined;
        const client: ClientMeta = { ws, restaurantId, sessionToken };
        this.clients.add(client);

        ws.send(
          JSON.stringify({
            type: 'connected',
            restaurantId,
            payload: { connected: true },
            timestamp: new Date().toISOString(),
          } satisfies RealtimeEvent)
        );

        ws.on('close', () => {
          this.clients.delete(client);
        });

        ws.on('error', () => {
          this.clients.delete(client);
        });
      } catch {
        ws.close();
      }
    });
  }

  broadcast<T>(restaurantId: number, type: RealtimeEvent['type'], payload: T, sessionToken?: string) {
    const message = JSON.stringify({
      type,
      restaurantId,
      payload,
      timestamp: new Date().toISOString(),
    } satisfies RealtimeEvent<T>);

    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.restaurantId !== restaurantId) continue;
      if (sessionToken && client.sessionToken && client.sessionToken !== sessionToken) {
        // Still allow staff clients without a sessionToken filter
        continue;
      }
      client.ws.send(message);
    }
  }
}

export const realtimeHub = new RealtimeHub();
