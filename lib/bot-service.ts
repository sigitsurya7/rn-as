import { apiV2 } from './api';
import { loadStoredAuth, loadTradeSettings } from './storage';
import { DEVICE_TYPE, getOrCreateDeviceId } from './device';
import { WEBVIEW_USER_AGENT } from './webview-constants';
import { startForegroundService, stopForegroundService } from './foreground-service';
import {
  nativeBotAvailable,
  onNativeBotEvent,
  startNativeBot,
  stopNativeBot,
} from './native-bot';
import { DEFAULT_TRADE_CONFIG, TradeConfig, normalizeTradeConfig } from './trade-config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWebSocket, WS_READY_STATE, WebSocketLike } from './native-websocket';

type BotStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';
type Trend = 'call' | 'put';

type BotEventMap = {
  status: { status: BotStatus; message?: string };
  log: { message: string };
  error: { message: string };
  balance: { accountType: string; balance: number; currency: string };
  ws: { tradeConnected: boolean; streamConnected: boolean };
  refresh: { reason: 'bid' | 'tracked_profit' };
};

type Listener<T> = (payload: T) => void;

type CandlePoint = {
  open: number;
  close: number;
};

type DealItem = {
  status?: string;
  created_at?: string;
  win?: number | null;
  amount?: number | null;
  open_rate?: number;
  trend?: string;
  asset_ric?: string;
  close_quote_created_at?: string;
  deal_type?: string;
  payment?: number | null;
};

type DealsResponse = {
  data?: {
    standard_trade_deals?: DealItem[];
    deals?: DealItem[];
  };
  standard_trade_deals?: DealItem[];
  deals?: DealItem[];
};

type OpenedBid = {
  assetRic: string;
  closeAt: string;
  openRate: number;
  trend: Trend;
  uuid?: string;
  amount?: number;
  payment?: number;
  dealType?: 'demo' | 'real';
};

const BOT_STATE_KEY = 'bot_state';

type BotState = {
  lastStep: number;
  lastWasSwitchDemo: boolean;
  lastTrend?: Trend | null;
  lastAmount?: number | null;
};

export type ResumeReason = 'NONE' | 'UNCLOSED_BID' | 'LAST_BID_LOST' | 'LAST_BID_WON_IN_SWITCH_DEMO';

export type ResumeState = {
  shouldResume: boolean;
  resumeStep: number;
  reason: ResumeReason;
  lastDeal?: DealItem | null;
};

const MIN_BID_BY_CURRENCY: Record<string, number> = {
  IDR: 14000,
  USD: 1,
  EUR: 1,
};

const MAX_BID_BY_CURRENCY: Record<string, number> = {
  IDR: 74000000,
  USD: 5000,
  EUR: 4600,
};
const MAX_K_STEP = 100;

class BotService {
  private tradeSocket: WebSocketLike | null = null;
  private streamSocket: WebSocketLike | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private signalTimers: Array<ReturnType<typeof setTimeout>> = [];
  private listeners = new Map<keyof BotEventMap, Set<Listener<any>>>();
  private status: BotStatus = 'idle';
  private config: TradeConfig = DEFAULT_TRADE_CONFIG;
  private pendingUUIDs = new Set<string>();
  private openedBids: OpenedBid[] = [];
  private processedBatches = new Set<string>();
  private martingaleStep = 0;
  private lossStreak = 0;
  private totalProfit = 0;
  private balanceReal = 0;
  private balanceDemo = 0;
  private userCurrency = 'IDR';
  private currentWalletType: 'real' | 'demo' = 'demo';
  private forceDemo = false;
  private allowAutoSwitch = true;
  private nextRef = 1;
  private joinRefs: Record<string, number> = {};
  private lastBidStep = 0;
  private lastBidWasSwitchDemo = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAuth: { tokenApi: string; deviceId: string; asset: string } | null = null;
  private lastWsError: { trade?: string; stream?: string } = {};
  private cooldownActive = false;
  private cooldownCount = 0;
  private cooldownMax = 5;
  private shouldUseSignal = true;
  private repeatStep = 0;
  private lastSignalTrend: Trend | null = null;
  private pendingResumeState: ResumeState | null = null;
  private tradeReady = false;
  private streamReady = false;
  private tradeConnected = false;
  private streamConnected = false;
  private nativeEnabled = nativeBotAvailable();
  private nativeEventsSubscribed = false;
  private lastFastBidTrend: Trend | null = null;
  private fastRepeatTrend: Trend | null = null;
  private momentumNoSignalSince: number | null = null;
  private bidInFlightUntil: number | null = null;
  private flashInitialSent = false;
  private fastInitialSent = false;
  private fastCandleLogScheduled = false;
  private switchDemoActive = false;
  private switchDemoStep: number | null = null;
  private switchDemoReturnWallet: 'real' | 'demo' | null = null;
  private disableRepeatAfterDemo = false;
  private skipStopLossOnce = false;
  private profitReal = 0;
  private profitDemo = 0;
  private lastBidAt = 0;
  private lastBidAmount: number | null = null;
  private disconnecting = false;

  on<K extends keyof BotEventMap>(event: K, handler: Listener<BotEventMap[K]>) {
    const listeners =
      (this.listeners.get(event) as Set<Listener<BotEventMap[K]>> | undefined) ??
      new Set<Listener<BotEventMap[K]>>();
    listeners.add(handler);
    this.listeners.set(event, listeners as Set<Listener<any>>);
    return () => {
      listeners.delete(handler);
    };
  }

  private emit<K extends keyof BotEventMap>(event: K, payload: BotEventMap[K]) {
    const listeners = this.listeners.get(event) as
      | Set<Listener<BotEventMap[K]>>
      | undefined;
    listeners?.forEach((handler) => handler(payload));
    if (event === 'log') {
      console.log(`[Bot] ${(payload as BotEventMap['log']).message}`);
    }
    if (event === 'error') {
      console.error(`[Bot] ${(payload as BotEventMap['error']).message}`);
    }
  }

  private emitWsStatus() {
    this.emit('ws', {
      tradeConnected: this.tradeConnected,
      streamConnected: this.streamConnected,
    });
  }

  private resetConnectionState() {
    this.tradeReady = false;
    this.streamReady = false;
    this.tradeConnected = false;
    this.streamConnected = false;
    this.emitWsStatus();
  }

  private clearHeartbeatTimer() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private teardownSockets() {
    this.clearHeartbeatTimer();
    this.tradeSocket?.close();
    this.streamSocket?.close();
    this.tradeSocket = null;
    this.streamSocket = null;
  }

  private setStatus(status: BotStatus, message?: string) {
    this.status = status;
    this.emit('status', { status, message });
    if (!this.nativeEnabled) {
      if (status === 'running') {
        startForegroundService('Koala sedang bekerja', 'Bot berjalan di latar belakang.');
      } else if (status === 'stopped' || status === 'error' || status === 'idle') {
        stopForegroundService();
      }
    }
  }

  private subscribeNativeEvents() {
    if (!this.nativeEnabled || this.nativeEventsSubscribed) return;
    this.nativeEventsSubscribed = true;
    onNativeBotEvent(({ type, payload }) => {
      try {
        const data = payload ? JSON.parse(payload) : {};
        if (type === 'status') {
          const nextStatus = (data.status as BotStatus) ?? 'running';
          this.status = nextStatus;
          this.emit('status', { status: nextStatus, message: data.message });
          return;
        }
        if (type === 'ws') {
          this.tradeConnected = Boolean(data.tradeConnected);
          this.streamConnected = Boolean(data.streamConnected);
          this.emitWsStatus();
          return;
        }
        if (type === 'log') {
          this.emit('log', { message: String(data.message ?? payload) });
          return;
        }
        if (type === 'error') {
          this.emit('error', { message: String(data.message ?? payload) });
          return;
        }
        if (type === 'refresh') {
          this.emit('refresh', { reason: (data.reason as 'bid' | 'tracked_profit') ?? 'bid' });
          return;
        }
      } catch {
        this.emit('log', { message: `Native event: ${type} ${payload}` });
      }
    });
  }

  async start(config: TradeConfig, resumeState?: ResumeState | null) {
    if (this.status === 'running' || this.status === 'starting') return;
    console.clear();
    this.setStatus('starting', 'Menyiapkan bot...');
    if (this.nativeEnabled) {
      this.subscribeNativeEvents();
      const stored = await loadStoredAuth();
      const deviceId = stored.deviceId ?? (await getOrCreateDeviceId());
      if (!stored.tokenApi) {
        this.setStatus('error', 'Token API v2 belum tersedia.');
        throw new Error('Token API v2 belum tersedia.');
      }
      const normalized = normalizeTradeConfig(config);
      await startNativeBot(
        JSON.stringify({
          config: normalized,
          auth: {
            tokenApi: stored.tokenApi,
            deviceId,
            apiUrl: stored.apiUrl ?? 'https://api.stockity.id',
          },
          resumeState: resumeState ?? undefined,
        })
      );
      return;
    }
    if (resumeState) {
      await this.loadBotState();
    }
    const storedConfig = await this.loadStoredConfig();
    this.config = storedConfig ?? normalizeTradeConfig(config);
    if (!resumeState) {
      await AsyncStorage.removeItem(BOT_STATE_KEY);
    }
    this.pendingUUIDs.clear();
    this.openedBids = [];
    this.processedBatches.clear();
    this.martingaleStep = 0;
    this.lossStreak = 0;
    this.totalProfit = 0;
    this.forceDemo = false;
    this.allowAutoSwitch = true;
    this.nextRef = 1;
    this.joinRefs = {};
    this.lastBidStep = 0;
    this.lastBidWasSwitchDemo = false;
    this.reconnectTimer = null;
    this.lastAuth = null;
    this.cooldownActive = false;
    this.cooldownCount = 0;
    this.cooldownMax = 5;
    this.shouldUseSignal = true;
    this.repeatStep = 0;
    this.lastSignalTrend = resumeState ? this.lastSignalTrend : null;
    this.lastFastBidTrend = this.lastSignalTrend;
    this.fastRepeatTrend = null;
    this.momentumNoSignalSince = null;
    this.bidInFlightUntil = null;
    this.flashInitialSent = false;
    this.fastInitialSent = false;
    this.fastCandleLogScheduled = false;
    this.skipStopLossOnce = false;
    this.disconnecting = false;
    this.switchDemoActive = false;
    this.switchDemoStep = null;
    this.switchDemoReturnWallet = null;
    this.disableRepeatAfterDemo = false;
    this.lastWsError = {};
    this.profitReal = 0;
    this.profitDemo = 0;
    this.lastBidAt = 0;
    this.lastBidAmount = null;
    this.pendingResumeState = resumeState ?? null;
    this.resetConnectionState();

    const stored = await loadStoredAuth();
    const deviceId = stored.deviceId ?? (await getOrCreateDeviceId());
    if (!stored.tokenApi) {
      this.setStatus('error', 'Token API v2 belum tersedia.');
      throw new Error('Token API v2 belum tersedia.');
    }
    this.emit('log', {
      message: `Auth ready: deviceId=${deviceId}, tokenApi=***${String(stored.tokenApi).slice(-4)}, apiUrl=${stored.apiUrl ?? 'null'}, asset=${this.config.asset}`,
    });
    if (this.config.strategy === 'Signal') {
      const signals = this.parseSignals(this.config.signalInput);
      if (signals.length === 0) {
        this.setStatus('error', 'Tidak ada signal yang dimasukan.');
        throw new Error('Tidak ada signal yang dimasukan.');
      }
    }

    this.currentWalletType = this.config.walletType;
    this.userCurrency =
      (this.config.currency ? String(this.config.currency) : this.parseCurrency(stored.userProfile)) ||
      'IDR';
    this.lastBidStep = 0;
    this.lastBidWasSwitchDemo = false;

    const authParams = {
      tokenApi: stored.tokenApi,
      deviceId,
      asset: this.config.asset,
    };
    this.lastAuth = authParams;
    await this.connectSockets(authParams);

    await this.refreshBalances();
    await this.refreshProfitFromApi('start');
    if (resumeState) {
      this.emit('log', { message: `Resume requested: step=${resumeState.resumeStep}` });
      this.applyResumeState(resumeState);
    } else {
      this.emit('log', { message: 'Fresh start: Starting at step 0' });
    }
    this.emit('log', {
      message: `Initial State: martingaleStep=${this.martingaleStep}, repeatStep=${this.repeatStep}, shouldUseSignal=${this.shouldUseSignal}`,
    });
    await this.maybeStartFlashInitialBid();
    this.scheduleStrategy();
    this.setStatus('running', 'Bot berjalan');
  }

  stop(message = 'Bot dihentikan') {
    if (this.nativeEnabled) {
      stopNativeBot()
        .then(() => {
          this.setStatus('stopped', message);
        })
        .catch((err) => {
          const reason = err instanceof Error ? err.message : String(err);
          this.emit('error', { message: `Gagal menghentikan bot native: ${reason}` });
          this.setStatus('error', 'Gagal menghentikan bot native.');
        });
      return;
    }
    this.setStatus('stopped', message);
    this.signalTimers.forEach((timer) => {
      clearTimeout(timer);
      clearInterval(timer);
    });
    this.signalTimers = [];
    this.pendingUUIDs.clear();
    this.openedBids = [];
    this.processedBatches.clear();
    this.lastWsError = {};
    this.disconnecting = false;
    this.resetConnectionState();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownSockets();
  }

  private parseCurrency(profile: string | null) {
    if (!profile) return 'IDR';
    try {
      const parsed = JSON.parse(profile);
      const currency = String(parsed?.currency ?? '').toUpperCase();
      return currency || 'IDR';
    } catch {
      return 'IDR';
    }
  }

  private async connectSockets(params: { tokenApi: string; deviceId: string; asset: string }) {
    this.disconnecting = true;
    this.teardownSockets();
    this.resetConnectionState();
    this.lastWsError = {};
    const headers = {
      'Authorization-Token': params.tokenApi,
      'Device-Id': params.deviceId,
      'Device-Type': DEVICE_TYPE,
      'User-Agent': WEBVIEW_USER_AGENT,
      Origin: 'https://stockity.id',
      Cookie: `device_type=web; device_id=${params.deviceId}; authtoken=${params.tokenApi}`,
    };
    const maskedToken = `***${String(params.tokenApi).slice(-4)}`;
    const cookieSafe = `device_type=web; device_id=${params.deviceId}; authtoken=${maskedToken}`;
    this.emit('log', {
      message: [
        'WS headers:',
        `- Authorization-Token: ${maskedToken}`,
        `- Device-Id: ${params.deviceId}`,
        `- Device-Type: ${DEVICE_TYPE}`,
        `- User-Agent: ${WEBVIEW_USER_AGENT}`,
        '- Origin: https://stockity.id',
        `- Cookie: ${cookieSafe}`,
        '- WS handshake: Connection/Upgrade/Sec-WebSocket-* added by native stack',
      ].join('\n'),
    });

    const createSocket = (url: string) => {
      this.emit('log', { message: `Connecting WS: ${url}` });
      try {
        return createWebSocket(url, headers);
      } catch (err) {
        this.emit('error', { message: `WebSocket init failed: ${String(err)}` });
        return createWebSocket(url, {});
      }
    };

    this.tradeSocket = createSocket('wss://as.stockity.id/');

    const waitForSocketOpen = (socket: WebSocketLike, label: string, timeoutMs = 15000) =>
      new Promise<void>((resolve, reject) => {
        if (socket.readyState === WS_READY_STATE.OPEN) {
          resolve();
          return;
        }
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`${label} socket timeout`));
        }, timeoutMs);
        const prevOpen = socket.onopen;
        const prevError = socket.onerror;
        const prevClose = socket.onclose;
        const cleanup = () => {
          clearTimeout(timeout);
          socket.onopen = prevOpen ?? null;
          socket.onerror = prevError ?? null;
          socket.onclose = prevClose ?? null;
        };
        socket.onopen = () => {
          prevOpen?.();
          cleanup();
          resolve();
        };
        socket.onerror = (event: any) => {
          prevError?.(event);
          cleanup();
          reject(new Error(`${label} socket error`));
        };
        socket.onclose = (event: any) => {
          prevClose?.(event);
          cleanup();
          const code = event?.code ?? 'unknown';
          const reason = event?.reason ?? 'unknown';
          reject(new Error(`${label} socket closed (${code}): ${reason}`));
        };
      });

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const asset = this.config.asset || params.asset;
    const assetTopic = `asset:${asset}`;
    const rangeTopic = `range_stream:${asset}`;
    const connectionTopic = 'connection';
    const streamJoinMessages = [
      { topic: connectionTopic, event: 'phx_join', payload: {} },
      { topic: 'marathon', event: 'phx_join', payload: {} },
      { topic: 'user', event: 'phx_join', payload: {} },
      { topic: 'tournament', event: 'phx_join', payload: {} },
      { topic: 'cfd_zero_spread', event: 'phx_join', payload: {} },
      { topic: 'bo', event: 'phx_join', payload: {} },
      { topic: 'asset', event: 'phx_join', payload: {} },
      { topic: 'copy_trading', event: 'phx_join', payload: {} },
      { topic: 'account', event: 'phx_join', payload: {} },
      { topic: assetTopic, event: 'phx_join', payload: {} },
      { topic: rangeTopic, event: 'phx_join', payload: {} },
      { topic: connectionTopic, event: 'ping', payload: {} },
    ];
    const tradeJoinMessages = [
      { topic: 'connection', event: 'phx_join', payload: {} },
      { topic: 'bo', event: 'phx_join', payload: {} },
    ];
    const sendWs = (socket: WebSocketLike, label: string, payload: any) => {
      const text = JSON.stringify(payload);
      this.emit('log', { message: `WS send (${label}): ${text}` });
      socket.send(text);
    };
    const sendStreamControl = (socket: WebSocketLike, label: string, payload: any) => {
      const ref = this.nextRef++;
      const joinRef = this.joinRefs[connectionTopic] ?? this.joinRefs[assetTopic];
      const message = joinRef
        ? { ...payload, ref: String(ref), join_ref: String(joinRef) }
        : { ...payload, ref: String(ref) };
      sendWs(socket, label, message);
    };
    const sendStreamHeartbeat = (socket: WebSocketLike) => {
      const ref = this.nextRef++;
      sendWs(socket, 'heartbeat', {
        topic: 'phoenix',
        event: 'heartbeat',
        payload: {},
        ref: String(ref),
      });
    };
    const sendStreamPing = (socket: WebSocketLike) => {
      const ref = this.nextRef++;
      const joinRef = this.joinRefs[connectionTopic] ?? this.joinRefs[assetTopic];
      const payload = joinRef
        ? { topic: 'connection', event: 'ping', payload: {}, ref: String(ref), join_ref: String(joinRef) }
        : { topic: 'connection', event: 'ping', payload: {}, ref: String(ref) };
      sendWs(socket, 'ping', payload);
    };
    const joinTopics = async (socket: WebSocketLike, includeRefs: boolean) => {
      const messages = socket === this.streamSocket ? streamJoinMessages : tradeJoinMessages;
      for (const message of messages) {
        if (message.event === 'phx_join' && includeRefs) {
          const ref = this.nextRef++;
          this.joinRefs[message.topic] = ref;
          sendWs(socket, 'join', { ...message, ref: String(ref), join_ref: String(ref) });
        } else if (includeRefs && socket === this.streamSocket) {
          sendStreamControl(socket, 'join', message);
        } else {
          sendWs(socket, 'join', message);
        }
        await sleep(1000);
      }
      this.emit('log', {
        message: `WS join finished: ${socket === this.streamSocket ? 'stream' : 'trade'}`,
      });
      if (socket === this.streamSocket) {
        this.streamReady = true;
        this.emit('log', { message: `streamReady=true (joinRefs=${Object.keys(this.joinRefs).length})` });
      } else {
        this.tradeReady = true;
        this.emit('log', { message: `tradeReady=true (joinRefs=${Object.keys(this.joinRefs).length})` });
      }
      this.maybeStartFastInitialBid().catch((err) => {
        this.emit('error', { message: `Fast initial bid failed: ${String(err)}` });
      });
      this.maybeStartFlashInitialBid().catch((err) => {
        this.emit('error', { message: `Flash initial bid failed: ${String(err)}` });
      });
    };

    const onOpen = (socket: WebSocketLike) => {
      const includeRefs = socket === this.streamSocket;
      if (socket === this.streamSocket) this.streamReady = false;
      if (socket === this.tradeSocket) this.tradeReady = false;
      joinTopics(socket, includeRefs).then(() => {
        if (socket === this.streamSocket) {
          this.emit('log', { message: 'Stream join complete; reconnect_request disabled' });
        }
        if (socket === this.tradeSocket) {
          sendWs(socket, 'subscribe', { action: 'subscribe', event_type: 'reconnect_request' });
          if (asset) {
            sendWs(socket, 'subscribe', { action: 'subscribe', rics: [asset] });
          } else {
            this.emit('error', { message: 'Trade subscribe skipped: asset kosong.' });
          }
        }
      });
      if (socket === this.tradeSocket) {
        this.tradeConnected = true;
      }
      if (socket === this.streamSocket) {
        this.streamConnected = true;
      }
      this.emitWsStatus();
      const label = socket === this.tradeSocket ? 'Trade' : socket === this.streamSocket ? 'Stream' : 'WS';
      this.emit('log', { message: `${label} WS connected: ${socket.url}` });
    };

    const onMessage = (event: any) => {
      try {
        const data = JSON.parse(String(event.data));
        this.handleSocketEvent(data);
      } catch (err) {
        this.emit('log', { message: `WS message parse error: ${String(err)}` });
      }
    };

    this.tradeSocket.onopen = () => onOpen(this.tradeSocket as WebSocketLike);
    this.tradeSocket.onmessage = onMessage;

    const formatWsError = (label: string, event: any) => {
      const details = [
        event?.message ? `message=${event.message}` : null,
        event?.code ? `code=${event.code}` : null,
        event?.reason ? `reason=${event.reason}` : null,
        event?.responseCode ? `responseCode=${event.responseCode}` : null,
        event?.responseMessage ? `responseMessage=${event.responseMessage}` : null,
        event?.responseHeaders ? `responseHeaders=${event.responseHeaders}` : null,
      ].filter(Boolean);
      return [`${label} socket error`, ...details].join('\n');
    };

    this.tradeSocket.onerror = (event: any) => {
      const detail = formatWsError('Trade', event);
      this.lastWsError.trade = detail;
      this.emit('error', { message: detail });
    };
    this.tradeSocket.onclose = (event: any) => {
      this.handleSocketClose('Trade', event, this.tradeSocket?.url, this.lastWsError.trade);
    };

    this.emit('log', { message: 'Menunggu koneksi Trade WS...' });
    await waitForSocketOpen(this.tradeSocket, 'Trade');
    if (!this.tradeConnected) {
      this.tradeConnected = true;
      this.emitWsStatus();
      this.emit('log', { message: 'Trade WS open: force connected true.' });
    }
    this.emit('log', { message: 'Membuka koneksi Stream WS...' });
    this.streamSocket = createSocket('wss://ws.stockity.id/?v=2&vsn=2.0.0');
    this.emit('log', { message: 'Stream WS created.' });
    this.streamSocket.onopen = () => onOpen(this.streamSocket as WebSocketLike);
    this.streamSocket.onmessage = onMessage;
    this.streamSocket.onerror = (event: any) => {
      const detail = formatWsError('Stream', event);
      this.lastWsError.stream = detail;
      this.emit('error', { message: detail });
    };
    this.streamSocket.onclose = (event: any) => {
      this.handleSocketClose('Stream', event, this.streamSocket?.url, this.lastWsError.stream);
    };

    this.emit('log', { message: 'Menunggu koneksi Stream WS...' });
    await waitForSocketOpen(this.streamSocket, 'Stream');
    this.emit('log', { message: 'WS connected, lanjut proses bot.' });

    this.heartbeatTimer = setInterval(() => {
      if (this.streamSocket?.readyState === WS_READY_STATE.OPEN) {
        sendStreamHeartbeat(this.streamSocket);
        sendStreamPing(this.streamSocket);
      }
    }, 60000);
    this.disconnecting = false;
  }

  private scheduleReconnect() {
    if (this.status !== 'running' || !this.lastAuth) return;
    if (this.reconnectTimer) return;
    this.emit('log', { message: 'Scheduling WS reconnect...' });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectSockets(this.lastAuth as { tokenApi: string; deviceId: string; asset: string });
        this.emit('log', { message: 'WS reconnected.' });
      } catch (err) {
        this.emit('error', { message: `WS reconnect failed: ${String(err)}` });
        this.scheduleReconnect();
      }
    }, 2000);
  }

  private handleSocketClose(
    label: 'Trade' | 'Stream',
    event: any,
    socketUrl: string | undefined,
    extra?: string
  ) {
    this.resetConnectionState();
    const code = event?.code ?? 'unknown';
    const reason = event?.reason ?? 'unknown';
    const url = socketUrl ?? 'unknown';
    const detail = extra ? `\n${extra}` : '';

    if (this.status === 'running') {
      if (this.disconnecting) return;
      this.disconnecting = true;
      this.emit('error', {
        message: `${label} socket closed (${code}): ${reason} url=${url}${detail}`,
      });
      this.emit('log', { message: `${label} socket closed, attempting reconnect...` });
      this.teardownSockets();
      this.scheduleReconnect();
      return;
    }

    this.emit('log', { message: `${label} socket closed.` });
  }

  private handleSocketEvent(payload: any) {
    if (payload?.event === 'phx_reply' && payload?.topic === 'bo') {
      const uuid = payload?.payload?.response?.uuid;
      if (uuid) {
        this.pendingUUIDs.add(String(uuid));
        if (this.pendingUUIDs.size > 20) {
          const entries = Array.from(this.pendingUUIDs).slice(0, 10);
          entries.forEach((entry) => this.pendingUUIDs.delete(entry));
        }
      }
      this.bidInFlightUntil = null;
      return;
    }

    if (payload?.event === 'opened' && payload?.payload) {
      const item = payload.payload;
      const uuid = String(item.uuid ?? '');
      if (uuid && !this.pendingUUIDs.has(uuid)) {
        this.emit('log', { message: `Ignoring opened without pending UUID: ${uuid}` });
        return;
      }
      if (uuid) this.pendingUUIDs.delete(uuid);
      this.bidInFlightUntil = null;
      const assetRic = String(item.asset_ric ?? item.ric ?? '');
      const closeAt = String(item.close_quote_created_at ?? item.finished_at ?? '');
      const openRate = Number(item.open_rate ?? item.openRate ?? 0);
      const trend = String(item.trend ?? 'CALL').toLowerCase() === 'put' ? 'put' : 'call';
      const amount = this.safeNumber(item.amount);
      const payment = this.safeNumber(item.payment);
      const dealType = String(item.deal_type ?? this.currentWalletType).toLowerCase();
      if (assetRic && closeAt) {
        this.openedBids.push({
          assetRic,
          closeAt,
          openRate,
          trend,
          uuid: uuid || undefined,
          amount: amount ?? undefined,
          payment: payment ?? undefined,
          dealType: dealType === 'real' ? 'real' : 'demo',
        });
        if (this.openedBids.length > 50) {
          this.openedBids.shift();
        }
      }
      return;
    }

    if (payload?.event === 'close_deal_batch' && payload?.payload) {
      void this.handleCloseDealBatch(payload.payload);
      return;
    }

    if (payload?.event === 'balance_changed' && payload?.payload) {
      const accountType = String(payload?.payload?.account_type ?? '');
      const balance = Number(payload?.payload?.balance ?? 0);
      const currency = String(payload?.payload?.currency ?? '');
      if (accountType === 'real') this.balanceReal = balance;
      if (accountType === 'demo') this.balanceDemo = balance;
      this.emit('balance', { accountType, balance, currency });
    }
  }

  private async handleCloseDealBatch(payload: any) {
    try {
      this.emit('log', { message: `close_deal_batch: ${JSON.stringify(payload)}` });
    } catch {
      this.emit('log', { message: 'close_deal_batch: [unserializable payload]' });
    }
    const ric = String(payload?.ric ?? payload?.asset_ric ?? '');
    const finishedAt = String(payload?.finished_at ?? '');
    const endRate = Number(payload?.end_rate ?? payload?.close_rate ?? 0);
    if (!ric || !finishedAt) return;

    const batchKey = `${ric}:${finishedAt}`;
    if (this.processedBatches.has(batchKey)) return;
    this.processedBatches.add(batchKey);
    if (this.processedBatches.size > 100) {
      const entries = Array.from(this.processedBatches).slice(0, 50);
      entries.forEach((entry) => this.processedBatches.delete(entry));
    }

    const matching = this.openedBids.filter(
      (bid) => bid.assetRic === ric && bid.closeAt === finishedAt
    );
    if (matching.length === 0) {
      this.emit('log', { message: `No opened bid matches for ${batchKey}` });
      return;
    }

    this.openedBids = this.openedBids.filter(
      (bid) => !(bid.assetRic === ric && bid.closeAt === finishedAt)
    );

    for (const bid of matching) {
      const result = this.resolveOutcome(bid.trend, bid.openRate, endRate);
      const isDemoMode =
        this.forceDemo ||
        this.currentWalletType === 'demo' ||
        this.switchDemoActive ||
        this.disableRepeatAfterDemo;
      if (this.config.strategy === 'Fast') {
        if (!isDemoMode && result === 'win') {
          this.fastRepeatTrend = bid.trend;
        } else {
          this.fastRepeatTrend = null;
        }
      }
      if (result === 'win') {
        if (this.switchDemoActive) {
          this.switchDemoActive = false;
          const resumeStep = this.switchDemoStep ?? this.martingaleStep;
          this.switchDemoStep = null;
          this.forceDemo = false;
          this.currentWalletType = this.switchDemoReturnWallet ?? 'real';
          this.switchDemoReturnWallet = null;
          this.allowAutoSwitch = true;
          this.lastBidWasSwitchDemo = false;
          this.martingaleStep = resumeStep;
          this.repeatStep = 0;
          this.disableRepeatAfterDemo = true;
          this.skipStopLossOnce = true;
          this.emit('log', {
            message: `Exiting switch demo, step=${this.martingaleStep}`,
          });
          this.applyCooldown();
        } else {
          this.lossStreak = 0;
          this.martingaleStep = 0;
          this.repeatStep = 0;
          this.shouldUseSignal = true;
          this.allowAutoSwitch = true;
          this.disableRepeatAfterDemo = false;
          this.applyCooldown();
        }
      } else if (result === 'loss') {
        if (this.switchDemoActive) {
          this.emit('log', { message: 'Switch demo: loss ignored for martingale.' });
        } else {
          this.lossStreak += 1;
          const resetMartingale = Number(this.config.resetMartingale);
          if (Number.isFinite(resetMartingale)) {
            if (resetMartingale === 0) {
              this.martingaleStep = 0;
            } else if (resetMartingale > 0 && this.martingaleStep >= resetMartingale) {
              this.martingaleStep = 0;
              this.lossStreak = 0;
              this.repeatStep = 0;
              this.shouldUseSignal = true;
              this.applyCooldown();
              this.emit('log', { message: 'Reset martingale triggered' });
            } else {
              this.martingaleStep += 1;
            }
          } else {
            this.martingaleStep += 1;
          }
          this.martingaleStep = Math.min(this.martingaleStep, MAX_K_STEP);

          const maxStep = Number(this.config.maxMartingale);
          if (Number.isFinite(maxStep) && maxStep > 0) {
            if (this.repeatStep < maxStep) {
              this.repeatStep += 1;
            } else {
              this.repeatStep = 0;
            }
          } else {
            this.repeatStep = 0;
          }
          if (this.disableRepeatAfterDemo) {
            this.repeatStep = 0;
          }
          this.shouldUseSignal = this.repeatStep === 0;
        }
      }

      this.emit('log', {
        message: this.shouldUseSignal ? 'Next Bid Use Signal' : 'Next Bid Use Martingale',
      });
      this.persistBotState();
      if (this.status === 'running' && this.config.strategy === 'Fast') {
        this.emit('log', { message: 'Fast strategy: auto-bid after close_deal.' });
        this.queueFastReentry(bid.trend);
      }
    }

    await this.refreshProfitFromApi('close_deal_batch');
    this.emit('refresh', { reason: 'tracked_profit' });
    this.applyRiskRules();
  }

  private resolveOutcome(trend: Trend, openRate: number, closeRate: number) {
    if (closeRate === openRate) return 'tie';
    if (trend === 'call') {
      return closeRate > openRate ? 'win' : 'loss';
    }
    return closeRate < openRate ? 'win' : 'loss';
  }

  private findBatchDealInfo(payload: any, bid: OpenedBid) {
    const payloadData = payload?.data ?? null;
    const lists = [
      payload?.deals,
      payload?.standard_trade_deals,
      payloadData?.deals,
      payloadData?.standard_trade_deals,
    ].filter((value) => Array.isArray(value)) as any[][];
    for (const list of lists) {
      for (const deal of list) {
        const dealUuid = String(deal?.uuid ?? deal?.id ?? '');
        if (bid.uuid && dealUuid && dealUuid === bid.uuid) return deal;
        const dealRic = String(deal?.asset_ric ?? deal?.ric ?? '');
        const dealCloseAt = String(deal?.close_quote_created_at ?? deal?.finished_at ?? '');
        if (dealRic && dealCloseAt && dealRic === bid.assetRic && dealCloseAt === bid.closeAt) {
          return deal;
        }
      }
    }
    return null;
  }

  private async queueFastReentry(fallbackTrend: Trend) {
    if (this.status !== 'running') return;
    try {
      const candles = await this.fetchCandles(this.config.asset, 60);
      const trend = this.computeTrend(candles);
      const maxStep = Number(this.config.maxMartingale);
      const canRepeat =
        Number.isFinite(maxStep) && maxStep > 0 && this.repeatStep > 0;
      if (!trend) {
        if (!canRepeat) return;
        const fallback =
          this.lastSignalTrend ?? this.lastFastBidTrend ?? fallbackTrend;
        if (!fallback) return;
        this.sendBid(fallback, 0, { bypassInterval: true });
        return;
      }
      this.sendBid(trend, 0, { bypassInterval: true });
    } catch (err) {
      this.emit('error', { message: `Fast reentry failed: ${String(err)}` });
    }
  }

  private getCurrentProfit() {
    const wallet = this.forceDemo ? 'demo' : this.currentWalletType;
    return wallet === 'demo' ? this.profitDemo : this.profitReal;
  }

  private shouldSwitchToDemo() {
    return this.config.autoSwitchDemo && this.currentWalletType === 'real' && !this.switchDemoActive;
  }

  private applyRiskRules() {
    const stopLoss = Number(this.config.stopLoss);
    const stopProfitAfter = Number(this.config.stopProfitAfter);

    if (this.skipStopLossOnce) {
      this.skipStopLossOnce = false;
    } else if (!this.switchDemoActive && Number.isFinite(stopLoss) && stopLoss > 0 && this.martingaleStep > stopLoss) {
      if (this.shouldSwitchToDemo() && this.allowAutoSwitch) {
        this.switchDemoReturnWallet = 'real';
        this.currentWalletType = 'demo';
        this.forceDemo = true;
        this.switchDemoActive = true;
        this.switchDemoStep = this.martingaleStep;
        this.allowAutoSwitch = false;
        this.lastBidWasSwitchDemo = true;
        this.emit('log', { message: 'Stop loss reached, switching to demo' });
        this.persistBotState();
        return;
      }
      if (!this.config.autoSwitchDemo) {
        this.stop(`Stop loss tercapai (Step ${this.martingaleStep})`);
        return;
      }
    }

    if (Number.isFinite(stopProfitAfter) && stopProfitAfter > 0) {
      const current = this.getCurrentProfit();
      const target = stopProfitAfter * 100;
      this.emit('log', {
        message: `Stop Profit Check: current=${current}, target=${target}`,
      });
      if (current >= target) {
        this.stop('Stop profit tercapai');
      }
    }
  }

  private scheduleStrategy() {
    if (this.config.strategy === 'Signal') {
      this.scheduleSignalStrategy();
      return;
    }
    if (this.config.strategy === 'Fast') {
      this.scheduleFastStrategy();
      return;
    }
    this.scheduleIndicatorStrategy();
  }

  private scheduleFastStrategy() {
    if (this.fastInitialSent) return;
    this.scheduleFastCandleLog();
    const timer = setTimeout(() => {
      this.maybeStartFastInitialBid().catch((err) => {
        this.emit('error', { message: `Fast initial bid failed: ${String(err)}` });
      });
    }, 0);
    this.signalTimers.push(timer);
  }

  private scheduleFastCandleLog() {
    if (this.fastCandleLogScheduled) return;
    this.fastCandleLogScheduled = true;
    const scheduleNext = () => {
      if (this.status !== 'running' || this.config.strategy !== 'Fast') {
        this.fastCandleLogScheduled = false;
        return;
      }
      const now = new Date();
      const seconds = now.getSeconds();
      const ms = now.getMilliseconds();
      const secondsTo59 = (59 - seconds + 60) % 60;
      let delay = secondsTo59 * 1000 - ms;
      if (delay < 0) delay += 60000;
      const timer = setTimeout(async () => {
        if (this.status === 'running' && this.config.strategy === 'Fast') {
          try {
            const candles = await this.fetchCandles(this.config.asset, 60);
            const last = candles[candles.length - 1];
            if (last) {
              const stamp = new Date().toTimeString().split(' ')[0];
              const color =
                last.close > last.open ? 'hijau' : last.close < last.open ? 'merah' : 'doji';
              this.emit('log', {
                message: `Fast candle @:59 ${stamp} ${color}`,
              });
            } else {
              this.emit('log', { message: 'Fast candle @:59 no data' });
            }
          } catch (err) {
            this.emit('error', { message: `Fast candle log failed: ${String(err)}` });
          }
        }
        scheduleNext();
      }, delay);
      this.signalTimers.push(timer);
    };
    scheduleNext();
  }

  private scheduleSignalStrategy() {
    const signals = this.parseSignals(this.config.signalInput);
    if (signals.length === 0) {
      this.emit('error', { message: 'Tidak ada signal yang dimasukan.' });
      return;
    }
    signals.forEach((signal, index) => {
      const delay = Math.max(0, signal.time - Date.now());
      const timer = setTimeout(() => {
        this.emit('log', { message: `Signal trigger ${signal.trend} at ${new Date(signal.time)}` });
        this.queueBidAtSecondZero(signal.trend, index);
      }, delay);
      this.signalTimers.push(timer);
    });
  }

  private scheduleIndicatorStrategy() {
    const intervalMinutes = Math.max(1, Number(this.config.interval));
    const isCooldownStrategy =
      this.config.strategy === 'Momentum' || this.config.strategy === 'Flash 5st';
    const isFlash = this.config.strategy === 'Flash 5st';
    const flashIntervalMs = 5000;

    const scheduleNext = (delayMs: number) => {
      const timer = setTimeout(runTick, delayMs);
      this.signalTimers.push(timer);
    };

    const msUntilIntervalBoundary = (interval: number) => {
      const minuteMs = 60000;
      const intervalMs = Math.max(1, interval) * minuteMs;
      const now = Date.now();
      const next = Math.floor(now / minuteMs) * minuteMs + intervalMs;
      return Math.max(0, next - now);
    };

    const runTick = async () => {
      try {
        if (this.status !== 'running') return;
        if (isCooldownStrategy && this.cooldownActive) {
          this.emit('log', {
            message: `${isFlash ? 'Flash 5st' : 'Momentum'} Strategy: In cooldown (${this.cooldownCount}/${this.cooldownMax}), waiting...`,
          });
          this.cooldownCount += 1;
          if (this.cooldownCount >= this.cooldownMax) {
            this.emit('log', {
              message: `${isFlash ? 'Flash 5st' : 'Momentum'} Strategy: Cooldown finished!`,
            });
            this.cooldownActive = false;
            this.cooldownCount = 0;
          }
          scheduleNext(isFlash ? flashIntervalMs : 60000);
          return;
        }

        const candles = await this.fetchCandles(
          this.config.asset,
          this.config.strategy === 'Flash 5st' ? 1 : 60
        );
        const trend = this.computeTrend(candles);
        if (trend) {
          if (this.config.strategy === 'Momentum') {
            this.queueBidAtSecondZero(trend, 0);
          } else {
            this.sendBid(trend, 0);
          }
        } else {
          this.emit('log', { message: 'Tidak ada trend yang memenuhi, skip bid.' });
        }
      } catch (err) {
        this.emit('error', { message: `Indicator error: ${String(err)}` });
      } finally {
        if (this.status !== 'running') return;
        if (isFlash) {
          scheduleNext(flashIntervalMs);
        } else {
          scheduleNext(msUntilIntervalBoundary(intervalMinutes));
        }
      }
    };

    scheduleNext(isFlash ? flashIntervalMs : msUntilIntervalBoundary(intervalMinutes));
  }

  private parseSignals(input: string) {
    const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const regex = /^(\d{1,2})[.:](\d{2})\s+([SB])$/i;
    const result: Array<{ trend: Trend; time: number }> = [];
    lines.forEach((line) => {
      const match = line.match(regex);
      if (!match) {
        this.emit('log', { message: `Skipping invalid line: ${line}` });
        return;
      }
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      const side = match[3].toUpperCase();
      if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute > 59) {
        this.emit('log', { message: `Invalid time in signal: ${line}` });
        return;
      }
      const trend: Trend = side === 'S' ? 'put' : 'call';
      const signalTime = new Date();
      signalTime.setHours(hour, minute, 0, 0);
      if (signalTime.getTime() <= Date.now()) {
        signalTime.setDate(signalTime.getDate() + 1);
      }
      result.push({ trend, time: signalTime.getTime() });
      this.emit('log', {
        message: `Parsed signal: ${line} -> ${trend} at ${signalTime.toString()}`,
      });
    });

    result.sort((a, b) => a.time - b.time);
    this.emit('log', {
      message: `Successfully parsed ${result.length} signals from ${lines.length} lines`,
    });
    return result;
  }

  private async sendBid(trend: Trend, index: number, options?: { bypassInterval?: boolean }) {
    if (this.status !== 'running') {
      this.emit('log', { message: 'Skip bid: bot tidak berjalan.' });
      return;
    }
    this.emit('log', {
      message: `sendBid invoked trend=${trend} tradeReady=${this.tradeReady} streamReady=${this.streamReady}`,
    });
    this.emit('refresh', { reason: 'bid' });
    const nowMs = Date.now();
    if (this.config.strategy !== 'Signal' && !options?.bypassInterval) {
      const minIntervalMs =
        this.config.strategy === 'Flash 5st'
          ? 5000
          : Math.max(1, Number(this.config.interval)) * 60000;
      if (nowMs - this.lastBidAt < minIntervalMs - 250) {
        this.emit('log', {
          message: `Skip bid: interval guard (${nowMs - this.lastBidAt}ms < ${minIntervalMs}ms).`,
        });
        return;
      }
    }
    if (this.bidInFlightUntil && Date.now() < this.bidInFlightUntil) {
      this.emit('log', { message: 'Skip bid: masih menunggu respon bid sebelumnya.' });
      return;
    }
    if (this.openedBids.length > 0 || this.pendingUUIDs.size > 0) {
      this.emit('log', {
        message: `Skip bid: masih ada posisi terbuka (opened=${this.openedBids.length}, pending=${this.pendingUUIDs.size}).`,
      });
      return;
    }
    if (!this.tradeReady || !this.streamReady) {
      this.emit('error', {
        message: `WS not ready (tradeReady=${this.tradeReady}, streamReady=${this.streamReady})`,
      });
      return;
    }
    if (!this.tradeSocket || this.tradeSocket.readyState !== WS_READY_STATE.OPEN) {
      this.emit('error', {
        message: `Trade socket not connected (state=${this.tradeSocket?.readyState ?? 'null'})`,
      });
      return;
    }

    if (this.cooldownActive) {
      this.cooldownCount += 1;
      this.emit('log', {
        message: `Cooldown: ${this.cooldownCount}/${this.cooldownMax}${
          this.martingaleStep > 0 ? ' (martingale bid)' : ''
        }`,
      });
      if (this.cooldownCount <= this.cooldownMax) return;
      this.cooldownActive = false;
      this.cooldownCount = 0;
    }

    const maxStep = Number(this.config.maxMartingale);
    const canRepeat =
      Number.isFinite(maxStep) && maxStep > 0 && this.repeatStep > 0;
    const isDemoMode =
      this.forceDemo ||
      this.currentWalletType === 'demo' ||
      this.switchDemoActive ||
      this.disableRepeatAfterDemo;
    let trendToSend = trend;
    if (this.config.strategy === 'Fast') {
      if (!isDemoMode && this.fastRepeatTrend) {
        trendToSend = this.fastRepeatTrend;
        this.lastSignalTrend = trendToSend;
      } else {
        const canRepeatFast = canRepeat && !isDemoMode;
        if (canRepeatFast && this.lastSignalTrend) {
          trendToSend = this.lastSignalTrend;
        } else {
          this.lastSignalTrend = trend;
        }
      }
      this.lastFastBidTrend = trendToSend;
    } else if (canRepeat && this.lastSignalTrend) {
      trendToSend = this.lastSignalTrend;
    } else {
      this.lastSignalTrend = trend;
    }

    const amounts = this.calculateBidAmounts();
    if (amounts.length === 0) {
      this.emit('error', { message: 'Bid tidak dikirim karena jumlah bid tidak valid.' });
      return;
    }

    this.lastBidAt = nowMs;
    const now = new Date(nowMs);
    const seconds = now.getSeconds();
    const expireAtDate = new Date(now);
    const intervalMinutes = Math.max(1, Number(this.config.interval));
    expireAtDate.setMinutes(expireAtDate.getMinutes() + intervalMinutes + (seconds > 30 ? 1 : 0));
    expireAtDate.setSeconds(0, 0);

    const expireAt = Math.floor(expireAtDate.getTime() / 1000);

    if (amounts.length > 1) {
      this.emit('log', {
        message: `BID SPLIT: Total ${amounts.reduce((sum, value) => sum + value, 0)} split into ${amounts.length} bids.`,
      });
    }

    this.lastBidAmount = amounts[0] ?? null;
    amounts.forEach((amount, amountIndex) => {
      const createdAt = now.getTime() + (index + amountIndex) * 500;
      const ref = this.nextRef++;
      const joinRef =
        this.joinRefs.bo ??
        ref;
      const trendValue = trendToSend.toLowerCase();
      const payload = {
        topic: 'bo',
        event: 'create',
        payload: {
          created_at: createdAt,
          expire_at: expireAt,
          ric: this.config.asset,
          deal_type: this.forceDemo ? 'demo' : this.currentWalletType,
          option_type: this.config.strategy === 'Flash 5st' ? 'blitz' : 'turbo',
          trend: trendValue,
          tournament_id: null,
          is_state: false,
          amount,
        },
        ref: String(ref),
        join_ref: String(joinRef),
      };
      console.log(`[Bot] WS send payload { type: "${trendValue}", amount: ${amount} }`);
      const targetSocket =
        this.streamSocket?.readyState === WS_READY_STATE.OPEN
          ? this.streamSocket
          : this.tradeSocket;
      if (targetSocket) {
        const label = targetSocket === this.streamSocket ? 'stream' : 'trade';
        this.emit('log', { message: `WS send (${label}): ${JSON.stringify(payload)}` });
        targetSocket.send(JSON.stringify(payload));
      }
      this.emit('log', {
        message: `BID ${amountIndex + 1}/${amounts.length}: ${trendValue} amount=${amount} expire=${expireAt} step=${this.martingaleStep} repeat=${this.repeatStep}`,
      });
    });
    const bidCooldownMs = this.config.strategy === 'Flash 5st' ? 5000 : 10000;
    this.bidInFlightUntil = Date.now() + bidCooldownMs;
    this.lastBidStep = this.martingaleStep;
    this.lastBidWasSwitchDemo = this.forceDemo;
    this.persistBotState();
  }

  private async maybeStartFlashInitialBid() {
    if (this.config.strategy !== 'Flash 5st') return;
    if (this.flashInitialSent) return;
    if (!this.tradeReady || !this.streamReady) return;
    this.flashInitialSent = true;
    this.emit('log', { message: 'Flash 5st: initial bid buy after WS ready.' });
    this.sendBid('call', 0);
  }

  private async maybeStartFastInitialBid() {
    if (this.config.strategy !== 'Fast') return;
    if (this.fastInitialSent) return;
    if (!this.tradeReady || !this.streamReady) return;
    this.fastInitialSent = true;
    this.emit('log', { message: 'Fast: initial bid after WS ready.' });
    try {
      const candles = await this.fetchCandles(this.config.asset, 60);
      const trend = this.computeTrend(candles);
      if (!trend) {
        this.emit('log', { message: 'Fast: no trend, skip initial bid.' });
        return;
      }
      this.sendBid(trend, 0, { bypassInterval: true });
    } catch (err) {
      this.emit('error', { message: `Fast initial bid error: ${String(err)}` });
    }
  }

  private queueBidAtSecondZero(trend: Trend, index: number, options?: { bypassInterval?: boolean }) {
    const now = new Date();
    if (now.getSeconds() === 0) {
      this.sendBid(trend, index, options);
      return;
    }
    const delay = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    this.emit('log', {
      message: `Aligning bid to detik 00 in ${delay}ms`,
    });
    const timer = setTimeout(() => {
      this.sendBid(trend, index, options);
    }, delay);
    this.signalTimers.push(timer);
  }

  private calculateBidAmounts() {
    const base = this.safeNumber(this.getBidAmountForCurrency()) ?? 0;
    this.emit('log', {
      message: `Bid amount base=${base} currency=${this.userCurrency.toUpperCase()}`,
    });
    const percent = this.safeNumber(this.config.martingale) ?? 0;
    const resetMartingale = Number(this.config.resetMartingale);
    let step = this.martingaleStep;
    if (this.switchDemoActive) {
      step = 0;
    }
    step = Math.min(step, MAX_K_STEP);
    if (Number.isFinite(resetMartingale)) {
      if (resetMartingale === 0) {
        step = 0;
      } else if (resetMartingale > 0) {
        step = Math.min(step, resetMartingale);
      }
    }
    const rate = percent > 0 ? percent / 100 : 1;
    let amount = Math.round(base);
    if (step > 0) {
      let total = Math.round(base);
      for (let i = 1; i <= step; i += 1) {
        amount = Math.round(total * rate);
        total += amount;
      }
    }

    const currency = this.userCurrency.toUpperCase();
    const minBid = (MIN_BID_BY_CURRENCY[currency] ?? MIN_BID_BY_CURRENCY.IDR) * 100;
    const maxBid = (MAX_BID_BY_CURRENCY[currency] ?? MAX_BID_BY_CURRENCY.IDR) * 100;
    const rawAmount = Math.round(amount * 100);

    if (rawAmount <= 0) {
      this.emit('error', { message: 'Bid amount <= 0, cek konfigurasi jumlah bid.' });
      return [];
    }
    if (rawAmount < minBid) {
      this.emit('error', { message: `Bid amount di bawah minimum (${minBid}).` });
      return [];
    }
    if (rawAmount > maxBid) {
      return this.splitBidAmounts(rawAmount, minBid, maxBid);
    }

    const dealType = this.forceDemo ? 'demo' : this.currentWalletType;
    const availableBalance = dealType === 'demo' ? this.balanceDemo : this.balanceReal;
    if (availableBalance > 0 && rawAmount > availableBalance) {
      this.emit('error', { message: `Saldo tidak cukup untuk ${dealType}` });
      this.stop('Saldo tidak cukup');
      return [];
    }

    return [rawAmount];
  }

  private getBidAmountForCurrency() {
    const currency = this.userCurrency.toUpperCase();
    if (currency === 'USD') return this.config.bidAmountUsd ?? this.config.bidAmount;
    if (currency === 'EUR') return this.config.bidAmountEur ?? this.config.bidAmount;
    return this.config.bidAmountIdr ?? this.config.bidAmount;
  }

  private splitBidAmounts(total: number, minBid: number, maxBid: number) {
    if (total <= maxBid) return [total];
    const chunks: number[] = [];
    let remaining = total;

    while (remaining > 0) {
      if (remaining <= maxBid) {
        chunks.push(remaining);
        break;
      }
      let next = maxBid;
      const remainder = remaining - next;
      if (remainder > 0 && remainder < minBid) {
        next = remaining - minBid;
      }
      chunks.push(next);
      remaining -= next;
    }

    return chunks;
  }

  private applyCooldown() {
    if (this.config.strategy !== 'Momentum' && this.config.strategy !== 'Flash 5st') return;
    this.cooldownActive = true;
    this.cooldownCount = 1;
    this.emit('log', {
      message: `Reset to step 0, starting cooldown: 1/${this.cooldownMax}`,
    });
  }

  private async resumeState() {
    try {
      const state = await this.computeResumeState();
      this.applyResumeState(state);
    } catch (err) {
      this.emit('error', { message: `Resume failed: ${String(err)}` });
    }
  }

  private async loadStoredConfig(): Promise<TradeConfig | null> {
    try {
      const raw = await loadTradeSettings();
      if (!raw) {
        this.emit('log', { message: 'No settings found, using defaults' });
        return null;
      }
      this.emit('log', { message: `Loading settings from storage: ${raw}` });
      const parsed = JSON.parse(raw) as TradeConfig;
      return normalizeTradeConfig(parsed);
    } catch (err) {
      this.emit('error', { message: `Error parsing settings JSON: ${String(err)}` });
      return null;
    }
  }

  async checkResumeState(): Promise<ResumeState> {
    await this.loadBotState();
    const state = await this.computeResumeState();
    this.pendingResumeState = state.shouldResume ? state : null;
    return state;
  }

  private async computeResumeState(): Promise<ResumeState> {
    const requests = await Promise.allSettled([
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=demo'),
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=real'),
    ]);
    const list: DealItem[] = [];
    requests.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const payload = result.value.data ?? {};
      const deals =
        payload.data?.standard_trade_deals ??
        payload.standard_trade_deals ??
        payload.data?.deals ??
        payload.deals ??
        [];
      if (Array.isArray(deals)) list.push(...deals);
    });

    const openedDeals = list.filter((item) => item.status === 'opened');
    if (openedDeals.length > 0) {
      const resumeStep = this.lastBidStep + 1;
      return {
        shouldResume: true,
        resumeStep,
        reason: 'UNCLOSED_BID',
        lastDeal: openedDeals[0],
      };
    }

    const lastDeal = list
      .filter((item) => item.created_at)
      .sort((a, b) => Number(new Date(b.created_at ?? 0)) - Number(new Date(a.created_at ?? 0)))[0];

    if (!lastDeal) {
      return { shouldResume: false, resumeStep: 0, reason: 'NONE', lastDeal: null };
    }

    const winValue = this.safeNumber(lastDeal.win);
    if (winValue === 0) {
      return {
        shouldResume: true,
        resumeStep: this.lastBidStep + 1,
        reason: 'LAST_BID_LOST',
        lastDeal,
      };
    }

    if (winValue && this.lastBidWasSwitchDemo) {
      return {
        shouldResume: true,
        resumeStep: this.lastBidStep + 1,
        reason: 'LAST_BID_WON_IN_SWITCH_DEMO',
        lastDeal,
      };
    }

    return { shouldResume: false, resumeStep: 0, reason: 'NONE', lastDeal };
  }

  private applyResumeState(state: ResumeState) {
    if (!state.shouldResume) return;
    if (state.reason === 'UNCLOSED_BID' || state.reason === 'LAST_BID_LOST') {
      this.martingaleStep = Math.min(this.clampStep(state.resumeStep), MAX_K_STEP);
      this.repeatStep = 0;
      this.shouldUseSignal = true;
      this.emit('log', { message: `Resume: ${state.reason}` });
      return;
    }
    if (state.reason === 'LAST_BID_WON_IN_SWITCH_DEMO') {
      this.forceDemo = false;
      this.currentWalletType = this.config.walletType;
      this.allowAutoSwitch = false;
      this.martingaleStep = 0;
      this.lossStreak = 0;
      this.emit('log', { message: 'Resume: last bid won in switch demo' });
    }
  }

  private async refreshBalances() {
    try {
      const response = await apiV2.get('/bank/v1/read');
      const payload = response.data ?? {};
      const wallets = Array.isArray(payload?.data)
        ? payload.data
        : payload?.data?.wallets ?? payload?.wallets ?? [];
      if (Array.isArray(wallets)) {
        wallets.forEach((item: any) => {
          const type = String(item.account_type ?? item.type ?? '').toLowerCase();
          const balance = this.safeNumber(item.balance ?? item.amount ?? item.value);
          const currency = String(item.currency ?? item.cur ?? item.ccy ?? '').toUpperCase();
          if (balance === null) return;
          if (type === 'real') this.balanceReal = balance;
          if (type === 'demo') this.balanceDemo = balance;
          if (currency) this.userCurrency = currency;
        });
      }
    } catch (err) {
      this.emit('error', { message: `Balance refresh failed: ${String(err)}` });
    }
  }

  private extractDeals(payload: DealsResponse): DealItem[] {
    return (
      payload.data?.standard_trade_deals ??
      payload.standard_trade_deals ??
      payload.data?.deals ??
      payload.deals ??
      []
    );
  }

  private getDealDateKey(deal: DealItem) {
    const raw = deal.close_quote_created_at ?? deal.created_at ?? null;
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  private getDealProfitDelta(deal: DealItem) {
    const amount = this.safeNumber(deal.amount) ?? 0;
    const winValue = this.safeNumber(
      (deal as DealItem & { won?: number }).won ?? deal.win ?? deal.payment
    );
    if (winValue === null) return null;
    return winValue - amount;
  }

  private async refreshProfitFromApi(reason?: string) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const [demoResult, realResult] = await Promise.allSettled([
        apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=demo'),
        apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=real'),
      ]);
      let demoTotal = 0;
      let realTotal = 0;

      if (demoResult.status === 'fulfilled') {
        const deals = this.extractDeals(demoResult.value.data ?? {});
        deals.forEach((deal) => {
          if (deal.status && String(deal.status).toLowerCase() === 'opened') return;
          if (this.getDealDateKey(deal) !== today) return;
          const delta = this.getDealProfitDelta(deal);
          if (delta === null) return;
          demoTotal += delta;
        });
      }

      if (realResult.status === 'fulfilled') {
        const deals = this.extractDeals(realResult.value.data ?? {});
        deals.forEach((deal) => {
          if (deal.status && String(deal.status).toLowerCase() === 'opened') return;
          if (this.getDealDateKey(deal) !== today) return;
          const delta = this.getDealProfitDelta(deal);
          if (delta === null) return;
          realTotal += delta;
        });
      }

      this.profitDemo = demoTotal;
      this.profitReal = realTotal;
      this.totalProfit = demoTotal + realTotal;
      if (reason) {
        this.emit('log', {
          message: `Tracked profit (${reason}): real=${realTotal} demo=${demoTotal}`,
        });
      }
      this.sendStreamPing('tracked_profit');
    } catch (err) {
      this.emit('error', { message: `Error refreshing profit: ${String(err)}` });
    }
  }

  private sendStreamPing(reason: string) {
    if (this.streamSocket?.readyState !== WS_READY_STATE.OPEN) return;
    const ref = this.nextRef++;
    const joinRef = this.joinRefs.connection ?? this.joinRefs[`asset:${this.config.asset}`];
    const payload = joinRef
      ? { topic: 'connection', event: 'ping', payload: {}, ref: String(ref), join_ref: String(joinRef) }
      : { topic: 'connection', event: 'ping', payload: {}, ref: String(ref) };
    this.emit('log', { message: `WS send (ping:${reason}): ${JSON.stringify(payload)}` });
    this.streamSocket.send(JSON.stringify(payload));
  }

  private async fetchCandles(asset: string, intervalSeconds = 60): Promise<CandlePoint[]> {
    const date = new Date();
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const iso = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(
      utc.getUTCDate()
    ).padStart(2, '0')}T00:00:00`;
    const localeSuffix =
      intervalSeconds === 1 ? '?locale=id' : '';
    const response = await apiV2.get(
      `/candles/v1/${encodeURIComponent(asset)}/${iso}/${intervalSeconds}${localeSuffix}`
    );
    const data = response.data?.data ?? response.data ?? [];
    if (!Array.isArray(data)) return [];

    return data
      .map((item: any) => {
        if (Array.isArray(item) && item.length >= 4) {
          return { open: Number(item[1]), close: Number(item[2]) };
        }
        if (item && typeof item === 'object') {
          return { open: Number(item.open ?? item.o), close: Number(item.close ?? item.c) };
        }
        return null;
      })
      .filter(Boolean) as CandlePoint[];
  }

  private computeTrend(candles: CandlePoint[]): Trend | null {
    if (candles.length < 1) return null;
    const closes = candles.map((c) => c.close);
    if (this.config.strategy === 'Momentum') {
      if (candles.length < 2) return null;
      const prev = candles[candles.length - 2];
      const last = candles[candles.length - 1];
      const prevIsGreen = prev.close > prev.open;
      const prevIsRed = prev.close < prev.open;
      const lastIsGreen = last.close > last.open;
      const lastIsRed = last.close < last.open;
      if (prevIsGreen && lastIsGreen) {
        this.momentumNoSignalSince = null;
        return 'call';
      }
      if (prevIsRed && lastIsRed) {
        this.momentumNoSignalSince = null;
        return 'put';
      }
      if (!this.momentumNoSignalSince) {
        this.momentumNoSignalSince = Date.now();
        return null;
      }
      if (Date.now() - this.momentumNoSignalSince >= 5 * 60 * 1000) {
        if (lastIsGreen) {
          this.momentumNoSignalSince = null;
          return 'call';
        }
        if (lastIsRed) {
          this.momentumNoSignalSince = null;
          return 'put';
        }
      }
      return null;
    }

    if (this.config.strategy === 'Fast') {
      const candle = candles[candles.length - 1];
      if (!candle) return null;
      if (candle.close > candle.open) return 'call';
      if (candle.close < candle.open) return 'put';
      const prev = candles[candles.length - 2];
      if (prev) {
        if (prev.close > prev.open) return 'call';
        if (prev.close < prev.open) return 'put';
      }
      return this.lastFastBidTrend ?? this.lastSignalTrend;
    }

    if (this.config.strategy === 'Flash 5st') {
      const boll = this.computeBollinger(closes, 20, 2);
      if (!boll) {
        this.emit('log', { message: 'Flash 5st: Bollinger belum cukup data.' });
        console.log('Flash 5st: Bollinger belum cukup data.');
        return null;
      }
      if (candles.length < 2) {
        this.emit('log', { message: 'Flash 5st: candle kurang dari 2.' });
        console.log('Flash 5st: candle kurang dari 2.');
        return null;
      }
      const prev = candles[candles.length - 2];
      const last = candles[candles.length - 1];
      const prevClose = prev.close;
      const lastClose = last.close;
      const lastOpen = last.open;
      const bandWidth = boll.upper - boll.lower;
      const eps = Math.max(1e-6, bandWidth * 0.1);
      const snapshot = {
        prevClose,
        lastOpen,
        lastClose,
        lower: Number(boll.lower.toFixed(6)),
        middle: Number(boll.middle.toFixed(6)),
        upper: Number(boll.upper.toFixed(6)),
        bandWidth: Number(bandWidth.toFixed(6)),
        eps: Number(eps.toFixed(6)),
      };

      if (bandWidth <= eps) {
        const flatTrend =
          lastClose > lastOpen
            ? 'call'
            : lastClose < lastOpen
              ? 'put'
              : this.lastSignalTrend ?? this.lastFastBidTrend;
        this.emit('log', {
          message: `Flash 5st: flat band fallback -> ${flatTrend ?? 'none'} ${JSON.stringify(snapshot)}`,
        });
        console.log('Flash 5st: flat band fallback', flatTrend, snapshot);
        return flatTrend;
      }

      if (prevClose <= boll.lower + eps && lastClose >= boll.lower + eps && lastClose > lastOpen) {
        this.emit('log', { message: `Flash 5st: bounce lower -> call ${JSON.stringify(snapshot)}` });
        console.log('Flash 5st: bounce lower -> call', snapshot);
        return 'call';
      }
      if (prevClose >= boll.upper - eps && lastClose <= boll.upper - eps && lastClose < lastOpen) {
        this.emit('log', { message: `Flash 5st: bounce upper -> put ${JSON.stringify(snapshot)}` });
        console.log('Flash 5st: bounce upper -> put', snapshot);
        return 'put';
      }
      if (prevClose >= boll.middle + eps && lastClose <= boll.middle - eps) {
        this.emit('log', { message: `Flash 5st: cross down middle -> put ${JSON.stringify(snapshot)}` });
        console.log('Flash 5st: cross down middle -> put', snapshot);
        return 'put';
      }
      if (prevClose <= boll.middle - eps && lastClose >= boll.middle + eps) {
        this.emit('log', { message: `Flash 5st: cross up middle -> call ${JSON.stringify(snapshot)}` });
        console.log('Flash 5st: cross up middle -> call', snapshot);
        return 'call';
      }
      this.emit('log', { message: `Flash 5st: no signal ${JSON.stringify(snapshot)}` });
      console.log('Flash 5st: no signal', snapshot);
      return null;
    }

    return null;
  }

  private computeEMA(values: number[], period: number) {
    if (!Number.isFinite(period) || period <= 0 || values.length < period) return null;
    const k = 2 / (period + 1);
    let ema = values[0];
    values.slice(1).forEach((value) => {
      ema = value * k + ema * (1 - k);
    });
    return ema;
  }

  private computeRSI(values: number[], period: number) {
    if (!Number.isFinite(period) || period <= 0 || values.length <= period) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let rs = gains / (losses || 1);
    let rsi = 100 - 100 / (1 + rs);
    for (let i = period + 1; i < values.length; i += 1) {
      const diff = values[i] - values[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
      rs = gains / (losses || 1);
      rsi = 100 - 100 / (1 + rs);
    }
    return rsi;
  }

  private computeMACD(values: number[], fast: number, slow: number, signal: number) {
    if (values.length < Math.max(fast, slow, signal)) return null;
    const emaFastSeries = this.computeEMASeries(values, fast);
    const emaSlowSeries = this.computeEMASeries(values, slow);
    if (!emaFastSeries || !emaSlowSeries) return null;
    const macdSeries = emaFastSeries.map((value, idx) => value - emaSlowSeries[idx]);
    const signalSeries = this.computeEMASeries(macdSeries, signal);
    if (!signalSeries) return null;
    return {
      macd: macdSeries[macdSeries.length - 1],
      signal: signalSeries[signalSeries.length - 1],
    };
  }

  private computeEMASeries(values: number[], period: number) {
    if (!Number.isFinite(period) || period <= 0 || values.length < period) return null;
    const k = 2 / (period + 1);
    const series: number[] = [];
    let ema = values[0];
    series.push(ema);
    for (let i = 1; i < values.length; i += 1) {
      ema = values[i] * k + ema * (1 - k);
      series.push(ema);
    }
    return series;
  }

  private computeBollinger(values: number[], period: number, mult: number) {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    const mean = slice.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      slice.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    return {
      upper: mean + mult * std,
      middle: mean,
      lower: mean - mult * std,
    };
  }

  private clampStep(step: number) {
    const resetMartingale = Number(this.config.resetMartingale);
    if (!Number.isFinite(resetMartingale)) return Math.max(0, step);
    if (resetMartingale === 0) return 0;
    if (resetMartingale > 0) return Math.max(0, Math.min(step, resetMartingale));
    return Math.max(0, step);
  }

  private async loadBotState() {
    try {
      const raw = await AsyncStorage.getItem(BOT_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as BotState;
      this.lastBidStep = Number.isFinite(state?.lastStep) ? Number(state.lastStep) : 0;
      this.lastBidWasSwitchDemo = Boolean(state?.lastWasSwitchDemo);
      this.lastSignalTrend = state?.lastTrend ?? this.lastSignalTrend;
      this.lastFastBidTrend = this.lastSignalTrend;
      this.fastRepeatTrend = null;
      this.lastBidAmount =
        Number.isFinite(state?.lastAmount) ? Number(state.lastAmount) : this.lastBidAmount;
    } catch {
      this.lastBidStep = 0;
      this.lastBidWasSwitchDemo = false;
      this.lastSignalTrend = null;
      this.lastFastBidTrend = null;
      this.lastBidAmount = null;
    }
  }

  private async persistBotState() {
    const payload: BotState = {
      lastStep: this.lastBidStep,
      lastWasSwitchDemo: this.lastBidWasSwitchDemo,
      lastTrend: this.lastSignalTrend,
      lastAmount: this.lastBidAmount,
    };
    try {
      await AsyncStorage.setItem(BOT_STATE_KEY, JSON.stringify(payload));
    } catch {
      // ignore persistence errors
    }
  }

  private safeNumber(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric;
  }
}

export const botService = new BotService();
export type { BotStatus };
