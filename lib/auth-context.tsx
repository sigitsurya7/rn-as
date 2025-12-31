import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loginWithApiV1, persistLogin, UserProfile } from './auth';
import { clearStoredAuth, loadStoredAuth } from './storage';
import { setApiV1Token, setApiV2BaseUrl, setApiV2Token } from './api';
import { generateDeviceId, saveDeviceId } from './device';

const API_V2_REQUIRED = 'https://api.stockity.id';

export type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  userProfile: UserProfile | null;
  errorMessage: string | null;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    userProfile: null,
    errorMessage: null,
  });

  const bootstrap = useCallback(async () => {
    const stored = await loadStoredAuth();
    if (!stored.tokenV1 || !stored.tokenApi || !stored.apiUrl) {
      if (stored.tokenV1 || stored.tokenApi || stored.apiUrl) {
        await clearStoredAuth();
        setApiV1Token(null);
        setApiV2Token(null);
        setApiV2BaseUrl(null);
        setState({
          isLoading: false,
          isAuthenticated: false,
          userProfile: null,
          errorMessage: 'API v2 tidak ditemukan. Silakan login ulang.',
        });
        return;
      }
      setState({ isLoading: false, isAuthenticated: false, userProfile: null, errorMessage: null });
      return;
    }

    if (stored.apiUrl !== API_V2_REQUIRED) {
      await clearStoredAuth();
      setApiV1Token(null);
      setApiV2Token(null);
      setApiV2BaseUrl(null);
      setState({
        isLoading: false,
        isAuthenticated: false,
        userProfile: null,
        errorMessage: 'API v2 tidak valid. Silakan login ulang.',
      });
      return;
    }

    setApiV1Token(stored.tokenV1);
    setApiV2Token(stored.tokenApi);
    setApiV2BaseUrl(stored.apiUrl);
    const userProfile = stored.userProfile ? (JSON.parse(stored.userProfile) as UserProfile) : null;
    setState({ isLoading: false, isAuthenticated: true, userProfile, errorMessage: null });
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { response, deviceId } = await loginWithApiV1({ email, password });
    if (!response.api_url || response.api_url !== API_V2_REQUIRED) {
      await clearStoredAuth();
      throw new Error('API v2 tidak valid. Silakan login ulang.');
    }

    setApiV1Token(response.token);
    setApiV2Token(response.token_api);
    setApiV2BaseUrl(API_V2_REQUIRED);

    await persistLogin({
      token: response.token,
      tokenApi: response.token_api,
      apiUrl: API_V2_REQUIRED,
      userProfile: response.user_profile,
      deviceId,
    });

    setState({
      isLoading: false,
      isAuthenticated: true,
      userProfile: response.user_profile,
      errorMessage: null,
    });
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredAuth();
    const newDeviceId = generateDeviceId();
    await saveDeviceId(newDeviceId);
    setApiV1Token(null);
    setApiV2Token(null);
    setApiV2BaseUrl(null);
    setState({ isLoading: false, isAuthenticated: false, userProfile: null, errorMessage: null });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      signIn,
      signOut,
    }),
    [signIn, signOut, state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
