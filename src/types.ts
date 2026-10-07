export type Screen = "Muse" | "Khám phá" | "Dự án" | "Lịch sử" | "Cài đặt" | "Quản trị";
export type MuseTab = "chat" | "video" | "image" | "edit-image" | "collage" | "edit-video" | "publish";
export type MuseMessage = { role: "user" | "assistant" | "system"; content: string };
export type MuseImage = { name: string; base64: string; uri: string };
export type MuseMediaOutput = {
  name: string;
  mediaType: string;
  previewUri: string;
  fullUri: string;
  width: number;
  height: number;
};
export type VideoFile = { name: string; url: string };
export type VideoJobRecord = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  prompt: string;
  session_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  videos: VideoFile[];
  phase: string;
  can_resume: boolean;
  title?: string;
  favorite?: boolean;
  settings?: { industry?: string; goal?: string; audience?: string };
  reference_names?: string[];
};
export type VideoUsage = {
  active: number; daily: number; used_bytes: number; reserved_bytes: number;
  active_limit: number; daily_limit: number; storage_limit_bytes: number;
};
export type VideoPreview = { uri: string; name: string; prompt: string };
export type AdminOverview = {
  backend: { status: "online"; uptime_seconds: number };
  muse: { authenticated: boolean; accounts: number };
  jobs: { queued: number; running: number; completed: number; failed: number; total: number };
};
export type MuseAccountRecord = {
  id: string;
  email: string;
  active: boolean;
  created_at: string;
  active_jobs: number;
};
export type TdluxyUser = { id: string; email: string; role: "user" | "admin" };

