import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
const AUTH_TOKEN_KEY = "tdluxy_session_token";
export let apiAccessToken: string | null = null;
export function setApiAccessToken(token: string | null) { apiAccessToken = token; }
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function readAuthToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(AUTH_TOKEN_KEY);
  }
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
}

export async function writeAuthToken(token: string | null): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      if (token) window.sessionStorage.setItem(AUTH_TOKEN_KEY, token);
      else window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
    }
    return;
  }
  if (token) await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}

export const isCloudflareQuickTunnel =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  window.location.hostname.endsWith(".trycloudflare.com");
export const MUSE_API_URL =
  process.env.EXPO_PUBLIC_MUSE_API_URL?.replace(/\/+$/, "") ||
  (isCloudflareQuickTunnel
    ? window.location.origin
    : Platform.OS === "android"
      ? "http://10.0.2.2:8787"
      : "http://127.0.0.1:8787");

export async function museRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.EXPO_PUBLIC_MUSE_BRIDGE_TOKEN;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${MUSE_API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      ...(isCloudflareQuickTunnel &&
      typeof window !== "undefined" &&
      MUSE_API_URL === window.location.origin
        ? { credentials: "include" as const }
        : {}),
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { "X-Bridge-Token": token } : {}),
        ...(apiAccessToken ? { Authorization: `Bearer ${apiAccessToken}` } : {}),
        ...init.headers,
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        data && typeof data.detail === "string"
          ? data.detail
          : `Muse bridge trả về lỗi HTTP ${response.status}.`;
      throw new ApiRequestError(detail, response.status);
    }
    return data as T;
  } catch (cause) {
    if (controller.signal.aborted && !init.signal) {
      throw new Error("Backend không phản hồi trong 45 giây. Hãy kiểm tra kết nối rồi thử lại.");
    }
    throw cause;
  } finally {
    clearTimeout(timeoutId);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

