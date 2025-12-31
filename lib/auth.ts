import { apiV1, API_V1_STATUS } from './api';
import { DEVICE_TYPE, getOrCreateDeviceId } from './device';
import { saveStoredAuth } from './storage';

export type UserProfile = {
  id: number;
  avatar: string | null;
  first_name: string;
  last_name: string;
  nickname: string;
  balance: number;
  balance_version: number;
  bonus: number;
  gender: string;
  email: string;
  email_verified: boolean;
  phone: string;
  phone_verified: boolean;
  phone_prefix: string;
  receive_news: boolean;
  receive_sms: boolean;
  receive_notification: boolean;
  country: string;
  country_name: string;
  currency: string;
  birthday: string;
  activate: boolean;
  password_is_set: boolean;
  tutorial: boolean;
  coupons: unknown[];
  free_deals: unknown;
  blocked: boolean;
  agree_risk: boolean;
  agreed: boolean;
  status_group: string;
  docs_verified: boolean;
  registered_at: string;
  status_by_deposit: string;
  status_id: number;
  deposits_sum: number;
  push_notification_categories: unknown[];
  preserve_name: boolean;
  registration_country_iso: string;
};

export type LoginResponse = {
  token: string;
  token_api: string;
  user_profile: UserProfile;
  api_url: string;
};

export async function loginWithApiV1(params: {
  email: string;
  password: string;
}): Promise<{ response: LoginResponse; deviceId: string }> {
  const deviceId = await getOrCreateDeviceId();

  const response = await apiV1.post<LoginResponse>(
    '/v1/login',
    {
      email: params.email,
      password: params.password,
    },
    {
      headers: {
        'Device-Id': deviceId,
        'Device-Type': DEVICE_TYPE,
      },
      validateStatus: (status) =>
        status === API_V1_STATUS.OK ||
        status === API_V1_STATUS.BAD_REQUEST ||
        status === API_V1_STATUS.FORBIDDEN ||
        status === API_V1_STATUS.BAD_GATEWAY ||
        status === API_V1_STATUS.INTERNAL_SERVER_ERROR,
    }
  );

  if (response.status !== API_V1_STATUS.OK || !response.data) {
    const statusMessage: Record<number, string> = {
      [API_V1_STATUS.BAD_REQUEST]: 'Data login belum lengkap. Cek email dan password.',
      [API_V1_STATUS.FORBIDDEN]: 'Akses ditolak. Akun belum diizinkan atau sedang diblokir.',
      [API_V1_STATUS.BAD_GATEWAY]: 'Server sedang bermasalah. Coba lagi sebentar.',
      [API_V1_STATUS.INTERNAL_SERVER_ERROR]: 'Terjadi gangguan di server. Coba lagi nanti.',
    };
    const fallback = 'Login gagal. Periksa kembali akun kamu.';
    const message = statusMessage[response.status] ?? fallback;
    throw new Error(message);
  }

  return { response: response.data, deviceId };
}

export async function persistLogin(payload: {
  token: string;
  tokenApi: string;
  apiUrl: string;
  userProfile: UserProfile;
  deviceId: string;
}) {
  await saveStoredAuth({
    tokenV1: payload.token,
    tokenApi: payload.tokenApi,
    apiUrl: payload.apiUrl,
    userProfile: JSON.stringify(payload.userProfile),
    deviceId: payload.deviceId,
  });
}
