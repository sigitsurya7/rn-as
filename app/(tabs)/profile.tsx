import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
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

type WalletSnapshot = {
  real: number | null;
  demo: number | null;
  currency: string | null;
};

type ProfileData = {
  id?: number | null;
  avatar?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  phone?: string | null;
  phone_verified?: boolean | null;
  docs_verified?: boolean | null;
  country_name?: string | null;
  currency?: string | null;
  status_group?: string | null;
  registered_at?: string | null;
};

export default function ProfileScreen() {
  const { colors } = useThemeSettings();
  const { userProfile, signOut } = useAuth();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [wallet, setWallet] = useState<WalletSnapshot>({
    real: null,
    demo: null,
    currency: userProfile?.currency ?? null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLogoutOpen, setIsLogoutOpen] = useState(false);

  const fullName = useMemo(() => {
    const source = profileData ?? userProfile;
    if (!source) return 'Pengguna';
    const names = [source.first_name, source.last_name].filter(Boolean);
    return names.length ? names.join(' ') : source.nickname || 'Pengguna';
  }, [profileData, userProfile]);

  const email = profileData?.email ?? userProfile?.email ?? '-';
  const avatar = profileData?.avatar || userProfile?.avatar || null;
  const userCurrency = profileData?.currency ?? userProfile?.currency ?? wallet.currency ?? 'IDR';
  const maskSuffix = String(profileData?.id ?? userProfile?.id ?? '').slice(-4);
  const phone = profileData?.phone ?? '-';
  const country = profileData?.country_name ?? '-';
  const statusGroup = profileData?.status_group ?? '-';
  const registeredAt = profileData?.registered_at
    ? new Date(profileData.registered_at).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '-';

  const currencySymbol = (code: string) => {
    const normalized = code.toUpperCase();
    if (normalized === 'IDR') return 'Rp';
    if (normalized === 'USD') return '$';
    if (normalized === 'EUR') return '€';
    if (normalized === 'GBP') return '£';
    if (normalized === 'JPY') return '¥';
    return normalized;
  };

  const normalizeMoney = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return null;
    return value / 100;
  };

  const formatMoney = (value: number | null, code: string) => {
    const normalized = normalizeMoney(value);
    if (normalized === null) return '-';
    try {
      return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: code.toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(normalized);
    } catch {
      const symbol = currencySymbol(code);
      return `${symbol} ${Number(normalized).toLocaleString('id-ID', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  };

  const fetchWallet = async () => {
    const response = await apiV2.get('/bank/v1/read');
    const payload = response.data ?? {};
    let real: number | null = null;
    let demo: number | null = null;
    let currency: string | null = null;

    const wallets = Array.isArray(payload?.data)
      ? payload.data
      : payload?.data?.wallets ?? payload?.wallets ?? [];
    if (Array.isArray(wallets)) {
      wallets.forEach((item: any) => {
        const type = String(item.account_type ?? item.type ?? '').toLowerCase();
        const balance = item.balance ?? item.amount ?? item.value;
        const balanceNumber = typeof balance === 'number' ? balance : Number(balance);
        const itemCurrency = item.currency ?? item.cur ?? item.ccy ?? null;
        if (!currency && itemCurrency) currency = String(itemCurrency);
        if (type === 'real') real = Number.isFinite(balanceNumber) ? balanceNumber : null;
        if (type === 'demo') demo = Number.isFinite(balanceNumber) ? balanceNumber : null;
      });
    }

    setWallet({ real, demo, currency });
  };

  const fetchProfile = async () => {
    const response = await apiV2.get('/platform/private/v2/profile');
    const payload = response.data ?? {};
    const data = payload.data ?? payload;
    setProfileData({
      id: data.id ?? null,
      avatar: data.avatar ?? null,
      first_name: data.first_name ?? null,
      last_name: data.last_name ?? null,
      nickname: data.nickname ?? null,
      email: data.email ?? null,
      email_verified: data.email_verified ?? null,
      phone: data.phone ?? null,
      phone_verified: data.phone_verified ?? null,
      docs_verified: data.docs_verified ?? null,
      country_name: data.country_name ?? null,
      currency: data.currency ?? null,
      status_group: data.status_group ?? null,
      registered_at: data.registered_at ?? null,
    });
  };

  useEffect(() => {
    if (!apiV2.defaults.baseURL) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    Promise.allSettled([fetchWallet(), fetchProfile()])
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (!apiV2.defaults.baseURL) return;
      setIsLoading(true);
      Promise.allSettled([fetchWallet(), fetchProfile()])
        .catch(() => undefined)
        .finally(() => setIsLoading(false));
    }, [])
  );

  const handleLogout = async () => {
    setIsLogoutOpen(false);
    await signOut();
  };

  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <View style={styles.avatarWrap}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarLetter}>{fullName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{fullName}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
            <View style={styles.profileMetaRow}>
              <View style={styles.profileBadge}>
                <Text style={styles.profileBadgeText}>{statusGroup}</Text>
              </View>
              <Text style={styles.profileMetaText}>ID •••{maskSuffix || '-'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet</Text>
          {isLoading ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <View style={styles.walletRow}>
              <View style={[styles.walletTile, styles.walletTileReal]}>
                <View style={styles.walletHeader}>
                  <View style={styles.walletDotGroup}>
                    <View style={styles.walletDotOuter}>
                      <View style={styles.walletDotInner} />
                    </View>
                    <Text style={styles.walletHeaderText}>Real</Text>
                  </View>
                  <Text style={styles.walletMenu}>•••</Text>
                </View>
                <Text style={styles.walletValue}>{formatMoney(wallet.real, userCurrency)}</Text>
              </View>
              <View style={[styles.walletTile, styles.walletTileDemo]}>
                <View style={styles.walletHeader}>
                  <View style={styles.walletDotGroup}>
                    <View style={[styles.walletDotOuter, styles.walletDotOuterAlt]}>
                      <View style={[styles.walletDotInner, styles.walletDotInnerAlt]} />
                    </View>
                    <Text style={styles.walletHeaderText}>Demo</Text>
                  </View>
                  <Text style={styles.walletMenu}>•••</Text>
                </View>
                <Text style={styles.walletValue}>{formatMoney(wallet.demo, userCurrency)}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Akun</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>ID</Text>
              <Text style={styles.infoValue}>•••{maskSuffix || '-'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={styles.infoValue}>{statusGroup}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Terdaftar</Text>
              <Text style={styles.infoValue}>{registeredAt}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kontak</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <View style={styles.infoValueRow}>
                <Text style={styles.infoValue}>{email}</Text>
                <Ionicons
                  name={profileData?.email_verified ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={profileData?.email_verified ? colors.success : colors.textMuted}
                />
              </View>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Telepon</Text>
              <View style={styles.infoValueRow}>
                <Text style={styles.infoValue}>{phone}</Text>
                <Ionicons
                  name={profileData?.phone_verified ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={profileData?.phone_verified ? colors.success : colors.textMuted}
                />
              </View>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Negara</Text>
              <Text style={styles.infoValue}>{country}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Mata uang</Text>
              <Text style={styles.infoValue}>{userCurrency}</Text>
            </View>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.logoutButton, pressed && styles.buttonPressed]}
          onPress={() => setIsLogoutOpen(true)}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={isLogoutOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsLogoutOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Keluar dari akun?</Text>
            <Text style={styles.modalSubtitle}>
              Kamu yakin ingin keluar dari akun ini sekarang?
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalButton, pressed && styles.buttonPressed]}
                onPress={() => setIsLogoutOpen(false)}>
                <View style={styles.buttonRow}>
                  <Ionicons name="close" size={16} color={colors.text} />
                  <Text style={styles.modalButtonText}>Batal</Text>
                </View>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalDanger, pressed && styles.buttonPressed]}
                onPress={handleLogout}>
                <Text style={styles.modalDangerText}>Keluar</Text>
              </Pressable>
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
    flexGrow: 1,
    padding: 24,
    gap: 20,
  },
  scroll: {
    flex: 1,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.content,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 64,
    height: 64,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: colors.content,
    fontSize: 26,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  profileEmail: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  profileMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  profileBadgeText: {
    fontSize: 11,
    color: colors.content,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  profileMetaText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  infoCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.content,
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  infoValue: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walletRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  walletTile: {
    flex: 1,
    minWidth: 160,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.content,
    shadowColor: colors.base,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    // elevation: 2,
  },
  walletTileReal: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}14`,
  },
  walletTileDemo: {
    borderColor: colors.secondary,
    backgroundColor: `${colors.secondary}14`,
  },
  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  walletDotGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walletDotOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletDotOuterAlt: {
    backgroundColor: colors.secondary,
  },
  walletDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.content,
  },
  walletDotInnerAlt: {
    backgroundColor: colors.content,
  },
  walletHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  walletMenu: {
    fontSize: 18,
    color: colors.text,
    letterSpacing: 1.5,
  },
  walletLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  walletValue: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  walletMasked: {
    marginTop: 12,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.text,
  },
  logoutButton: {
    marginTop: 'auto',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutText: {
    color: colors.content,
    fontWeight: '600',
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
  modalActions: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    backgroundColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    color: colors.text,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalDanger: {
    flex: 1,
    backgroundColor: '#B42318',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalDangerText: {
    color: colors.content,
    fontWeight: '600',
  },
  });
