import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from '@react-navigation/native';

import { apiV2 } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { botService } from '@/lib/bot-service';
import { getThemeColors } from '@/constants/theme';
import { ensureNotificationPermission, sendLocalNotification } from '@/lib/notifications';
import assetList from '@/lib/asset-list.json';
import { loadTradeSettings, saveTradeSettings } from '@/lib/storage';
import {
  DEFAULT_TRADE_CONFIG,
  MAX_MARTINGALE_OPTIONS,
  MARTINGALE_OPTIONS,
  normalizeTradeConfig,
  RESET_MARTINGALE_OPTIONS,
  STOP_LOSS_OPTIONS,
  STRATEGY_OPTIONS,
  TradeConfig,
} from '@/lib/trade-config';
import * as Notifications from 'expo-notifications';
import { useThemeSettings } from '@/lib/theme-context';

type WalletSummary = {
  label: string;
  value: string;
};

type AssetOption = {
  ric: string;
  name: string;
};

type DealItem = {
  status?: string;
  amount?: number | null;
  win?: number | null;
  won?: number | null;
  payment?: number | null;
  created_at?: string;
  createdAt?: string;
  finished_at?: string;
  close_quote_created_at?: string;
  trend?: string;
  deal_type?: string;
  ric?: string;
  asset_ric?: string;
};

type DealsResponse = {
  data?: {
    standard_trade_deals?: DealItem[];
    deals?: DealItem[];
  };
  standard_trade_deals?: DealItem[];
  deals?: DealItem[];
};

type AlertAction = {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onPress?: () => void;
};

export default function TradingScreen() {
  const { colors } = useThemeSettings();
  const { userProfile } = useAuth();
  const [walletSummary, setWalletSummary] = useState<WalletSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botStatus, setBotStatus] = useState<'idle' | 'starting' | 'running' | 'stopped' | 'error'>(
    'idle'
  );
  const [isStarting, setIsStarting] = useState(false);
  const [wsStatus, setWsStatus] = useState({ trade: false, stream: false });
  const [profitToday, setProfitToday] = useState<number>(0);
  const [recentDeals, setRecentDeals] = useState<DealItem[]>([]);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [assetSelectOpen, setAssetSelectOpen] = useState(false);
  const [assetQuery, setAssetQuery] = useState('');
  const [openSelect, setOpenSelect] = useState<
    'interval' | 'martingale' | 'maxMartingale' | 'resetMartingale' | 'stopLoss' | null
  >(null);
  const [isMartingaleOpen, setIsMartingaleOpen] = useState(false);
  const [config, setConfig] = useState<TradeConfig>(DEFAULT_TRADE_CONFIG);
  const [resumeEnabled, setResumeEnabled] = useState(false);
  const [resumeStep, setResumeStep] = useState('');
  const savedConfigRef = useRef<string>(JSON.stringify(DEFAULT_TRADE_CONFIG));
  const [botLogs, setBotLogs] = useState<
    Array<{ type: 'log' | 'error'; message: string; time: string }>
  >([]);
  const lastNotifiedStatus = useRef<'running' | 'stopped' | null>(null);
  const [alertState, setAlertState] = useState<{
    visible: boolean;
    title: string;
    message?: string;
    actions: AlertAction[];
  }>({
    visible: false,
    title: '',
    message: '',
    actions: [],
  });

  const apiReady = Boolean(apiV2.defaults.baseURL);
  const userCurrency = (userProfile?.currency || config.currency || 'IDR').toUpperCase();
  const isWsConnected = wsStatus.trade && wsStatus.stream;
  const isBotRunning = botStatus === 'running' && isWsConnected;
  const startButtonLabel = isStarting
    ? 'Bot sedang dimulai'
    : isBotRunning
      ? 'Hentikan Bot'
      : 'Mulai Bot';
  const bidLabel =
    userCurrency.toUpperCase() === 'USD'
      ? 'Jumlah Bid USD'
      : userCurrency.toUpperCase() === 'EUR'
        ? 'Jumlah Bid EUR'
        : 'Jumlah Bid IDR';
  const bidAmountValue =
    userCurrency.toUpperCase() === 'USD'
      ? config.bidAmountUsd
      : userCurrency.toUpperCase() === 'EUR'
        ? config.bidAmountEur
        : config.bidAmountIdr;

  const assetOptions = assetList as AssetOption[];
  const strategyOptions = STRATEGY_OPTIONS;
  const selectedAsset = assetOptions.find((item) => item.ric === config.asset);
  const isFlash = config.strategy === 'Flash 5st';
  const filteredAssets = useMemo(() => {
    return assetOptions.filter((item) => {
      if (!assetQuery.trim()) return true;
      const query = assetQuery.trim().toLowerCase();
      return (
        item.ric.toLowerCase().includes(query) || item.name.toLowerCase().includes(query)
      );
    });
  }, [assetOptions, assetQuery]);

  const isConfigDirty = useMemo(
    () => JSON.stringify(config) !== savedConfigRef.current,
    [config]
  );

  const openConfigModal = async () => {
    setAssetSelectOpen(false);
    setAssetQuery('');
    const stored = await loadTradeSettings();
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as TradeConfig;
        const normalized = normalizeTradeConfig(parsed);
        setConfig(normalized);
        savedConfigRef.current = JSON.stringify(normalized);
      } catch {
        setConfig(DEFAULT_TRADE_CONFIG);
        savedConfigRef.current = JSON.stringify(DEFAULT_TRADE_CONFIG);
      }
    } else {
      setConfig(DEFAULT_TRADE_CONFIG);
      savedConfigRef.current = JSON.stringify(DEFAULT_TRADE_CONFIG);
    }
    setIsConfigOpen(true);
  };

  useEffect(() => {
    if (config.strategy !== 'Flash 5st') return;
    if (config.asset === 'Z-CRY/IDX' && config.interval === '1') return;
    setConfig((prev) => ({
      ...prev,
      asset: 'Z-CRY/IDX',
      interval: '1',
    }));
    setAssetSelectOpen(false);
    setAssetQuery('');
  }, [config.strategy, config.asset, config.interval]);

  const closeConfigModal = () => {
    if (!isConfigDirty) {
      setIsConfigOpen(false);
      return;
    }
    setAlertState({
      visible: true,
      title: 'Perubahan belum disimpan',
      message: 'Ada konfigurasi yang belum di simpan',
      actions: [
        { label: 'Batal', variant: 'secondary' },
        {
          label: 'Tutup',
          variant: 'danger',
          onPress: () => setIsConfigOpen(false),
        },
      ],
    });
  };

  const handleSaveConfig = async () => {
    const updated = { ...config, currency: userCurrency };
    const payload = JSON.stringify(updated);
    await saveTradeSettings(payload);
    savedConfigRef.current = payload;
    setIsConfigOpen(false);

    if (botStatus === 'running') {
      setIsStarting(true);
      setError(null);
      try {
        botService.stop('Konfigurasi diperbarui');
        await botService.start(normalizeTradeConfig(updated), null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Gagal menerapkan konfigurasi.';
        setError(message);
        setBotStatus('error');
      } finally {
        setIsStarting(false);
      }
    }
  };

  const handleCopyLogs = async () => {
    const lines = botLogs
      .slice()
      .reverse()
      .map((entry) => `[${entry.time}] ${entry.type.toUpperCase()}: ${entry.message}`);
    const text = lines.join('\n');
    await Clipboard.setStringAsync(text);
    setAlertState({
      visible: true,
      title: 'Log disalin',
      message: 'Log bot sudah disalin ke clipboard.',
      actions: [{ label: 'OK', variant: 'primary' }],
    });
  };

  const martingaleOptions = MARTINGALE_OPTIONS;
  const maxMartingaleOptions = MAX_MARTINGALE_OPTIONS;
  const resetMartingaleOptions = RESET_MARTINGALE_OPTIONS;
  const stopLossOptions = STOP_LOSS_OPTIONS;
  const intervalOptions = Array.from({ length: 10 }, (_, i) => String(i + 1));

  const martingaleSteps = useMemo(() => {
    const base = Number(bidAmountValue);
    const percent = Number(config.martingale);
    if (!Number.isFinite(base) || !Number.isFinite(percent)) {
      return [];
    }
    const rate = percent > 0 ? percent / 100 : 1;
    const steps = [];
    let total = base;
    const amount0 = Math.round(base);
    steps.push({ step: 0, amount: amount0, profit: Math.round(amount0 * 0.85) });
    for (let i = 1; i <= 10; i += 1) {
      const amount = Math.round(total * rate);
      total += amount;
      const profit = Math.round(amount * 0.85);
      steps.push({ step: i, amount, profit });
    }
    return steps;
  }, [bidAmountValue, config.martingale]);

  const isSameDay = (iso: string, target: Date) => {
    const date = new Date(iso);
    return (
      date.getFullYear() === target.getFullYear() &&
      date.getMonth() === target.getMonth() &&
      date.getDate() === target.getDate()
    );
  };

  const normalizeAmount = (value: number | string | null | undefined) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric / 100;
  };

  const getDealCreatedAt = (deal: DealItem) =>
    deal.created_at ?? deal.createdAt ?? deal.finished_at ?? deal.close_quote_created_at;

  const getDealAmount = (deal: DealItem) => normalizeAmount(deal.amount);

  const getDealWin = (deal: DealItem) =>
    normalizeAmount(deal.won ?? deal.win ?? deal.payment);

  const formatMoney = (value: number, code: string) => {
    try {
      return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: code.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      const symbol = code.toUpperCase() === 'IDR' ? 'Rp' : code.toUpperCase();
      return `${symbol} ${value.toLocaleString('id-ID')}`;
    }
  };

  const formatDealResult = (deal: DealItem) => {
    const amount = getDealAmount(deal);
    const win = getDealWin(deal);
    if (deal.status === 'won' && win !== null) {
      return `+${formatMoney((win - (amount || 0)), userCurrency)}`;
    }
    if (deal.status === 'lost' && amount !== null) {
      return `-${formatMoney(amount, userCurrency)}`;
    }
    if (amount !== null) {
      return formatMoney(amount, userCurrency);
    }
    return '-';
  };

  const fetchWallet = async () => {
    const response = await apiV2.get('/bank/v1/read');
    const payload = response.data ?? {};
    const summary: WalletSummary[] = [];

    if (payload?.data?.wallets && Array.isArray(payload.data.wallets)) {
      payload.data.wallets.forEach((wallet: any) => {
        const currency = String(wallet.currency ?? '');
        const balance = wallet.balance ?? wallet.amount ?? wallet.value;
        if (currency) {
          summary.push({ label: currency.toUpperCase(), value: String(balance ?? '-') });
        }
      });
    }

    if (summary.length === 0) {
      const fallback = payload?.data?.balance ?? payload?.balance ?? payload?.data?.amount;
      summary.push({ label: 'Saldo', value: fallback ? String(fallback) : 'Tidak tersedia' });
    }

    setWalletSummary(summary);
  };

  const extractDeals = (payload: DealsResponse): DealItem[] => {
    return (
      payload.data?.standard_trade_deals ??
      payload.standard_trade_deals ??
      payload.data?.deals ??
      payload.deals ??
      []
    );
  };

  const getDealDateKey = (deal: DealItem) => {
    const raw = deal.close_quote_created_at ?? deal.created_at ?? '';
    if (!raw) return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  };

  const getDealProfitDelta = (deal: DealItem) => {
    const amount = Number(deal.amount ?? 0);
    const winValue =
      typeof (deal as DealItem & { won?: number }).won === 'number'
        ? (deal as DealItem & { won?: number }).won
        : typeof deal.win === 'number'
          ? deal.win
          : typeof deal.payment === 'number'
            ? deal.payment
            : null;
    if (winValue === null) return 0;
    return winValue - amount;
  };

  const fetchProfitToday = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const requests = await Promise.allSettled([
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=demo'),
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=real'),
    ]);
    let total = 0;

    requests.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const deals = extractDeals(result.value.data ?? {});
      deals.forEach((deal) => {
        if (deal.status && String(deal.status).toLowerCase() === 'opened') return;
        if (getDealDateKey(deal) !== today) return;
        total += getDealProfitDelta(deal);
      });
    });

    const normalized = total / 100;
    setProfitToday(Number.isFinite(normalized) ? normalized : 0);
  };

  const fetchRecentDeals = async () => {
    const requests = await Promise.allSettled([
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=demo'),
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=real'),
    ]);
    const list: DealItem[] = [];
    requests.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const deals = extractDeals(result.value.data ?? {});
      if (Array.isArray(deals)) list.push(...deals);
    });
    const sorted = list
      .filter((deal) => deal.created_at)
      .sort(
        (a, b) =>
          Number(new Date(b.created_at ?? 0)) - Number(new Date(a.created_at ?? 0))
      );
    setRecentDeals(sorted.slice(0, 5));
  };

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      if (!apiV2.defaults.baseURL) {
        throw new Error('Bot belum tersedia. Login terlebih dahulu.');
      }
      await Promise.all([fetchWallet(), fetchProfitToday(), fetchRecentDeals()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data trading.');
    }
  }, [apiReady]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const startBot = async (mode: 'resume' | 'fresh') => {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
    const permission = await ensureNotificationPermission();
    const granted =
      permission.granted ||
      permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

    if (!granted) {
      setAlertState({
        visible: true,
        title: 'Izin notifikasi dibutuhkan',
        message: 'Bot memerlukan izin notifikasi. Aktifkan izin notifikasi untuk menjalankan bot.',
        actions: [{ label: 'OK', variant: 'primary' }],
      });
      setIsStarting(false);
      return;
    }

    try {
      const storedSettings = await loadTradeSettings();
      let settingsConfig = config;
      if (storedSettings) {
        try {
          settingsConfig = normalizeTradeConfig(JSON.parse(storedSettings));
        } catch {
          settingsConfig = config;
        }
      }
      if (!settingsConfig.currency) {
        settingsConfig = {
          ...settingsConfig,
          currency: (userProfile?.currency || 'IDR').toUpperCase(),
        };
      }

      let resumeState = null as null | {
        shouldResume: true;
        resumeStep: number;
        reason: 'UNCLOSED_BID' | 'LAST_BID_LOST' | 'LAST_BID_WON_IN_SWITCH_DEMO';
      };
      if (mode === 'resume') {
        const state = await botService.checkResumeState();
        if (state.shouldResume) {
          resumeState = {
            shouldResume: true,
            resumeStep: state.resumeStep,
            reason: state.reason,
          };
        }
      }

      await botService.start(settingsConfig, resumeState);
      await sendLocalNotification({
        title: 'Koala sedang bekerja',
        body: 'Bot sedang berjalan.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menjalankan bot.';
      setError(message);
      setBotStatus('error');
    } finally {
      setIsStarting(false);
    }
  };

  const handleToggleBot = async () => {
    if (isBotRunning) {
      botService.stop();
      setBotLogs([]);
      await sendLocalNotification({
        title: 'Bot dihentikan',
        body: 'Bot di hentikan.',
      });
      return;
    }
    if (isStarting) return;
    setAlertState({
      visible: true,
      title: 'Mulai Bot',
      message: 'Ingin melanjutkan posisi terakhir atau mulai fresh dari nol?',
      actions: [
        {
          label: 'Fresh dari nol',
          variant: 'secondary',
          onPress: () => startBot('fresh'),
        },
        {
          label: 'Lanjutkan',
          variant: 'primary',
          onPress: () => startBot('resume'),
        },
      ],
    });
  };

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!apiReady) return;
      if (!realtimeTimerRef.current) {
        realtimeTimerRef.current = setInterval(() => {
          loadData().catch(() => undefined);
        }, 5000);
      }
      return () => {
        if (realtimeTimerRef.current) {
          clearInterval(realtimeTimerRef.current);
          realtimeTimerRef.current = null;
        }
      };
    }, [apiReady, loadData])
  );

  useEffect(() => {
    const offStatus = botService.on('status', ({ status }) => {
      setBotStatus(status);
      if (status === 'running' && lastNotifiedStatus.current !== 'running') {
        lastNotifiedStatus.current = 'running';
        sendLocalNotification({
          title: 'Koala sedang bekerja',
          body: 'Bot berjalan di latar belakang.',
        });
      }
      if (status === 'stopped' && lastNotifiedStatus.current !== 'stopped') {
        lastNotifiedStatus.current = 'stopped';
        sendLocalNotification({
          title: 'Koala sedang istirahat',
          body: 'Bot telah dihentikan.',
        });
      }
    });
    const offWs = botService.on('ws', ({ tradeConnected, streamConnected }) => {
      setWsStatus({ trade: tradeConnected, stream: streamConnected });
    });
    const offRefresh = botService.on('refresh', () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
      refreshTimer.current = setTimeout(() => {
        loadData();
      }, 1000);
    });
    const offLog = botService.on('log', ({ message }) => {
      setBotLogs((prev) => {
        const next = [
          { type: 'log', message, time: new Date().toLocaleTimeString() },
          ...prev,
        ];
        return next.slice(0, 50);
      });
    });
    const offError = botService.on('error', ({ message }) => {
      setBotLogs((prev) => {
        const next = [
          { type: 'error', message, time: new Date().toLocaleTimeString() },
          ...prev,
        ];
        return next.slice(0, 50);
      });
    });
    return () => {
      offStatus();
      offWs();
      offRefresh();
      offLog();
      offError();
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [loadData]);

  useEffect(() => {
    if (isBotRunning) {
      activateKeepAwakeAsync('koala-bot-running');
    } else {
      deactivateKeepAwake('koala-bot-running');
    }
  }, [isBotRunning]);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
        <View style={styles.header}>
          <Text style={styles.title}>Trading Control</Text>
          <Text style={styles.subtitle}>Pantau strategi dan eksekusi bot secara real-time.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status Bot</Text>
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, isBotRunning ? styles.dotOnline : styles.dotIdle]} />
              <Text style={styles.statusText}>
                {isBotRunning ? 'Sedang berjalan' : 'Berhenti'}
              </Text>
            </View>
            <View style={styles.profitRow}>
              <Text style={styles.profitLabel}>Keuntungan hari ini</Text>
              <Text style={styles.profitValue}>{formatMoney(profitToday, userCurrency)}</Text>
            </View>
          </View>

          <View style={styles.connectionCard}>
            <Text style={styles.connectionLabel}>Koneksi WS</Text>
            <View style={styles.connectionRowInline}>
              <View style={styles.connectionItemInline}>
                <View
                  style={[styles.statusDot, wsStatus.trade ? styles.dotOnline : styles.dotIdle]}
                />
                <Text style={styles.connectionValue}>
                  Server Assets {wsStatus.trade ? 'Online' : 'Offline'}
                </Text>
              </View>
              <View style={styles.connectionItemInline}>
                <View
                  style={[styles.statusDot, wsStatus.stream ? styles.dotOnline : styles.dotIdle]}
                />
                <Text style={styles.connectionValue}>
                  Server Stock {wsStatus.stream ? 'Online' : 'Offline'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.recentCard}>
            <View style={styles.recentHeaderRow}>
              <Text style={styles.connectionLabel}>Riwayat terbaru</Text>
              <Text style={styles.recentHint}>5 transaksi terakhir</Text>
            </View>
            {recentDeals.length === 0 ? (
              <Text style={styles.recentEmpty}>Belum ada riwayat.</Text>
            ) : (
              recentDeals.map((deal, idx) => {
                const time = deal.created_at
                  ? new Date(deal.created_at).toLocaleTimeString()
                  : '--:--';
                const status = deal.status ? deal.status.toUpperCase() : '-';
                const trendValue = deal.trend ? deal.trend.toLowerCase() : '';
                const trend =
                  trendValue === 'call'
                    ? 'BUY'
                    : trendValue === 'put'
                      ? 'SELL'
                      : '-';
                const wallet = deal.deal_type ? deal.deal_type.toUpperCase() : '-';
                const asset = deal.asset_ric ?? deal.ric ?? '-';
                const resultText = formatDealResult(deal);
                return (
                  <View key={`${deal.created_at ?? idx}`} style={styles.recentRow}>
                    <View style={styles.recentLeft}>
                      <View style={styles.recentTitleRow}>
                        <Text style={styles.recentText}>{asset}</Text>
                        <Text style={styles.recentDot}>•</Text>
                        <Text style={styles.recentMeta}>{wallet}</Text>
                      </View>
                      <View style={styles.recentMetaRow}>
                        <Text style={styles.recentMeta}>{time}</Text>
                        <Text style={styles.recentDot}>•</Text>
                        <Text style={styles.recentMeta}>{trend}</Text>
                      </View>
                    </View>
                    <View style={styles.recentRight}>
                      <Text style={styles.recentAmount}>{resultText}</Text>
                      <Text
                        style={[
                          styles.recentStatus,
                          status === 'WON'
                            ? styles.recentStatusWin
                            : status === 'LOST'
                              ? styles.recentStatusLoss
                              : styles.recentStatusNeutral,
                        ]}>
                        {status}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

      </ScrollView>

      <View style={styles.bottomBar}>
        <View style={styles.bottomRow}>
          <Pressable
            style={({ pressed }) => [styles.configButton, pressed && styles.buttonPressed]}
            onPress={openConfigModal}>
            <View style={styles.buttonRow}>
              <Ionicons name="settings-outline" size={18} color={colors.text} />
              <Text style={styles.configButtonText}>Konfigurasi Bot</Text>
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.startButton,
              pressed && styles.buttonPressed,
              isBotRunning ? styles.stopButton : null,
              isStarting ? styles.buttonDisabled : null,
            ]}
            onPress={handleToggleBot}
            disabled={isStarting}>
            <View style={styles.buttonRow}>
              <Ionicons
                name={isBotRunning ? 'pause' : 'play'}
                size={18}
                color={colors.content}
              />
              <Text style={styles.startButtonText}>{startButtonLabel}</Text>
            </View>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={isConfigOpen}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={closeConfigModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Konfigurasi Trading</Text>
            <Text style={styles.modalSubtitle}>
              Simpan pengaturan sebelum menjalankan bot agar perubahan diterapkan.
            </Text>

            <ScrollView
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled">
              <View style={styles.formSection}>
                <Text style={styles.sectionHeading}>Konfigurasi Trading</Text>

                <View style={styles.field}>
                  <Text style={styles.label}>Asset</Text>
                  {isFlash ? (
                    <View style={styles.selectBox}>
                      <Text style={styles.selectText}>Z-CRY/IDX (Flash 5st)</Text>
                    </View>
                  ) : (
                    <>
                      <Pressable
                        style={styles.selectBox}
                        onPress={() => setAssetSelectOpen((prev) => !prev)}>
                        <Text style={styles.selectText}>
                          {selectedAsset
                            ? `${selectedAsset.name} (${selectedAsset.ric})`
                            : 'Pilih asset'}
                        </Text>
                        <Text style={styles.selectIcon}>{assetSelectOpen ? '^' : 'v'}</Text>
                      </Pressable>
                      {assetSelectOpen ? (
                        <View style={styles.selectPanel}>
                          <TextInput
                            value={assetQuery}
                            onChangeText={setAssetQuery}
                            placeholder="Cari asset"
                            style={styles.input}
                            placeholderTextColor={colors.textMuted}
                          />
                          <ScrollView
                            style={styles.selectList}
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled">
                            {filteredAssets.map((item) => (
                              <Pressable
                                key={item.ric}
                                style={styles.selectItem}
                                onPress={() => {
                                  setConfig((prev) => ({ ...prev, asset: item.ric }));
                                  setAssetSelectOpen(false);
                                  setAssetQuery('');
                                }}>
                                <Text style={styles.selectItemTitle}>{item.name}</Text>
                                <Text style={styles.selectItemMeta}>{item.ric}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        </View>
                      ) : null}
                      <Text style={styles.hint}>
                        💡 Periksa aset di platform apakah tersedia sebelum memulai bot.
                      </Text>
                    </>
                  )}
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Strategi</Text>
                  <View style={styles.strategyGrid}>
                    {strategyOptions.map((item) => (
                      <Pressable
                        key={item}
                        style={[
                          styles.strategyChip,
                          config.strategy === item && styles.strategyChipActive,
                        ]}
                        onPress={() => {
                          setConfig((prev) => ({
                            ...prev,
                            strategy: item,
                            asset: item === 'Flash 5st' ? 'Z-CRY/IDX' : prev.asset,
                            interval: item === 'Flash 5st' ? '1' : prev.interval,
                          }));
                          if (item === 'Flash 5st') {
                            setAssetSelectOpen(false);
                            setAssetQuery('');
                          }
                        }}>
                        <Text
                          style={[
                            styles.strategyText,
                            config.strategy === item && styles.strategyTextActive,
                          ]}>
                          {item}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {isFlash ? (
                  <View style={styles.field}>
                    <Text style={styles.label}>{bidLabel}</Text>
                    <TextInput
                      value={bidAmountValue}
                      onChangeText={(value) =>
                        setConfig((prev) => {
                          const currency = userCurrency.toUpperCase();
                          if (currency === 'USD') return { ...prev, bidAmountUsd: value };
                          if (currency === 'EUR') return { ...prev, bidAmountEur: value };
                          return { ...prev, bidAmountIdr: value };
                        })
                      }
                      keyboardType="numeric"
                      style={styles.input}
                      placeholder="100000"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                ) : (
                  <View style={styles.inlineRow}>
                    <View style={styles.fieldInline}>
                      <Text style={styles.label}>Interval</Text>
                      <Pressable
                        style={styles.selectBox}
                        onPress={() =>
                          setOpenSelect((prev) => (prev === 'interval' ? null : 'interval'))
                        }>
                        <Text style={styles.selectText}>{config.interval}</Text>
                        <Text style={styles.selectIcon}>
                          {openSelect === 'interval' ? '^' : 'v'}
                        </Text>
                      </Pressable>
                      {openSelect === 'interval' ? (
                        <View style={styles.selectPanel}>
                          <ScrollView style={styles.selectList} nestedScrollEnabled>
                            {intervalOptions.map((item) => (
                              <Pressable
                                key={item}
                                style={styles.selectItem}
                                onPress={() => {
                                  setConfig((prev) => ({ ...prev, interval: item }));
                                  setOpenSelect(null);
                                }}>
                                <Text style={styles.selectItemTitle}>{item}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.fieldInline}>
                      <Text style={styles.label}>{bidLabel}</Text>
                      <TextInput
                        value={bidAmountValue}
                        onChangeText={(value) =>
                          setConfig((prev) => {
                            const currency = userCurrency.toUpperCase();
                            if (currency === 'USD') return { ...prev, bidAmountUsd: value };
                            if (currency === 'EUR') return { ...prev, bidAmountEur: value };
                            return { ...prev, bidAmountIdr: value };
                          })
                        }
                        keyboardType="numeric"
                        style={styles.input}
                        placeholder="100000"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  </View>
                )}

                <View style={styles.field}>
                  <Text style={styles.label}>Tipe Wallet</Text>
                  <View style={styles.segment}>
                    <Pressable
                      style={[
                        styles.segmentButton,
                        config.walletType === 'real' && styles.segmentActive,
                      ]}
                      onPress={() => setConfig((prev) => ({ ...prev, walletType: 'real' }))}>
                      <Text
                        style={[
                          styles.segmentText,
                          config.walletType === 'real' && styles.segmentTextActive,
                        ]}>
                        Real
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.segmentButton,
                        config.walletType === 'demo' && styles.segmentActive,
                      ]}
                      onPress={() => setConfig((prev) => ({ ...prev, walletType: 'demo' }))}>
                      <Text
                        style={[
                          styles.segmentText,
                          config.walletType === 'demo' && styles.segmentTextActive,
                        ]}>
                        Demo
                      </Text>
                    </Pressable>
                  </View>
                  <Pressable
                    style={styles.toggleRow}
                    onPress={() =>
                      setConfig((prev) => ({ ...prev, autoSwitchDemo: !prev.autoSwitchDemo }))
                    }>
                    <View style={[styles.toggleDot, config.autoSwitchDemo && styles.toggleOn]} />
                    <Text style={styles.toggleText}>Beralih otomatis ke demo</Text>
                  </Pressable>
                </View>

                {config.strategy === 'Signal' ? (
                  <View style={styles.field}>
                    <Text style={styles.label}>Input Sinyal</Text>
                    <TextInput
                      value={config.signalInput}
                      onChangeText={(value) =>
                        setConfig((prev) => ({ ...prev, signalInput: value }))
                      }
                      placeholder="Masukkan sinyal jika diperlukan"
                      style={[styles.input, styles.textArea]}
                      placeholderTextColor={colors.textMuted}
                      multiline
                    />
                  </View>
                ) : null}
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionHeading}>Manajemen Risiko</Text>
                  <Pressable
                    style={styles.linkButton}
                    onPress={() => setIsMartingaleOpen(true)}>
                      <Text style={styles.linkButtonText}>Kalkulator Martingale</Text>
                    </Pressable>
                </View>
                <View style={styles.inlineRow}>
                  <View style={styles.fieldInline}>
                    <Text style={styles.label}>Martingale</Text>
                    <Pressable
                      style={styles.selectBox}
                      onPress={() =>
                        setOpenSelect((prev) => (prev === 'martingale' ? null : 'martingale'))
                      }>
                      <Text style={styles.selectText}>{config.martingale}%</Text>
                      <Text style={styles.selectIcon}>
                        {openSelect === 'martingale' ? '^' : 'v'}
                      </Text>
                    </Pressable>
                    {openSelect === 'martingale' ? (
                      <View style={styles.selectPanel}>
                        <ScrollView style={styles.selectList} nestedScrollEnabled>
                          {martingaleOptions.map((item) => (
                            <Pressable
                              key={item}
                              style={styles.selectItem}
                              onPress={() => {
                                setConfig((prev) => ({ ...prev, martingale: item }));
                                setOpenSelect(null);
                              }}>
                              <Text style={styles.selectItemTitle}>{item}%</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.fieldInline}>
                    <Text style={styles.label}>Maks Martingale</Text>
                    <Pressable
                      style={styles.selectBox}
                      onPress={() =>
                        setOpenSelect((prev) =>
                          prev === 'maxMartingale' ? null : 'maxMartingale'
                        )
                      }>
                      <Text style={styles.selectText}>{config.maxMartingale}</Text>
                      <Text style={styles.selectIcon}>
                        {openSelect === 'maxMartingale' ? '^' : 'v'}
                      </Text>
                    </Pressable>
                    {openSelect === 'maxMartingale' ? (
                      <View style={styles.selectPanel}>
                        <ScrollView style={styles.selectList} nestedScrollEnabled>
                          {maxMartingaleOptions.map((item) => (
                            <Pressable
                              key={item}
                              style={styles.selectItem}
                              onPress={() => {
                                setConfig((prev) => ({ ...prev, maxMartingale: item }));
                                setOpenSelect(null);
                              }}>
                              <Text style={styles.selectItemTitle}>{item}</Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.inlineRow}>
                  <View style={styles.fieldInline}>
                    <Text style={styles.label}>Reset Martingale</Text>
                    <Pressable
                      style={styles.selectBox}
                      onPress={() =>
                        setOpenSelect((prev) =>
                          prev === 'resetMartingale' ? null : 'resetMartingale'
                        )
                      }>
                      <Text style={styles.selectText}>
                        {config.resetMartingale === '-1'
                          ? 'Off'
                          : config.resetMartingale === '0'
                            ? 'Flat'
                            : config.resetMartingale}
                      </Text>
                      <Text style={styles.selectIcon}>
                        {openSelect === 'resetMartingale' ? '^' : 'v'}
                      </Text>
                    </Pressable>
                    {openSelect === 'resetMartingale' ? (
                      <View style={styles.selectPanel}>
                        <ScrollView style={styles.selectList} nestedScrollEnabled>
                          {resetMartingaleOptions.map((item) => (
                            <Pressable
                              key={item}
                              style={styles.selectItem}
                              onPress={() => {
                                setConfig((prev) => ({ ...prev, resetMartingale: item }));
                                setOpenSelect(null);
                              }}>
                              <Text style={styles.selectItemTitle}>
                                {item === '-1' ? 'Off' : item === '0' ? 'Flat' : item}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.fieldInline}>
                    <Text style={styles.label}>Stop Loss</Text>
                    <Pressable
                      style={styles.selectBox}
                      onPress={() =>
                        setOpenSelect((prev) => (prev === 'stopLoss' ? null : 'stopLoss'))
                      }>
                      <Text style={styles.selectText}>
                        {config.stopLoss === '0' ? 'Off' : config.stopLoss}
                      </Text>
                      <Text style={styles.selectIcon}>
                        {openSelect === 'stopLoss' ? '^' : 'v'}
                      </Text>
                    </Pressable>
                    {openSelect === 'stopLoss' ? (
                      <View style={styles.selectPanel}>
                        <ScrollView style={styles.selectList} nestedScrollEnabled>
                          {stopLossOptions.map((item) => (
                            <Pressable
                              key={item}
                              style={styles.selectItem}
                              onPress={() => {
                                setConfig((prev) => ({ ...prev, stopLoss: item }));
                                setOpenSelect(null);
                              }}>
                              <Text style={styles.selectItemTitle}>
                                {item === '0' ? 'Off' : item}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Hentikan Profit Setelah</Text>
                  <TextInput
                    value={config.stopProfitAfter}
                    onChangeText={(value) =>
                      setConfig((prev) => ({ ...prev, stopProfitAfter: value }))
                    }
                    keyboardType="numeric"
                    style={styles.input}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalSecondary, pressed && styles.buttonPressed]}
                onPress={closeConfigModal}>
                <Text style={styles.modalSecondaryText}>Tutup</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalPrimary, pressed && styles.buttonPressed]}
                onPress={handleSaveConfig}>
                <View style={styles.buttonRow}>
                  <Ionicons name="save-outline" size={16} color="#fff" />
                  <Text style={styles.modalPrimaryText}>Simpan</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isMartingaleOpen}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setIsMartingaleOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.modalCardTall]}>
            <Text style={styles.modalTitle}>Kalkulator Martingale</Text>
            <Text style={styles.modalSubtitle}>
              Tabel ini menampilkan jumlah bid dan potensi keuntungan untuk setiap langkah
              martingale dengan peningkatan {config.martingale}%.
            </Text>

            <View style={styles.tableHeader}>
              <Text style={styles.tableCell}>Step</Text>
              <Text style={styles.tableCell}>Bid</Text>
              <Text style={styles.tableCell}>Jika Menang (85%)</Text>
            </View>
            <ScrollView
              style={styles.tableBody}
              contentContainerStyle={styles.tableBodyContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator>
              {martingaleSteps.map((row) => (
                <View key={row.step} style={styles.tableRow}>
                  <Text style={styles.tableValue}>{row.step}</Text>
                  <Text style={styles.tableValue}>
                    {formatMoney(row.amount, userCurrency)}
                  </Text>
                  <Text style={styles.tableValue}>
                    {formatMoney(row.profit, userCurrency)}
                  </Text>
                </View>
              ))}
              {martingaleSteps.length === 0 ? (
                <Text style={styles.tableEmpty}>Data kalkulator belum tersedia.</Text>
              ) : null}
            </ScrollView>

            <Pressable
              style={({ pressed }) => [
                styles.modalSecondaryCompact,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setIsMartingaleOpen(false)}>
              <Text style={styles.modalSecondaryText}>Tutup</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={alertState.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertState((prev) => ({ ...prev, visible: false }))}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.alertCard]}>
            <Text style={styles.modalTitle}>{alertState.title}</Text>
            {alertState.message ? (
              <Text style={styles.modalSubtitle}>{alertState.message}</Text>
            ) : null}
            <View style={styles.modalActions}>
              {alertState.actions.map((action, idx) => {
                const variant = action.variant ?? 'secondary';
                const buttonStyle =
                  variant === 'primary'
                    ? styles.alertPrimary
                    : variant === 'danger'
                      ? styles.alertDanger
                      : styles.alertSecondary;
                const textStyle =
                  variant === 'primary'
                    ? styles.alertPrimaryText
                    : variant === 'danger'
                      ? styles.alertDangerText
                      : styles.alertSecondaryText;
                return (
                  <Pressable
                    key={`${action.label}-${idx}`}
                    style={({ pressed }) => [buttonStyle, pressed && styles.buttonPressed]}
                    onPress={() => {
                      setAlertState((prev) => ({ ...prev, visible: false }));
                      action.onPress?.();
                    }}>
                    <Text style={textStyle}>{action.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ReturnType<typeof getThemeColors>) =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.layout,
  },
  container: {
    flex: 1,
    backgroundColor: colors.layout,
  },
  content: {
    padding: 24,
    gap: 18,
    paddingBottom: 140,
  },
  header: {
    gap: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    backgroundColor: colors.content,
    shadowColor: colors.base,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  cardPrimary: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  cardSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 6,
  },
  cardMeta: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
  },
  section: {
    gap: 12,
  },
  logCard: {
    backgroundColor: colors.content,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  logRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  logTime: {
    fontSize: 10,
    color: colors.textMuted,
    width: 70,
  },
  logText: {
    flex: 1,
    fontSize: 11,
    color: colors.text,
  },
  logError: {
    color: '#B42318',
  },
  logEmpty: {
    fontSize: 11,
    color: colors.textMuted,
  },
  statusCard: {
    backgroundColor: colors.content,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  connectionCard: {
    marginTop: 12,
    backgroundColor: colors.content,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentCard: {
    marginTop: 12,
    backgroundColor: colors.content,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentHint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  walletGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  walletTile: {
    backgroundColor: colors.content,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 110,
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  walletValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: 4,
  },
  feedCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 16,
  },
  feedLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  feedValue: {
    color: colors.content,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 6,
  },
  feedMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dotOnline: {
    backgroundColor: colors.secondary,
  },
  dotIdle: {
    backgroundColor: colors.textMuted,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  statusText: {
    fontSize: 13,
    color: colors.text,
  },
  connectionRow: {
    marginTop: 12,
  },
  connectionRowInline: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  connectionList: {
    marginTop: 8,
    gap: 8,
  },
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectionItemInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectionLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  connectionValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  recentRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recentLeft: {
    flex: 1,
    gap: 4,
  },
  recentRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  recentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recentMeta: {
    fontSize: 11,
    color: colors.textMuted,
  },
  recentDot: {
    fontSize: 10,
    color: colors.textMuted,
  },
  recentText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  recentAmount: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  recentStatus: {
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  recentStatusWin: {
    backgroundColor: 'rgba(22, 163, 74, 0.12)',
    color: '#16A34A',
  },
  recentStatusLoss: {
    backgroundColor: 'rgba(185, 28, 28, 0.12)',
    color: '#B91C1C',
  },
  recentStatusNeutral: {
    backgroundColor: 'rgba(100, 116, 139, 0.12)',
    color: '#64748B',
  },
  recentEmpty: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 8,
  },
  statusHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  profitRow: {
    marginTop: 12,
  },
  profitLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  profitValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  configButton: {
    flex: 1,
    backgroundColor: colors.content,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  configButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  startButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: colors.layout,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomRow: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stopButton: {
    backgroundColor: '#B42318',
  },
  startButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.content,
  },
  copyButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: colors.content,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.content,
    borderRadius: 18,
    padding: 20,
    maxHeight: '85%',
  },
  modalCardTall: {
    maxHeight: '92%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textMuted,
  },
  modalContent: {
    paddingVertical: 16,
    gap: 18,
  },
  formSection: {
    gap: 12,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: `${colors.primary}22`,
  },
  linkButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  field: {
    gap: 6,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  fieldInline: {
    flex: 1,
    minWidth: 120,
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.content,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 11,
    color: colors.textMuted,
  },
  selectBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.content,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  selectIcon: {
    color: colors.textMuted,
    fontSize: 12,
  },
  selectPanel: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    backgroundColor: colors.content,
  },
  selectList: {
    maxHeight: 320,
    marginTop: 8,
  },
  selectItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectItemTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  selectItemMeta: {
    fontSize: 11,
    color: colors.textMuted,
  },
  strategyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  strategyChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.content,
  },
  strategyChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  strategyText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  strategyTextActive: {
    color: colors.content,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.content,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: colors.content,
  },
  toggleRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  toggleOn: {
    backgroundColor: colors.primary,
  },
  toggleText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  modalActions: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 10,
  },
  modalSecondary: {
    flex: 1,
    backgroundColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalSecondaryCompact: {
    backgroundColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  modalSecondaryText: {
    color: colors.text,
    fontWeight: '600',
  },
  modalPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalPrimaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  alertCard: {
    maxHeight: '70%',
  },
  alertSecondary: {
    flex: 1,
    backgroundColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  alertSecondaryText: {
    color: colors.text,
    fontWeight: '600',
  },
  alertPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  alertPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  alertDanger: {
    flex: 1,
    backgroundColor: '#B42318',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  alertDangerText: {
    color: '#fff',
    fontWeight: '600',
  },
  tableHeader: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableBody: {
    maxHeight: 360,
    marginTop: 8,
    flexGrow: 0,
  },
  tableBodyContent: {
    paddingBottom: 12,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableCell: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    flex: 1,
  },
  tableValue: {
    fontSize: 12,
    color: colors.text,
    flex: 1,
  },
  tableEmpty: {
    marginTop: 12,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  profileCard: {
    backgroundColor: colors.content,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  profileMeta: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
  },
  error: {
    color: '#B42318',
    fontSize: 12,
  },
  });
