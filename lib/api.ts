import axios from 'axios';
import { DEVICE_TYPE, getOrCreateDeviceId } from './device';

export const API_V1_BASE_URL = 'https://koalapro.id:8080/';

export const API_V1_STATUS = {
  BAD_REQUEST: 400,
  BAD_GATEWAY: 502,
  INTERNAL_SERVER_ERROR: 500,
  FORBIDDEN: 403,
  OK: 200,
} as const;

export const apiV1 = axios.create({
  baseURL: API_V1_BASE_URL,
  timeout: 15000,
});

export const apiV2 = axios.create({
  timeout: 15000,
});

apiV1.interceptors.request.use(async (config) => {
  const deviceId = await getOrCreateDeviceId();
  config.headers = config.headers ?? {};
  config.headers['Device-Id'] = deviceId;
  config.headers['Device-Type'] = DEVICE_TYPE;
  return config;
});

apiV2.interceptors.request.use(async (config) => {
  const deviceId = await getOrCreateDeviceId();
  config.headers = config.headers ?? {};
  config.headers['Device-Id'] = deviceId;
  config.headers['Device-Type'] = DEVICE_TYPE;
  return config;
});

export function setApiV1Token(token?: string | null) {
  if (token) {
    apiV1.defaults.headers.common.Authorization = `Bearer ${token}`;
    return;
  }
  delete apiV1.defaults.headers.common.Authorization;
}

export function setApiV2Token(tokenApi?: string | null) {
  if (tokenApi) {
    apiV2.defaults.headers.common['Authorization-Token'] = tokenApi;
    return;
  }
  delete apiV2.defaults.headers.common['Authorization-Token'];
}

export function setApiV2BaseUrl(apiUrl?: string | null) {
  if (apiUrl) {
    apiV2.defaults.baseURL = apiUrl;
    return;
  }
  delete apiV2.defaults.baseURL;
}
