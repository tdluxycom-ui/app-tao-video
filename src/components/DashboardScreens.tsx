import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { styles } from "../styles/studio";
import { museRequest, MUSE_API_URL } from "../services/api";
import { InlineNotice } from "./InlineNotice";
import type { VideoPreview, MuseMediaOutput, MuseImage, AdminOverview, MuseAccountRecord } from "../types";
export function SettingsScreen({
  onOpenMuse,
  onOpenAdmin,
  onLogout,
  email,
  isAdmin,
}: {
  onOpenMuse: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  email: string;
  isAdmin: boolean;
}) {
  return (
    <View style={styles.settingsScreen}>
      <View style={styles.settingsIntro}>
        <Text style={styles.sectionEyebrow}>THIẾT LẬP KHÔNG GIAN</Text>
        <Text style={styles.sectionHeading}>Kết nối dịch vụ AI</Text>
        <Text style={styles.sectionSubheading}>
          Quản lý các dịch vụ tạo nội dung và trạng thái tích hợp.
        </Text>
      </View>

      <View style={styles.accountSettingsCard}>
        <View style={styles.accountSettingsIcon}>
          <Ionicons name="person-circle-outline" size={23} color="#7054E8" />
        </View>
        <View style={styles.accountSettingsCopy}>
          <Text style={styles.accountSettingsTitle}>Tài khoản TDLUXY</Text>
          <Text style={styles.accountSettingsEmail}>{email}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onLogout}
          style={({ pressed }) => [
            styles.accountLogoutButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.accountLogoutText}>Đăng xuất</Text>
        </Pressable>
      </View>

      <View style={styles.integrationCard}>
        <View style={styles.integrationHeader}>
          <View style={styles.integrationBrand}>
            <View style={styles.integrationLogo}>
              <Ionicons name="videocam" size={21} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.integrationName}>MuseAI</Text>
              <Text style={styles.integrationType}>DỊCH VỤ TẠO VIDEO</Text>
            </View>
          </View>
          <View style={styles.connectedPill}>
            <View style={styles.statusDot} />
            <Text style={styles.connectedText}>ĐÃ TÍCH HỢP BACKEND</Text>
          </View>
        </View>
        <Text style={styles.integrationDescription}>
          MuseAI-API hiện là thư viện Python không chính thức cho tạo video từ văn bản hoặc tạo
          video dựa trên ảnh tham chiếu. Đây không phải API HTTP dùng trực tiếp từ trình duyệt/app.
        </Text>
        <View style={styles.capabilityRows}>
          <CapabilityRow
            icon="checkmark-circle"
            text="Có thể hỗ trợ text-to-video và image-to-video"
            positive
          />
          <CapabilityRow
            icon="close-circle"
            text="Không có chức năng tạo ảnh độc lập"
          />
          <CapabilityRow
            icon="document-text-outline"
            text="Đang dùng mã tại commit được ghim; thư viện không chính thức và cần tuân thủ điều khoản Muse.ai"
          />
        </View>
        <View style={styles.integrationFootnote}>
          <Ionicons name="shield-checkmark-outline" size={17} color="#7054E8" />
          <Text style={styles.integrationFootnoteText}>
            Email và mã OTP chỉ gửi tới backend cục bộ; phiên Muse được lưu ngoài bundle app.
          </Text>
        </View>
      </View>

      <View style={styles.nextStepsCard}>
        <View style={styles.nextStepsIcon}>
          <Ionicons name="git-branch-outline" size={19} color="#477DC7" />
        </View>
        <View style={styles.nextStepsCopy}>
          <Text style={styles.nextStepsTitle}>Tạo ảnh vẫn cần dịch vụ riêng</Text>
          <Text style={styles.nextStepsText}>
            MuseAI-API hỗ trợ chat và tạo video từ văn bản/ảnh tham chiếu; repository chưa cung cấp
            tạo ảnh độc lập. Hãy kết nối Muse trong mục Muse để bắt đầu.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenMuse}
          style={({ pressed }) => [
            styles.settingsMuseButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Ionicons name="chatbubbles-outline" size={16} color="#FFFFFF" />
          <Text style={styles.settingsMuseButtonText}>Kết nối Muse ngay</Text>
          <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
        </Pressable>
      </View>

      {isAdmin ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenAdmin}
          style={({ pressed }) => [
            styles.adminEntry,
            pressed && styles.cardPressed,
          ]}
        >
          <View style={styles.adminEntryIcon}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#D6B875" />
          </View>
          <View style={styles.adminEntryCopy}>
            <Text style={styles.adminEntryTitle}>Bảng điều hành</Text>
            <Text style={styles.adminEntryText}>
              Theo dõi backend, Muse và trạng thái các công cụ.
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color="#8D7B55" />
        </Pressable>
      ) : null}
    </View>
  );
}

export function AdminScreen({
  isMobile,
  onOpenSettings,
}: {
  isMobile: boolean;
  onOpenSettings: () => void;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const result = await museRequest<AdminOverview>("/api/admin/overview");
      setOverview(result);
    } catch (cause) {
      setOverview(null);
      setError(cause instanceof Error ? cause.message : "Không tải được trạng thái hệ thống.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const serviceOnline = overview?.backend.status === "online";
  const toolRows: {
    title: string;
    detail: string;
    state: string;
    icon: keyof typeof Ionicons.glyphMap;
    active: boolean;
  }[] = [
    {
      title: "TDLUXY · Chat & video",
      detail: "Dịch vụ Muse.ai qua phiên backend cục bộ",
      state: overview?.muse.authenticated ? "ĐANG KẾT NỐI" : "CHỜ ĐĂNG NHẬP",
      icon: "sparkles",
      active: Boolean(overview?.muse.authenticated),
    },
    {
      title: "Chỉnh ảnh & ghép ảnh",
      detail: "Xử lý cục bộ bằng Pillow",
      state: "ĐANG HOẠT ĐỘNG",
      icon: "image-outline",
      active: true,
    },
    {
      title: "Âm thanh & xuất bản",
      detail: "Cần dịch vụ và quyền nền tảng riêng",
      state: "ĐANG LÊN KẾ HOẠCH",
      icon: "musical-notes-outline",
      active: false,
    },
  ];

  return (
    <View style={styles.adminScreen}>
      <View style={[styles.adminHero, isMobile && styles.adminHeroMobile]}>
        <View style={styles.adminHeroGlow} />
        <View style={styles.adminHeroCopy}>
          <View style={styles.adminEyebrow}>
            <Ionicons name="shield-checkmark" size={13} color="#E7C982" />
            <Text style={styles.adminEyebrowText}>CONTROL ROOM · LOCAL OVERVIEW</Text>
          </View>
          <Text style={styles.adminHeroTitle}>Mọi thứ trong tầm nhìn.</Text>
          <Text style={styles.adminHeroSubtitle}>
            Bảng điều hành sáng tạo của bạn — rõ ràng, an toàn, không số liệu ảo.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Làm mới bảng điều hành"
          onPress={() => void refresh()}
          disabled={refreshing}
          style={({ pressed }) => [
            styles.adminRefreshButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Ionicons
            name={refreshing ? "time-outline" : "refresh-outline"}
            size={16}
            color="#F3E9D2"
          />
          <Text style={styles.adminRefreshText}>
            {refreshing ? "Đang tải" : "Làm mới"}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.adminError}>
          <InlineNotice tone="error" message={error} />
          <Text style={styles.adminErrorHint}>
            Kiểm tra backend Muse đang chạy và cấu hình bridge token nếu đã bật.
          </Text>
        </View>
      ) : null}

      <View style={[styles.adminStats, isMobile && styles.adminStatsMobile]}>
        <AdminStat
          compact={isMobile}
          label="BACKEND"
          value={serviceOnline ? "Hoạt động" : "Chưa rõ"}
          detail={serviceOnline ? formatUptime(overview.backend.uptime_seconds) : "Chưa nhận dữ liệu"}
          icon="server-outline"
          tint="#E9F6F0"
          color="#319477"
        />
        <AdminStat
          compact={isMobile}
          label="MUSE"
          value={overview?.muse.authenticated ? "Đã kết nối" : "Chưa đăng nhập"}
          detail="Phiên Muse trên backend này"
          icon="sparkles-outline"
          tint="#F1EDFF"
          color="#7458E8"
        />
        <AdminStat
          compact={isMobile}
          label="TÁC VỤ ĐANG CHẠY"
          value={String(overview?.jobs.running ?? 0)}
          detail={`${overview?.jobs.queued ?? 0} đang chờ · ${overview?.jobs.total ?? 0} tác vụ đã lưu`}
          icon="sync-outline"
          tint="#FFF3E3"
          color="#C18738"
        />
      </View>

      <View style={[styles.adminColumns, isMobile && styles.adminColumnsMobile]}>
        <View style={styles.adminPanel}>
          <View style={styles.adminPanelHeader}>
            <View>
              <Text style={styles.adminPanelEyebrow}>VẬN HÀNH</Text>
              <Text style={styles.adminPanelTitle}>Tình trạng dịch vụ</Text>
            </View>
            <View style={styles.adminLiveBadge}>
              <View style={[styles.adminLiveDot, !serviceOnline && styles.adminLiveDotOff]} />
              <Text style={styles.adminLiveText}>{serviceOnline ? "LIVE" : "CHƯA KẾT NỐI"}</Text>
            </View>
          </View>
          {toolRows.map((row) => (
            <View key={row.title} style={styles.adminServiceRow}>
              <View style={[styles.adminServiceIcon, row.active && styles.adminServiceIconActive]}>
                <Ionicons name={row.icon} size={17} color={row.active ? "#6C52D6" : "#8D899A"} />
              </View>
              <View style={styles.adminServiceCopy}>
                <Text style={styles.adminServiceTitle}>{row.title}</Text>
                <Text style={styles.adminServiceDetail}>{row.detail}</Text>
              </View>
              <Text style={[styles.adminServiceState, row.active && styles.adminServiceStateActive]}>
                {row.state}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.adminPanel}>
          <Text style={styles.adminPanelEyebrow}>TÁC VỤ MUSE · PHIÊN HIỆN TẠI</Text>
          <Text style={styles.adminPanelTitle}>Hoạt động sáng tạo</Text>
          <View style={styles.adminJobGrid}>
            <AdminJobCount label="Hoàn tất" value={overview?.jobs.completed ?? 0} tone="success" />
            <AdminJobCount label="Đang xử lý" value={overview?.jobs.running ?? 0} tone="active" />
            <AdminJobCount label="Đang chờ" value={overview?.jobs.queued ?? 0} tone="waiting" />
            <AdminJobCount label="Cần kiểm tra" value={overview?.jobs.failed ?? 0} tone="failed" />
          </View>
          <Text style={styles.adminFootnote}>
            Danh sách tác vụ được khôi phục từ SQLite trên backend cục bộ; file video vẫn nằm trên máy chạy backend.
          </Text>
        </View>
      </View>

      <MuseAccountManager />

      <View style={[styles.adminNextPanel, isMobile && styles.adminNextPanelMobile]}>
        <View style={styles.adminNextIcon}>
          <Ionicons name="diamond-outline" size={19} color="#D1B46D" />
        </View>
        <View style={styles.adminNextCopy}>
          <Text style={styles.adminNextEyebrow}>TÍCH HỢP CẦN CẤU HÌNH</Text>
          <Text style={styles.adminNextTitle}>AI tạo ảnh, video và xuất bản</Text>
          <Text style={styles.adminNextText}>
            Chỉnh ảnh và ghép ảnh đã chạy trên backend. Tạo ảnh AI, biên tập video, tạo nhạc và tự đăng cần model/API riêng; trình duyệt điều khiển từ xa sẽ yêu cầu cấu hình runtime bảo mật.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.adminSettingsButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.adminSettingsButtonText}>Cấu hình</Text>
          <Ionicons name="arrow-forward" size={14} color="#E9D9B3" />
        </Pressable>
      </View>
    </View>
  );
}

function MuseAccountManager() {
  const [accounts, setAccounts] = useState<MuseAccountRecord[]>([]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    try {
      const result = await museRequest<{ accounts: MuseAccountRecord[] }>("/api/muse/accounts");
      setAccounts(result.accounts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được nhóm tài khoản Muse.");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const requestCode = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await museRequest<{ message: string; account_id: string }>(
        "/api/muse/auth/otp",
        { method: "POST", body: JSON.stringify({ email: email.trim() }) },
      );
      setPendingAccountId(result.account_id);
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được mã Muse.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!pendingAccountId || !code.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await museRequest("/api/muse/auth/verify", {
        method: "POST",
        body: JSON.stringify({ account_id: pendingAccountId, code: code.trim() }),
      });
      setCode("");
      setEmail("");
      setPendingAccountId(null);
      setNotice("Đã thêm tài khoản Muse vào nhóm dùng chung.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xác minh được tài khoản Muse.");
    } finally {
      setBusy(false);
    }
  };

  const toggleAccount = async (account: MuseAccountRecord) => {
    setError("");
    try {
      await museRequest(`/api/muse/accounts/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !account.active }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không cập nhật được tài khoản Muse.");
    }
  };

  const removeAccount = async (account: MuseAccountRecord) => {
    setError("");
    try {
      await museRequest(`/api/muse/accounts/${encodeURIComponent(account.id)}`, {
        method: "DELETE",
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xóa được tài khoản Muse.");
    }
  };

  return (
    <View style={styles.adminPanel}>
      <Text style={styles.adminPanelEyebrow}>MUSE · NHÓM TÀI KHOẢN DÙNG CHUNG</Text>
      <Text style={styles.adminPanelTitle}>Quản lý luồng xử lý</Text>
      <Text style={styles.adminFootnote}>
        Tài khoản được lưu bằng mã hóa Fernet. Cần cấu hình TDLUXY_MUSE_VAULT_KEY trên máy chủ.
        Video được phân bổ theo tải; mỗi tài khoản xử lý tuần tự.
      </Text>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {notice ? <InlineNotice tone="success" message={notice} /> : null}
      {accounts.map((account) => (
        <View key={account.id} style={styles.museAccountRow}>
          <View
            style={[
              styles.museAccountDot,
              !account.active && styles.museAccountDotInactive,
            ]}
          />
          <View style={styles.museAccountCopy}>
            <Text style={styles.museAccountEmail}>{account.email}</Text>
            <Text style={styles.museAccountState}>
              {account.active ? "Đang nhận tác vụ" : "Đang tạm dừng"} · {account.active_jobs} job
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void toggleAccount(account)}
            style={styles.museAccountAction}
          >
            <Text style={styles.museAccountActionText}>
              {account.active ? "Tạm dừng" : "Bật"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void removeAccount(account)}
            style={[styles.museAccountAction, styles.museAccountRemove]}
          >
            <Text style={styles.museAccountRemoveText}>Xóa</Text>
          </Pressable>
        </View>
      ))}
      {pendingAccountId ? (
        <View style={styles.museAccountForm}>
          <TextInput
            accessibilityLabel="Mã OTP tài khoản Muse"
            autoComplete="one-time-code"
            keyboardType="number-pad"
            onChangeText={setCode}
            placeholder="Nhập mã OTP"
            placeholderTextColor="#A4A2AF"
            style={styles.formInput}
            value={code}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!code.trim() || busy}
            onPress={() => void verifyCode()}
            style={({ pressed }) => [
              styles.studioRunButton,
              (!code.trim() || busy) && styles.disabledButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.studioRunText}>
              {busy ? "Đang xác minh..." : "Xác minh & thêm"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.museAccountForm}>
          <TextInput
            accessibilityLabel="Email Muse cần thêm"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email tài khoản Muse"
            placeholderTextColor="#A4A2AF"
            style={styles.formInput}
            value={email}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!email.trim() || busy}
            onPress={() => void requestCode()}
            style={({ pressed }) => [
              styles.studioRunButton,
              (!email.trim() || busy) && styles.disabledButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.studioRunText}>
              {busy ? "Đang gửi OTP..." : "Thêm tài khoản Muse"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AdminStat({
  compact,
  label,
  value,
  detail,
  icon,
  tint,
  color,
}: {
  compact: boolean;
  label: string;
  value: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  color: string;
}) {
  return (
    <View style={[styles.adminStat, compact && styles.adminStatsMobileCard]}>
      <View style={styles.adminStatTop}>
        <Text style={styles.adminStatLabel}>{label}</Text>
        <View style={[styles.adminStatIcon, { backgroundColor: tint }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
      </View>
      <Text style={styles.adminStatValue}>{value}</Text>
      <Text style={styles.adminStatDetail}>{detail}</Text>
    </View>
  );
}

function AdminJobCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "active" | "waiting" | "failed";
}) {
  const toneStyle = {
    success: styles.adminJobValue_success,
    active: styles.adminJobValue_active,
    waiting: styles.adminJobValue_waiting,
    failed: styles.adminJobValue_failed,
  }[tone];
  return (
    <View style={styles.adminJobCount}>
      <Text style={[styles.adminJobValue, toneStyle]}>{value}</Text>
      <Text style={styles.adminJobLabel}>{label}</Text>
    </View>
  );
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `Hoạt động ${hours} giờ ${minutes} phút` : `Hoạt động ${minutes} phút`;
}

function CapabilityRow({
  icon,
  text,
  positive = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  positive?: boolean;
}) {
  return (
    <View style={styles.capabilityRow}>
      <Ionicons
        name={icon}
        size={16}
        color={positive ? "#32977F" : "#92909E"}
      />
      <Text style={styles.capabilityText}>{text}</Text>
    </View>
  );
}

