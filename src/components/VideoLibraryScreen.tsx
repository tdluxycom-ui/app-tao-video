import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, Modal } from "react-native";
import { styles } from "../styles/studio";
import { museRequest } from "../services/api";
import type { VideoJobRecord, VideoUsage } from "../types";
import { InlineNotice } from "./InlineNotice";
export function VideoLibraryScreen({
  screen,
  isMobile,
  onCreateVariant,
  onOpenVideo,
}: {
  screen: "Dự án" | "Lịch sử";
  isMobile: boolean;
  onCreateVariant: (prompt: string) => void;
  onOpenVideo: (jobId: string, index: number, name: string, prompt: string) => void;
}) {
  const [jobs, setJobs] = useState<VideoJobRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<VideoUsage | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoJobRecord | null>(null);
  const mounted = useRef(true);
  const fetching = useRef(false);

  const loadJobs = async (foreground = true) => {
    if (fetching.current) return;
    fetching.current = true;
    if (foreground) setLoading(true);
    try {
      const [result, currentUsage] = await Promise.all([
        museRequest<{ jobs: VideoJobRecord[] }>("/api/muse/jobs?limit=200"),
        museRequest<VideoUsage>("/api/muse/usage"),
      ]);
      if (mounted.current) { setJobs(result.jobs); setUsage(currentUsage); setError(""); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Không tải được thư viện video.");
    } finally {
      fetching.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void loadJobs();
    const timer = setInterval(() => void loadJobs(false), 5000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);

  const runAction = async (job: VideoJobRecord, action: "resume" | "cancel" | "delete") => {
    if (pendingAction) return;
    setPendingAction(job.job_id);
    setError("");
    try {
      await museRequest(`/api/muse/jobs/${job.job_id}${action === "delete" ? "" : `/${action}`}`, {
        method: action === "delete" ? "DELETE" : "POST",
      });
      if (mounted.current) setDeleteTarget(null);
      await loadJobs(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Không thực hiện được thao tác.");
    } finally {
      if (mounted.current) setPendingAction(null);
    }
  };

  const query = search.trim().toLocaleLowerCase("vi");
  const visibleJobs = jobs.filter((job) =>
    !query ||
    job.prompt.toLocaleLowerCase("vi").includes(query) ||
    job.videos.some((video) => video.name.toLocaleLowerCase("vi").includes(query)),
  );
  const title = screen === "Dự án" ? "Thư viện sáng tạo" : "Lịch sử tác vụ";

  return (
    <View style={styles.libraryScreen}>
      <View style={[styles.libraryHeader, isMobile && styles.libraryHeaderMobile]}>
        <View style={styles.libraryIntro}>
          <Text style={styles.sectionEyebrow}>
            {screen === "Dự án" ? "VIDEO CỦA BẠN" : "TÁC VỤ TDLUXY"}
          </Text>
          <Text style={styles.sectionHeading}>{title}</Text>
          <Text style={styles.sectionSubheading}>
            Prompt, trạng thái và video được lưu cục bộ trên backend này.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Làm mới thư viện video"
          onPress={() => void loadJobs()}
          disabled={loading}
          style={styles.libraryRefresh}
        >
          <Ionicons name="refresh-outline" size={16} color="#6D53D8" />
          <Text style={styles.libraryRefreshText}>Làm mới</Text>
        </Pressable>
      </View>

      <View style={styles.librarySearch}>
        <Ionicons name="search-outline" size={16} color="#898798" />
        <TextInput
          accessibilityLabel="Tìm trong thư viện video"
          value={search}
          onChangeText={setSearch}
          placeholder="Tìm theo prompt hoặc tên video"
          placeholderTextColor="#A4A2AF"
          style={styles.librarySearchInput}
        />
        <Text style={styles.libraryCount}>{jobs.length}</Text>
      </View>

      {error ? <InlineNotice tone="error" message={error} /> : null}
      {usage ? (
        <View style={styles.libraryCard}>
          <Text style={styles.libraryPrompt}>Hạn mức video của bạn</Text>
          <Text style={styles.sectionSubheading}>
            Đang chờ/chạy: {usage.active}/{usage.active_limit} · Hôm nay (UTC): {usage.daily}/{usage.daily_limit}
          </Text>
          <Text style={styles.sectionSubheading}>
            Đã lưu {(usage.used_bytes / 1024 ** 2).toFixed(0)} MB · Giữ chỗ {(usage.reserved_bytes / 1024 ** 2).toFixed(0)} MB / {(usage.storage_limit_bytes / 1024 ** 3).toFixed(1)} GB
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.libraryEmpty}>
          <View style={styles.libraryEmptyIcon}>
            <Ionicons name="sync-outline" size={22} color="#7456E8" />
          </View>
          <Text style={styles.libraryEmptyTitle}>Đang tải thư viện…</Text>
          <Text style={styles.libraryEmptyText}>Đang đồng bộ các tác vụ đã lưu từ backend.</Text>
        </View>
      ) : visibleJobs.length ? (
        <View style={styles.libraryList}>
          {visibleJobs.map((job) => (
            <View key={job.job_id} style={styles.libraryCard}>
              <View style={[styles.libraryCardTop, isMobile && styles.libraryCardTopMobile]}>
                <View style={styles.libraryCardIcon}>
                  <Ionicons
                    name={job.status === "completed" ? "videocam-outline" : "time-outline"}
                    size={19}
                    color={job.status === "completed" ? "#7154DD" : "#B17D38"}
                  />
                </View>
                <View style={styles.libraryCardCopy}>
                  <Text style={styles.libraryCardDate}>
                    {new Date(job.created_at).toLocaleString("vi-VN")}
                  </Text>
                  <Text style={styles.libraryPrompt} numberOfLines={3}>
                    {job.prompt}
                  </Text>
                </View>
                <View
                  style={[
                    styles.libraryStatus,
                    job.status === "completed"
                      ? styles.libraryStatusCompleted
                      : job.status === "failed"
                        ? styles.libraryStatusFailed
                        : styles.libraryStatusActive,
                  ]}
                >
                  <Text style={styles.libraryStatusText}>
                    {job.phase === "cancelled" ? "ĐÃ HỦY" : job.phase === "review" ? "CẦN KIỂM TRA" : job.can_resume ? "CHỜ LẤY KẾT QUẢ" : job.status === "queued" && job.phase === "tracking" ? "CHỜ KHÔI PHỤC" : {
                      queued: "ĐANG CHỜ",
                      running: "ĐANG TẠO",
                      completed: "HOÀN TẤT",
                      failed: "THẤT BẠI",
                    }[job.status]}
                  </Text>
                </View>
              </View>

              {job.error ? (
                <View style={styles.libraryJobError}>
                  <Ionicons name="alert-circle-outline" size={14} color="#B44755" />
                  <Text style={styles.libraryJobErrorText}>{job.error}</Text>
                </View>
              ) : null}

              {job.videos.map((video) => {
                const fileIndex = Number(
                  video.url.match(/\/files\/(\d+)$/)?.[1] ?? 0,
                );
                return (
                  <Pressable
                    key={video.url}
                    accessibilityRole="button"
                    onPress={() =>
                      onOpenVideo(job.job_id, fileIndex, video.name, job.prompt)
                    }
                    style={styles.libraryVideo}
                  >
                    <View style={styles.libraryVideoIcon}>
                      <Ionicons name="play" size={13} color="#FFFFFF" />
                    </View>
                    <View style={styles.libraryVideoCopy}>
                      <Text style={styles.libraryVideoName}>{video.name}</Text>
                      <Text style={styles.libraryVideoHint}>Phát video</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#8E8B9A" />
                  </Pressable>
                );
              })}

              <View style={styles.libraryActions}>
                {job.can_resume ? (
                  <Pressable disabled={pendingAction !== null} onPress={() => void runAction(job, "resume")} style={styles.libraryVariantButton} accessibilityRole="button">
                    <Text style={styles.libraryVariantText}>{job.phase === "prepared" ? "Thử lại tác vụ chưa gửi" : "Tiếp tục theo dõi"}</Text>
                  </Pressable>
                ) : null}
                {job.status === "queued" && job.phase === "prepared" ? (
                  <Pressable disabled={pendingAction !== null} onPress={() => void runAction(job, "cancel")} style={styles.libraryVariantButton} accessibilityRole="button">
                    <Text style={styles.libraryVariantText}>Hủy tác vụ chưa gửi</Text>
                  </Pressable>
                ) : null}
                {job.status === "completed" || job.status === "failed" ? (
                  <Pressable disabled={pendingAction !== null} onPress={() => setDeleteTarget(job)} style={styles.libraryVariantButton} accessibilityRole="button">
                    <Text style={styles.libraryVariantText}>Xóa tác vụ</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={job.status === "queued" || job.status === "running" || job.can_resume || job.phase === "review"}
                  onPress={() => onCreateVariant(job.prompt)}
                  style={styles.libraryVariantButton}
                >
                  <Ionicons name="copy-outline" size={15} color="#6F53D9" />
                  <Text style={styles.libraryVariantText}>{job.can_resume || job.phase === "review" ? "Kiểm tra kết quả trước khi tạo lại" : "Tạo phiên bản mới"}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.libraryEmpty}>
          <View style={styles.libraryEmptyIcon}>
            <Ionicons name={search ? "search-outline" : "film-outline"} size={22} color="#7456E8" />
          </View>
          <Text style={styles.libraryEmptyTitle}>
            {search ? "Không tìm thấy tác vụ" : "Chưa có video trong thư viện"}
          </Text>
          <Text style={styles.libraryEmptyText}>
            {search
              ? "Thử từ khóa khác hoặc xóa nội dung tìm kiếm."
              : "Video và prompt hoàn tất từ Muse sẽ tự xuất hiện tại đây."}
          </Text>
          {!search ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onCreateVariant("")}
              style={styles.libraryCreateButton}
            >
              <Ionicons name="sparkles" size={15} color="#FFFFFF" />
              <Text style={styles.libraryCreateText}>Bắt đầu tạo video</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      <Modal visible={Boolean(deleteTarget)} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.videoModalOverlay}>
          <View style={styles.videoModalCard}>
            <Text style={styles.sectionHeading}>Xóa tác vụ và video đã lưu?</Text>
            <Text style={styles.sectionSubheading}>Thao tác giải phóng dung lượng trên máy chủ và không thể hoàn tác. Hãy tải video cần giữ trước. Hạn mức hôm nay không được hoàn lại.</Text>
            {error ? <InlineNotice tone="error" message={error} /> : null}
            <View style={styles.libraryActions}>
              <Pressable disabled={pendingAction !== null} style={styles.libraryVariantButton} onPress={() => setDeleteTarget(null)}><Text style={styles.libraryVariantText}>Giữ lại</Text></Pressable>
              <Pressable disabled={pendingAction !== null} style={styles.libraryVariantButton} onPress={() => deleteTarget && void runAction(deleteTarget, "delete")}><Text style={styles.libraryVariantText}>{pendingAction ? "Đang xóa…" : "Xóa vĩnh viễn"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

