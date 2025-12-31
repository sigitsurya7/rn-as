import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { apiV2 } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getThemeColors } from '@/constants/theme';
import { useThemeSettings } from '@/lib/theme-context';

type DealItem = {
  id?: number;
  status?: string;
  amount?: number | null;
  win?: number | null;
  won?: number | null;
  created_at?: string;
  close_quote_created_at?: string;
  finished_at?: string;
  ric?: string;
  asset_ric?: string;
  asset_name?: string;
  trend?: string;
  deal_type?: string;
  payment?: number | null;
};

type DealsResponse = {
  data?: {
    deals?: DealItem[];
    standard_trade_deals?: DealItem[];
  };
  deals?: DealItem[];
  standard_trade_deals?: DealItem[];
};

export default function HistoryScreen() {
  const { colors, resolvedScheme } = useThemeSettings();
  const { userProfile } = useAuth();
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [profitToday, setProfitToday] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motivation, setMotivation] = useState('');
  const realtimeTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const apiReady = Boolean(apiV2.defaults.baseURL);
  const title = 'Riwayat';
  const userCurrency = userProfile?.currency ?? 'IDR';

  const normalizeAmount = (value: number | string | null | undefined) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric / 100;
  };

  const formatMoney = (value: number) => {
    try {
      return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: userCurrency.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      const symbol = userCurrency.toUpperCase() === 'IDR' ? 'Rp' : userCurrency.toUpperCase();
      return `${symbol} ${value.toLocaleString('id-ID')}`;
    }
  };

  const formatMoneyValue = (value: number | string | null | undefined) => {
    const normalized = normalizeAmount(value);
    if (normalized === null) return '-';
    return formatMoney(normalized);
  };

  const pickMotivation = (profit: number) => {
    const positive = [
      'Mantap! Jaga konsistensi dan tetap disiplin.',
      'Profit hari ini keren. Tetap kontrol risiko.',
      'Hasil bagus! Jangan lupa evaluasi strategi.',
      'Kerja cerdas. Fokus, lalu scale perlahan.',
      'Keep it up! Ambil jeda sebelum entry lagi.',
    ];
    const negative = [
      'Tarik napas dulu. Evaluasi dan bangkit lagi.',
      'Hari berat itu wajar. Jaga mindset dan plan.',
      'Fokus pada proses, hasil akan mengikuti.',
      'Loss bukan akhir, tapi data untuk perbaikan.',
      'Pelan-pelan, disiplin tetap nomor satu.',
    ];
    const neutral = [
      'Tetap tenang, peluang terbaik ada di depan.',
      'Hari flat. Fokus pada kualitas setup.',
      'Jaga ritme. Kesabaran memberi peluang.',
    ];

    const source = profit > 0 ? positive : profit < 0 ? negative : neutral;
    const index = Math.floor(Math.random() * source.length);
    return source[index] ?? '';
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
      typeof deal.won === 'number'
        ? deal.won
        : typeof deal.win === 'number'
          ? deal.win
          : typeof deal.payment === 'number'
            ? deal.payment
            : null;
    if (winValue === null) return 0;
    return winValue - amount;
  };

  const fetchDeals = async () => {
    const requests = await Promise.allSettled([
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=demo'),
      apiV2.get<DealsResponse>('/bo-deals-history/v3/deals/trade?type=real'),
    ]);
    const list: DealItem[] = [];
    requests.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const payload = result.value.data ?? {};
      const deals = extractDeals(payload);
      if (Array.isArray(deals)) list.push(...deals);
    });
    const today = new Date().toISOString().slice(0, 10);
    const todayDeals = list
      .filter((item) => getDealDateKey(item) === today)
      .sort(
        (a, b) =>
          Number(new Date(b.close_quote_created_at ?? b.created_at ?? 0)) -
          Number(new Date(a.close_quote_created_at ?? a.created_at ?? 0))
      );
    setDeals(todayDeals);
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
      const list = extractDeals(result.value.data ?? {});
      list.forEach((deal) => {
        if (deal.status && String(deal.status).toLowerCase() === 'opened') return;
        if (getDealDateKey(deal) !== today) return;
        total += getDealProfitDelta(deal);
      });
    });

    const normalized = total / 100;
    const value = Number.isFinite(normalized) ? normalized : 0;
    setProfitToday(value);
    setMotivation(pickMotivation(value));
  };

  const loadData = useCallback(async () => {
    setError(null);
    try {
      if (!apiReady) {
        throw new Error('API v2 belum terisi. Login terlebih dahulu.');
      }
      await Promise.all([fetchDeals(), fetchProfitToday()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat.');
    }
  }, [apiReady]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      if (!apiReady) return;
      setIsLoading(true);
      loadData().finally(() => setIsLoading(false));
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

  const styles = useMemo(() => makeStyles(colors, resolvedScheme), [colors, resolvedScheme]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>Lacak hasil trade berdasarkan mode akun.</Text>
        </View>

        <View style={styles.switchRow}>
          <View
            style={[
              styles.profitCard,
              profitToday >= 0 ? styles.profitPositive : styles.profitNegative,
            ]}>
            <Text style={styles.profitLabel}>Keuntungan hari ini</Text>
            <Text style={styles.profitValue}>{formatMoney(profitToday)}</Text>
            {motivation ? <Text style={styles.profitMotivation}>{motivation}</Text> : null}
          </View>
        </View>

        {!apiReady ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateText}>API v2 belum terisi. Login dahulu.</Text>
          </View>
        ) : isLoading ? (
          <ActivityIndicator color={colors.text} style={styles.loader} />
        ) : (
          <FlatList
            data={deals}
            keyExtractor={(item, index) => String(item.id ?? index)}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>Belum ada riwayat transaksi hari ini.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const statusValue = String(item.status ?? 'open').toLowerCase();
              const status = statusValue.toUpperCase();
              const timeSource = item.close_quote_created_at ?? item.created_at;
              const time = timeSource
                ? new Date(timeSource).toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })
                : '--:--';
              const asset = item.asset_ric ?? item.ric ?? item.asset_name ?? 'Asset';
              const walletLabel = item.deal_type ? item.deal_type.toUpperCase() : '-';
              const trendValue = (item.trend ?? '-').toLowerCase();
              const profitDelta =
                statusValue === 'opened' ? null : getDealProfitDelta(item);
              const badgeStyle =
                item.status === 'won'
                  ? styles.badgeWon
                  : item.status === 'lost'
                    ? styles.badgeLost
                    : styles.badgeOpen;
              return (
                <View style={styles.dealCard}>
                  <View style={styles.dealRowTop}>
                    <View style={[styles.dealBadge, badgeStyle]}>
                      <Ionicons
                        name={
                          item.status === 'won'
                            ? 'checkmark-circle'
                            : item.status === 'lost'
                              ? 'close-circle'
                              : 'radio-button-on'
                        }
                        size={14}
                        color="#fff"
                      />
                      <Text style={styles.dealBadgeText}>{status}</Text>
                    </View>
                    <View style={styles.dealBody}>
                      <View style={styles.dealHeaderRow}>
                        <View style={styles.assetRow}>
                          <Text style={styles.dealTitle}>{asset}</Text>
                          <View style={styles.walletBadgeRow}>
                            <Ionicons name="wallet-outline" size={12} color={colors.textMuted} />
                            <Text style={styles.walletBadge}>{walletLabel}</Text>
                          </View>
                        </View>
                        <Text style={styles.dealTime}>{time.replace(/\./g, ':')}</Text>
                      </View>
                      <View style={styles.dealStatsRow}>
                        <View style={styles.dealStat}>
                          <Text style={styles.dealStatLabel}>Amount</Text>
                          <Text style={styles.dealStatValue}>
                            {formatMoneyValue(item.amount)}
                          </Text>
                        </View>
                        <View style={styles.dealStat}>
                          <Text style={styles.dealStatLabel}>Win</Text>
                          <Text style={styles.dealStatValue}>
                            {profitDelta === null ? '-' : formatMoneyValue(profitDelta)}
                          </Text>
                        </View>
                        <View style={styles.dealStat}>
                          <Text style={styles.dealStatLabel}>Trend</Text>
                          <View style={styles.trendRow}>
                            {trendValue === 'call' ? (
                              <Ionicons name="arrow-up" size={14} color="#16A34A" />
                            ) : trendValue === 'put' ? (
                              <Ionicons name="arrow-down" size={14} color="#B91C1C" />
                            ) : null}
                            <Text
                              style={[
                                styles.dealStatValue,
                                trendValue === 'call'
                                  ? styles.trendUp
                                  : trendValue === 'put'
                                    ? styles.trendDown
                                    : null,
                              ]}>
                              {trendValue === 'call' ? 'BUY' : trendValue === 'put' ? 'SELL' : '-'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              );
            }}
          />
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ReturnType<typeof getThemeColors>, scheme: 'light' | 'dark') =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.layout,
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  header: {
    gap: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  switchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  profitCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.content,
  },
  profitPositive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}1A`,
  },
  profitNegative: {
    borderColor: scheme === 'dark' ? '#7A1E1E' : '#B42318',
    backgroundColor: scheme === 'dark' ? '#3B0D0D' : '#FEF2F2',
  },
  profitLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  profitValue: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  profitMotivation: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textMuted,
  },
  listContent: {
    paddingBottom: 24,
    gap: 10,
  },
  dealCard: {
    backgroundColor: colors.content,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  dealRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  dealBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    minWidth: 58,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dealBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#fff',
  },
  badgeOpen: {
    backgroundColor: '#475569',
  },
  badgeWon: {
    backgroundColor: '#16A34A',
  },
  badgeLost: {
    backgroundColor: '#B91C1C',
  },
  dealBody: {
    flex: 1,
    gap: 6,
  },
  dealHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  walletBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dealTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  walletBadge: {
    fontSize: 11,
    color: colors.textMuted,
  },
  dealTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  dealStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  dealStat: {
    flex: 1,
    minWidth: 80,
    gap: 2,
  },
  dealStatLabel: {
    fontSize: 10,
    color: colors.textMuted,
  },
  dealStatValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trendUp: {
    color: '#16A34A',
  },
  trendDown: {
    color: '#B91C1C',
  },
  dealMetaRow: {
    marginTop: 6,
    gap: 2,
  },
  dealMeta: {
    fontSize: 11,
    color: colors.textMuted,
  },
  stateCard: {
    backgroundColor: colors.content,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  stateText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  loader: {
    marginTop: 24,
  },
  error: {
    color: '#B42318',
    fontSize: 12,
  },
  });
