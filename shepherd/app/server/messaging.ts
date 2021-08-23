import RuntimeClient from '@pioneers/runtime-client';
import { Server as WebSocketServer } from 'ws';

export class NotificationServer {
  wsServer: WebSocketServer;

  constructor(wsServer: WebSocketServer) {
    this.wsServer = wsServer;
  }

  broadcast() {
    // this.wsServer.clients.forEach()
  }
}
