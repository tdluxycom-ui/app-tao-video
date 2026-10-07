import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { apiAccessToken, museRequest } from "./api";

// Correlation only, not authentication. Never persist the prompt, images or bearer token.
function fingerprint(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return `${a >>> 0}-${b >>> 0}-${value.length}`;
}
const storageKey = () => `tdluxy_pending_video_${fingerprint(apiAccessToken ?? "")}`;
async function read(key: string) {
  return Platform.OS === "web" ? window.sessionStorage.getItem(key) : SecureStore.getItemAsync(key);
}
async function write(key: string, value: string | null) {
  if (Platform.OS === "web") {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } else if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}
export async function submitVideo(payload: object) {
  const key = storageKey();
  const signature = fingerprint(JSON.stringify(payload));
  let pending: { signature: string; requestId: string } | null = null;
  try { pending = JSON.parse(await read(key) ?? "null"); } catch { /* malformed local state */ }
  if (!pending || pending.signature !== signature || typeof pending.requestId !== "string") {
    pending = { signature, requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
    await write(key, JSON.stringify(pending));
  }
  const created = await museRequest<{ job_id: string }>("/api/muse/videos", {
    method: "POST", body: JSON.stringify({ ...payload, request_id: pending.requestId }),
  });
  // Retain the key until a terminal result is seen, including across reload/network loss.
  const requestId = pending.requestId;
  return { ...created, finish: async () => {
    const current = await read(key);
    if (current && JSON.parse(current).requestId === requestId) await write(key, null);
  } };
}
