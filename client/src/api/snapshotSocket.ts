import { resolveToken } from './client';
import type { SnapshotMessage } from './types';

export type SnapshotSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SnapshotSocketOptions {
  baseWsUrl: string;
  onMessage: (msg: SnapshotMessage) => void;
  onStatusChange?: (status: SnapshotSocketStatus) => void;
  WebSocketImpl?: typeof WebSocket;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export class SnapshotSocketClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private currentDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(private options: SnapshotSocketOptions) {
    this.currentDelay = options.reconnectDelayMs ?? 1000;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.connect();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.options.onStatusChange?.('closed');
  }

  private connect(): void {
    this.options.onStatusChange?.('connecting');
    const token = resolveToken() ?? '';
    const ws = new this.WebSocketImpl(`${this.options.baseWsUrl}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.currentDelay = this.options.reconnectDelayMs ?? 1000;
      this.options.onStatusChange?.('open');
    });

    ws.addEventListener('message', (event: any) => {
      this.options.onMessage(JSON.parse(event.data as string) as SnapshotMessage);
    });

    ws.addEventListener('close', () => {
      if (this.closedByUser) return;
      this.options.onStatusChange?.('reconnecting');
      const delay = this.currentDelay;
      const maxDelay = this.options.maxReconnectDelayMs ?? 30_000;
      this.currentDelay = Math.min(this.currentDelay * 2, maxDelay);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }
}
