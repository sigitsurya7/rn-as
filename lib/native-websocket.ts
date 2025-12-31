import { EventEmitter, requireNativeModule } from 'expo-modules-core';

type NativeEventPayload = {
  id: string;
  data?: string;
  message?: string;
  code?: number;
  reason?: string;
  responseCode?: number;
  responseMessage?: string;
  responseHeaders?: string;
};

type NativeModuleType = {
  connect(url: string, headers: Record<string, string>): Promise<string>;
  send(id: string, message: string): Promise<boolean>;
  close(id: string, code?: number, reason?: string): Promise<void>;
};

type MessageEvent = { data: string };
type CloseEvent = { code?: number; reason?: string };

export type WebSocketErrorEvent = {
  message?: string;
  code?: number;
  reason?: string;
  responseCode?: number;
  responseMessage?: string;
  responseHeaders?: string;
};

export type WebSocketLike = {
  url: string;
  readyState: number;
  onopen?: (() => void) | null;
  onmessage?: ((event: MessageEvent) => void) | null;
  onerror?: ((event: WebSocketErrorEvent) => void) | null;
  onclose?: ((event: CloseEvent) => void) | null;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
};

export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

const nativeModule = (() => {
  try {
    return requireNativeModule('StockityWebSocket') as NativeModuleType;
  } catch {
    return null;
  }
})();

const emitter = nativeModule ? new EventEmitter(nativeModule as any) : null;
const socketRegistry = new Map<string, NativeSocket>();

class NativeSocket implements WebSocketLike {
  url: string;
  readyState = WS_READY_STATE.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private socketId: string | null = null;
  private headers: Record<string, string>;

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
    this.connect();
  }

  private async connect() {
    if (!nativeModule || !emitter) {
      this.readyState = WS_READY_STATE.CLOSED;
      this.onerror?.({ message: 'Native websocket module not available' });
      return;
    }
    try {
      const id = await nativeModule.connect(this.url, this.headers);
      this.socketId = id;
      socketRegistry.set(id, this);
    } catch (err) {
      this.readyState = WS_READY_STATE.CLOSED;
      this.onerror?.({ message: String(err) });
    }
  }

  send(data: string) {
    if (!nativeModule || !this.socketId) return;
    nativeModule.send(this.socketId, data).catch((err) => {
      this.onerror?.({ message: String(err) });
    });
  }

  close(code?: number, reason?: string) {
    if (!nativeModule || !this.socketId) return;
    nativeModule
      .close(this.socketId, code, reason)
      .catch((err) => this.onerror?.({ message: String(err) }));
  }
}

function setupNativeListeners() {
  if (!emitter) return;
  emitter.removeAllListeners('open');
  emitter.removeAllListeners('message');
  emitter.removeAllListeners('error');
  emitter.removeAllListeners('close');

  emitter.addListener('open', ({ id, responseCode, responseMessage, responseHeaders }: NativeEventPayload) => {
    const socket = socketRegistry.get(id);
    if (!socket) return;
    socket.readyState = WS_READY_STATE.OPEN;
    console.log(
      `[WS native] open id=${id} responseCode=${responseCode ?? ''} responseMessage=${responseMessage ?? ''}`
    );
    if (responseHeaders) {
      console.log(`[WS native] responseHeaders=${responseHeaders}`);
    }
    socket.onopen?.();
  });
  emitter.addListener('message', ({ id, data }: NativeEventPayload) => {
    const socket = socketRegistry.get(id);
    if (!socket || typeof data !== 'string') return;
    socket.onmessage?.({ data });
  });
  emitter.addListener(
    'error',
    ({ id, message, code, reason, responseCode, responseMessage, responseHeaders }: NativeEventPayload) => {
    const socket = socketRegistry.get(id);
    if (!socket) return;
    console.error(
      `[WS native] error id=${id} message=${message ?? 'unknown'} code=${code ?? ''} reason=${reason ?? ''} responseCode=${responseCode ?? ''} responseMessage=${responseMessage ?? ''}`
    );
    if (responseHeaders) {
      console.error(`[WS native] responseHeaders=${responseHeaders}`);
    }
    socket.onerror?.({ message, code, reason, responseCode, responseMessage, responseHeaders });
  }
  );
  emitter.addListener('close', ({ id, code, reason }: NativeEventPayload) => {
    const socket = socketRegistry.get(id);
    if (!socket) return;
    socket.readyState = WS_READY_STATE.CLOSED;
    console.warn(`[WS native] close id=${id} code=${code ?? 'unknown'} reason=${reason ?? ''}`);
    socket.onclose?.({ code, reason });
    socketRegistry.delete(id);
  });
}

setupNativeListeners();

export function createWebSocket(url: string, headers: Record<string, string>): WebSocketLike {
  if (nativeModule) {
    return new NativeSocket(url, headers);
  }
  const ws = new WebSocket(url) as unknown as WebSocketLike;
  return ws;
}
