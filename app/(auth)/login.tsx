import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { getThemeColors } from '@/constants/theme';
import { useThemeSettings } from '@/lib/theme-context';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const { signIn, errorMessage } = useAuth();
  const { colors } = useThemeSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayError = error ?? errorMessage;

  const canSubmit = email.trim().length > 0 && password.trim().length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.select({ ios: 'padding', android: undefined })}>
        <View style={styles.hero}>
          <Text style={styles.brand}>Koala Bot</Text>
          <Text style={styles.tagline}>Masuk untuk mulai mengelola trading otomatis.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Login</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={styles.input}
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>

            <View style={styles.passwordWrapper}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Masukkan password"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                style={styles.passwordInput}
                placeholderTextColor={colors.textMuted}
              />

              <Pressable
                onPress={() => setShowPassword(prev => !prev)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>
                <Ionicons
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color={colors.textMuted}
                />

              </Pressable>
            </View>
          </View>

          {displayError ? <Text style={styles.error}>{displayError}</Text> : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            android_ripple={{ color: colors.base }}>
            {isSubmitting ? (
              <ActivityIndicator color={colors.content} />
            ) : (
              <Text style={styles.buttonText}>Masuk</Text>
            )}
          </Pressable>

          <Text style={styles.helper}>Jika akun belum aktif harap hubungi ADMIN!</Text>
        </View>
      </KeyboardAvoidingView>
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
    padding: 24,
    justifyContent: 'center',
  },
  hero: {
    marginBottom: 24,
  },
  brand: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.2,
  },
  tagline: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.content,
    borderRadius: 16,
    padding: 20,
    shadowColor: colors.base,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: colors.text,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 12, android: 10 }),
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.layout,
  },

  // ✅ password input + eye
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.layout,
    paddingRight: 12,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 12, android: 10 }),
    fontSize: 14,
    color: colors.text,
  },
  eye: {
    fontSize: 18,
  },

  error: {
    color: '#B42318',
    fontSize: 12,
    marginBottom: 12,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  buttonText: {
    color: colors.content,
    fontWeight: '600',
    fontSize: 14,
  },
  helper: {
    marginTop: 14,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  });
