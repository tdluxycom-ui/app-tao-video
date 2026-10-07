import { SettingsScreen, AdminScreen } from "./src/components/DashboardScreens";
import { VideoViewerModal, MuseMediaGallery, StudioTaskPanel, VideoCreationModal } from "./src/components/StudioPanels";
import { PublisherPanel } from "./src/components/PublisherPanel";
import { styles } from "./src/styles/studio";
import { InlineNotice } from "./src/components/InlineNotice";
import { VideoLibraryScreen } from "./src/components/VideoLibraryScreen";
import { submitVideo } from "./src/services/videoSubmission";
import { apiAccessToken, setApiAccessToken, ApiRequestError, readAuthToken, writeAuthToken, museRequest, MUSE_API_URL, isCloudflareQuickTunnel } from "./src/services/api";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import type { Screen, MuseTab, MuseMessage, MuseImage, MuseMediaOutput, VideoFile, VideoJobRecord, VideoPreview, AdminOverview, MuseAccountRecord, TdluxyUser } from "./src/types";



function readMuseMedia(value: unknown): MuseMediaOutput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const media = entry as Record<string, unknown>;
    if (
      typeof media.preview_base64 !== "string" ||
      typeof media.media_type !== "string" ||
      !media.media_type.startsWith("image/") ||
      typeof media.image_url !== "string" ||
      typeof media.width !== "number" ||
      typeof media.height !== "number"
    ) {
      return [];
    }
    return [
      {
        name:
          typeof media.name === "string" && media.name.trim()
            ? media.name
            : `muse-image-${index + 1}`,
        mediaType: media.media_type,
        previewUri: `data:image/jpeg;base64,${media.preview_base64}`,
        fullUri: `${MUSE_API_URL}${media.image_url}`,
        width: media.width,
        height: media.height,
      },
    ];
  });
}

async function saveImageResult(dataUri: string, filename: string): Promise<void> {
  const base64 = dataUri.split(",", 2)[1];
  if (!base64) throw new Error("Không đọc được dữ liệu ảnh kết quả.");
  if (Platform.OS === "web") {
    if (typeof document === "undefined") throw new Error("Không thể tải ảnh trong trình duyệt này.");
    const link = document.createElement("a");
    link.href = dataUri;
    link.download = filename;
    link.click();
    return;
  }
  if (!FileSystem.cacheDirectory) throw new Error("Thiết bị không có thư mục lưu tệp tạm.");
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "image/jpeg", UTI: "public.jpeg" });
  } else {
    throw new Error("Thiết bị chưa hỗ trợ chia sẻ tệp ảnh.");
  }
}

function AccountGate({
  onAuthenticated,
  initialError,
}: {
  onAuthenticated: (token: string, user: TdluxyUser) => Promise<void>;
  initialError: string;
}) {
  const [registerMode, setRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!email.trim() || !password || busy) return;
    if (registerMode && password.length < 12) {
      setError("Mật khẩu cần có ít nhất 12 ký tự.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await museRequest<{ token: string; user: TdluxyUser }>(
        registerMode ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), password }),
        },
      );
      await onAuthenticated(response.token, response.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể đăng nhập.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={landingStyles.root}>
      <StatusBar style="light" />
      <LandingOrbs />
      <ScrollView
        contentContainerStyle={landingStyles.authScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={landingStyles.authCard}>
          <View style={landingStyles.unlockGlow} pointerEvents="none" />
          <View style={landingStyles.brandRow}>
            <View style={landingStyles.brandMark}>
              <Ionicons name="sparkles" size={15} color="#FFFFFF" />
            </View>
            <Text style={landingStyles.brandText}>
              TDLUXY <Text style={landingStyles.brandAccent}>STUDIO</Text>
            </Text>
          </View>
          <Text style={landingStyles.authTitle}>
            {registerMode ? "Tạo không gian của riêng bạn" : "Chào mừng trở lại studio"}
          </Text>
          <Text style={landingStyles.authSub}>
            {registerMode
              ? "Đăng ký để lưu mọi tác phẩm vào không gian sáng tạo riêng."
              : "Đăng nhập để tiếp tục hành trình sáng tạo còn dang dở."}
          </Text>
          {initialError ? <Text style={landingStyles.unlockError}>{initialError}</Text> : null}
          <Text style={landingStyles.authLabel}>EMAIL</Text>
          <TextInput
            accessibilityLabel="Email tài khoản TDLUXY"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={setEmail}
            onSubmitEditing={() => void submit()}
            placeholder="ban@example.com"
            placeholderTextColor="#6E6A85"
            style={landingStyles.unlockInput}
            value={email}
            returnKeyType="next"
          />
          <Text style={landingStyles.authLabel}>MẬT KHẨU</Text>
          <TextInput
            accessibilityLabel="Mật khẩu tài khoản TDLUXY"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            placeholder={registerMode ? "Ít nhất 12 ký tự" : "Mật khẩu của bạn"}
            placeholderTextColor="#6E6A85"
            secureTextEntry
            style={landingStyles.unlockInput}
            value={password}
            returnKeyType="go"
          />
          {error ? <Text style={landingStyles.unlockError}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={!email.trim() || !password || busy}
            onPress={() => void submit()}
            style={({ pressed }) => [
              landingStyles.unlockButton,
              (!email.trim() || !password || busy) && landingStyles.unlockButtonDisabled,
              pressed && landingStyles.unlockButtonPressed,
            ]}
          >
            {busy ? <ActivityIndicator size="small" color="#0B0912" /> : null}
            <Text style={landingStyles.unlockButtonText}>
              {busy ? "Đang xác thực..." : registerMode ? "Tạo tài khoản" : "Đăng nhập"}
            </Text>
            {!busy ? <Ionicons name="arrow-forward" size={15} color="#0B0912" /> : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setRegisterMode((current) => !current);
              setError("");
            }}
            style={landingStyles.authSwitch}
          >
            <Text style={landingStyles.authSwitchText}>
              {registerMode ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký ngay"}
            </Text>
          </Pressable>
          <View style={landingStyles.unlockPrivacy}>
            <Ionicons name="shield-checkmark-outline" size={13} color="#8C88A1" />
            <Text style={landingStyles.unlockPrivacyText}>
              Phiên đăng nhập được lưu an toàn trên thiết bị.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LandingOrbs() {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 8000, useNativeDriver: false }),
        Animated.timing(drift, { toValue: 0, duration: 8000, useNativeDriver: false }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [drift]);
  const shift = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 54] });
  const shiftRev = drift.interpolate({ inputRange: [0, 1], outputRange: [36, -18] });
  return (
    <View style={landingStyles.aurora} pointerEvents="none">
      <Animated.View style={[landingStyles.orbOne, { transform: [{ translateY: shift }] }]} />
      <Animated.View style={[landingStyles.orbTwo, { transform: [{ translateY: shiftRev }] }]} />
      <View style={landingStyles.orbThree} />
      <View style={landingStyles.noise} />
    </View>
  );
}

const LANDING_FEATURES: Array<{
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  glow: string;
  title: string;
  text: string;
}> = [
  {
    icon: "videocam",
    tint: "#8B7CFF",
    glow: "rgba(139,124,255,0.16)",
    title: "Tạo video bằng AI",
    text: "Chỉ cần một câu mô tả — AI dựng thành thước phim chuyển động đầy điện ảnh.",
  },
  {
    icon: "chatbubbles",
    tint: "#F2B33D",
    glow: "rgba(242,179,61,0.14)",
    title: "Trò chuyện cùng AI",
    text: "Lên ý tưởng, viết kịch bản, hỏi đáp sáng tạo như có trợ lý bên cạnh.",
  },
  {
    icon: "color-wand",
    tint: "#F471B5",
    glow: "rgba(244,113,181,0.14)",
    title: "Vẽ & biến hóa ảnh",
    text: "Tạo ảnh từ chữ, chỉnh sửa, ghép collage — đậm chất riêng của bạn.",
  },
  {
    icon: "film",
    tint: "#34D399",
    glow: "rgba(52,211,153,0.13)",
    title: "Thư viện tác phẩm",
    text: "Mọi video và hình ảnh được lưu gọn gàng, xem lại và tải về bất cứ lúc nào.",
  },
];

function RemoteAccessGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { width } = useWindowDimensions();
  const isMobile = width < 920;

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await museRequest<{ authenticated: boolean }>("/api/access/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mật khẩu chưa đúng, thử lại nhé.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={landingStyles.root}>
      <StatusBar style="light" />
      <LandingOrbs />
      <ScrollView
        contentContainerStyle={[landingStyles.scroll, isMobile && landingStyles.scrollMobile]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[landingStyles.inner, isMobile && landingStyles.innerMobile]}>
          <View style={landingStyles.topbar}>
            <View style={landingStyles.brandRow}>
              <View style={landingStyles.brandMark}>
                <Ionicons name="sparkles" size={15} color="#FFFFFF" />
              </View>
              <Text style={landingStyles.brandText}>
                TDLUXY <Text style={landingStyles.brandAccent}>STUDIO</Text>
              </Text>
            </View>
            <View style={landingStyles.privateBadge}>
              <Ionicons name="lock-closed" size={10} color="#C9BFFF" />
              <Text style={landingStyles.privateBadgeText}>LIÊN KẾT RIÊNG TƯ</Text>
            </View>
          </View>

          <View style={[landingStyles.hero, isMobile && landingStyles.heroMobile]}>
            <View style={[landingStyles.heroCopy, isMobile && landingStyles.heroCopyMobile]}>
              <View style={landingStyles.pill}>
                <Ionicons name="sparkles" size={11} color="#C9BFFF" />
                <Text style={landingStyles.pillText}>STUDIO SÁNG TẠO VIDEO BẰNG AI</Text>
              </View>
              <Text style={[landingStyles.headline, isMobile && landingStyles.headlineMobile]}>
                Biến ý tưởng thành{"\n"}
                <Text style={landingStyles.headlineAccent}>video điện ảnh.</Text>
              </Text>
              <Text style={landingStyles.sub}>
                Gõ một dòng mô tả, nhận về thước phim chuyển động. Trò chuyện cùng AI, vẽ
                ảnh, chỉnh sửa và quản lý mọi tác phẩm — tất cả gói gọn trong một studio
                duy nhất, mở ra là dùng ngay.
              </Text>
              <View style={landingStyles.capabilityRow}>
                {[
                  { icon: "videocam-outline", label: "Video AI" },
                  { icon: "chatbubbles-outline", label: "Chat AI" },
                  { icon: "image-outline", label: "Ảnh AI" },
                  { icon: "film-outline", label: "Thư viện" },
                ].map((cap) => (
                  <View key={cap.label} style={landingStyles.capability}>
                    <Ionicons
                      name={cap.icon as keyof typeof Ionicons.glyphMap}
                      size={13}
                      color="#B9AFFF"
                    />
                    <Text style={landingStyles.capabilityText}>{cap.label}</Text>
                  </View>
                ))}
              </View>
              <View style={landingStyles.statsRow}>
                <View style={landingStyles.stat}>
                  <Text style={landingStyles.statValue}>07</Text>
                  <Text style={landingStyles.statLabel}>công cụ AI</Text>
                </View>
                <View style={landingStyles.statDivider} />
                <View style={landingStyles.stat}>
                  <Text style={landingStyles.statValue}>~5&apos;</Text>
                  <Text style={landingStyles.statLabel}>có video đầu tay</Text>
                </View>
                <View style={landingStyles.statDivider} />
                <View style={landingStyles.stat}>
                  <Text style={landingStyles.statValue}>12h</Text>
                  <Text style={landingStyles.statLabel}>phiên bảo mật</Text>
                </View>
              </View>
            </View>

            <View style={[landingStyles.unlockCard, isMobile && landingStyles.unlockCardMobile]}>
              <View style={landingStyles.unlockGlow} pointerEvents="none" />
              <View style={landingStyles.unlockIcon}>
                <Ionicons name="lock-closed" size={20} color="#FFFFFF" />
              </View>
              <Text style={landingStyles.unlockEyebrow}>BƯỚC VÀO STUDIO</Text>
              <Text style={landingStyles.unlockTitle}>Mở khóa không gian{"\n"}sáng tạo của bạn</Text>
              <Text style={landingStyles.unlockSub}>
                Nhập mật khẩu được chia sẻ để bắt đầu tạo video, trò chuyện và vẽ ảnh ngay
                lập tức.
              </Text>
              <TextInput
                accessibilityLabel="Mật khẩu chia sẻ"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPassword}
                onSubmitEditing={() => void submit()}
                placeholder="Nhập mật khẩu…"
                placeholderTextColor="#6E6A85"
                secureTextEntry
                style={landingStyles.unlockInput}
                value={password}
                returnKeyType="go"
              />
              {error ? <Text style={landingStyles.unlockError}>{error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                disabled={!password || busy}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  landingStyles.unlockButton,
                  (!password || busy) && landingStyles.unlockButtonDisabled,
                  pressed && landingStyles.unlockButtonPressed,
                ]}
              >
                {busy ? <ActivityIndicator size="small" color="#0B0912" /> : null}
                <Text style={landingStyles.unlockButtonText}>
                  {busy ? "Đang mở…" : "Bước vào Studio"}
                </Text>
                {!busy ? <Ionicons name="arrow-forward" size={15} color="#0B0912" /> : null}
              </Pressable>
              <View style={landingStyles.unlockPrivacy}>
                <Ionicons name="shield-checkmark-outline" size={13} color="#8C88A1" />
                <Text style={landingStyles.unlockPrivacyText}>
                  Được bảo vệ · Tự hết hạn sau 12 giờ
                </Text>
              </View>
            </View>
          </View>

          <View style={landingStyles.sectionHead}>
            <Text style={landingStyles.sectionEyebrow}>MỌI THỨ BẠN CẦN ĐỂ SÁNG TẠO</Text>
            <Text style={landingStyles.sectionTitle}>Một studio, vô vàn khả năng</Text>
          </View>
          <View style={[landingStyles.featureGrid, isMobile && landingStyles.featureGridMobile]}>
            {LANDING_FEATURES.map((feature) => (
              <View
                key={feature.title}
                style={[landingStyles.featureCard, { borderColor: feature.tint + "2E" }]}
              >
                <View style={[landingStyles.featureIcon, { backgroundColor: feature.glow }]}>
                  <Ionicons name={feature.icon} size={20} color={feature.tint} />
                </View>
                <Text style={landingStyles.featureTitle}>{feature.title}</Text>
                <Text style={landingStyles.featureText}>{feature.text}</Text>
              </View>
            ))}
          </View>

          <Text style={landingStyles.footer}>
            TDLUXY Studio · Không gian sáng tạo riêng tư của bạn
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const landingStyles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: "100%" as const,
    backgroundColor: "#07050D",
  },
  aurora: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  orbOne: {
    position: "absolute",
    width: 620,
    height: 620,
    borderRadius: 310,
    top: -180,
    left: -140,
    opacity: 0.85,
    ...Platform.select({
      web: {
        backgroundImage:
          "radial-gradient(circle, rgba(124,92,255,0.42) 0%, rgba(124,92,255,0) 68%)",
      } as any,
      default: { backgroundColor: "rgba(124,92,255,0.14)" },
    }),
  },
  orbTwo: {
    position: "absolute",
    width: 520,
    height: 520,
    borderRadius: 260,
    top: "22%",
    right: -160,
    opacity: 0.8,
    ...Platform.select({
      web: {
        backgroundImage:
          "radial-gradient(circle, rgba(217,70,239,0.30) 0%, rgba(217,70,239,0) 68%)",
      } as any,
      default: { backgroundColor: "rgba(217,70,239,0.10)" },
    }),
  },
  orbThree: {
    position: "absolute",
    width: 460,
    height: 460,
    borderRadius: 230,
    bottom: -160,
    left: "30%",
    opacity: 0.7,
    ...Platform.select({
      web: {
        backgroundImage:
          "radial-gradient(circle, rgba(242,179,61,0.20) 0%, rgba(242,179,61,0) 68%)",
      } as any,
      default: { backgroundColor: "rgba(242,179,61,0.08)" },
    }),
  },
  noise: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.5,
    ...Platform.select({
      web: {
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
        backgroundSize: "26px 26px",
      } as any,
      default: {},
    }),
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: 34,
    paddingHorizontal: 28,
  },
  scrollMobile: {
    paddingVertical: 24,
    paddingHorizontal: 18,
  },
  inner: {
    width: "100%",
    maxWidth: 1120,
  },
  innerMobile: {
    maxWidth: 560,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 54,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7C5CFF",
    ...Platform.select({
      web: { boxShadow: "0 6px 24px rgba(124,92,255,0.55)" },
      default: { elevation: 4 },
    }),
  },
  brandText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 2.2,
  },
  brandAccent: {
    color: "#A78BFA",
  },
  privateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(201,191,255,0.28)",
    backgroundColor: "rgba(124,92,255,0.12)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  privateBadgeText: {
    color: "#C9BFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 56,
    marginBottom: 72,
  },
  heroMobile: {
    flexDirection: "column",
    gap: 34,
    marginBottom: 52,
  },
  heroCopy: {
    flex: 1.15,
  },
  heroCopyMobile: {
    flex: 0,
    width: "100%",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
    backgroundColor: "rgba(124,92,255,0.10)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 22,
  },
  pillText: {
    color: "#C9BFFF",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 54,
    fontWeight: "800",
    letterSpacing: -1.6,
    lineHeight: 62,
    marginBottom: 18,
  },
  headlineMobile: {
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: -1,
  },
  headlineAccent: {
    ...Platform.select({
      web: {
        backgroundImage: "linear-gradient(100deg, #A78BFA 10%, #F0ABFC 55%, #FCD34D 100%)",
        backgroundClip: "text",
        color: "transparent",
      } as any,
      default: { color: "#C4B5FD" },
    }),
  },
  sub: {
    color: "#B9B4CC",
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 26,
    maxWidth: 520,
  },
  capabilityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 30,
  },
  capability: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  capabilityText: {
    color: "#D9D5E8",
    fontSize: 13,
    fontWeight: "600",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 22,
  },
  stat: {
    gap: 3,
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  statLabel: {
    color: "#8C88A1",
    fontSize: 12,
  },
  statDivider: {
    width: 1,
    height: 38,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  unlockCard: {
    flex: 0.85,
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 26,
    backgroundColor: "rgba(20,15,32,0.78)",
    padding: 30,
    overflow: "hidden",
    ...Platform.select({
      web: {
        backdropFilter: "blur(22px)",
        boxShadow: "0 30px 90px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
      } as any,
      default: { elevation: 8 },
    }),
  },
  unlockCardMobile: {
    maxWidth: 560,
  },
  unlockGlow: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -110,
    right: -90,
    opacity: 0.9,
    ...Platform.select({
      web: {
        backgroundImage:
          "radial-gradient(circle, rgba(124,92,255,0.35) 0%, rgba(124,92,255,0) 70%)",
      } as any,
      default: { backgroundColor: "rgba(124,92,255,0.12)" },
    }),
  },
  unlockIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7C5CFF",
    marginBottom: 20,
    ...Platform.select({
      web: { boxShadow: "0 8px 26px rgba(124,92,255,0.55)" },
      default: { elevation: 4 },
    }),
  },
  unlockEyebrow: {
    color: "#A78BFA",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 10,
  },
  unlockTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
    lineHeight: 31,
    marginBottom: 10,
  },
  unlockSub: {
    color: "#9B97B0",
    fontSize: 13.5,
    lineHeight: 21,
    marginBottom: 22,
  },
  unlockInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    color: "#FFFFFF",
    fontSize: 15,
    paddingHorizontal: 16,
  },
  unlockError: {
    color: "#F87171",
    fontSize: 13,
    marginTop: 10,
  },
  unlockButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    marginTop: 14,
    ...Platform.select({
      web: { boxShadow: "0 10px 34px rgba(255,255,255,0.16)" },
      default: { elevation: 3 },
    }),
  },
  unlockButtonDisabled: {
    opacity: 0.45,
  },
  unlockButtonPressed: {
    opacity: 0.85,
  },
  unlockButtonText: {
    color: "#0B0912",
    fontSize: 15,
    fontWeight: "800",
  },
  unlockPrivacy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 18,
  },
  unlockPrivacyText: {
    color: "#8C88A1",
    fontSize: 11.5,
  },
  sectionHead: {
    alignItems: "center",
    marginBottom: 26,
  },
  sectionEyebrow: {
    color: "#A78BFA",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 2.4,
    marginBottom: 10,
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 40,
  },
  featureGridMobile: {
    flexDirection: "column",
  },
  featureCard: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 220,
    borderWidth: 1,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 22,
    ...Platform.select({
      web: { backdropFilter: "blur(12px)" } as any,
      default: {},
    }),
  },
  featureIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  featureTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },
  featureText: {
    color: "#9B97B0",
    fontSize: 13.5,
    lineHeight: 21,
  },
  footer: {
    color: "#5E5A75",
    fontSize: 12,
    textAlign: "center",
    paddingBottom: 12,
  },
  authScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  authCard: {
    width: "100%",
    maxWidth: 440,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 26,
    backgroundColor: "rgba(20,15,32,0.82)",
    padding: 32,
    overflow: "hidden",
    ...Platform.select({
      web: {
        backdropFilter: "blur(22px)",
        boxShadow: "0 30px 90px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
      } as any,
      default: { elevation: 8 },
    }),
  },
  authTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 22,
    marginBottom: 8,
  },
  authSub: {
    color: "#9B97B0",
    fontSize: 13.5,
    lineHeight: 21,
    marginBottom: 22,
  },
  authLabel: {
    color: "#8C88A1",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
    marginBottom: 8,
    marginTop: 14,
  },
  authSwitch: {
    alignItems: "center",
    marginTop: 18,
  },
  authSwitchText: {
    color: "#A78BFA",
    fontSize: 13.5,
    fontWeight: "700",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
  },
});

function readMessageText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(readMessageText).filter(Boolean).join("\n").trim();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "message", "parts", "items", "value"]) {
      if (record[key] !== undefined) {
        const text = readMessageText(record[key]);
        if (text) return text;
      }
    }
  }
  return "";
}

function extractMuseMessages(value: unknown): MuseMessage[] {
  const messages: MuseMessage[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const rawRole = record.role ?? record.sender ?? record.author ?? record.speaker;
    const roleValue =
      rawRole && typeof rawRole === "object"
        ? (rawRole as Record<string, unknown>).role ??
          (rawRole as Record<string, unknown>).name
        : rawRole;
    const roleText = typeof roleValue === "string" ? roleValue.toLowerCase() : "";
    const role: MuseMessage["role"] | null =
      roleText.includes("assistant") || roleText === "ai" || roleText === "model"
        ? "assistant"
        : roleText.includes("user") || roleText === "human"
          ? "user"
          : null;
    const content = readMessageText(
      record.content ?? record.text ?? record.message ?? record.parts ?? record.items,
    );
    if (role && content) {
      const key = `${role}:${content}`;
      if (!seen.has(key)) {
        seen.add(key);
        messages.push({ role, content });
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return messages.slice(-24);
}

function cleanMuseReply(value: string): string {
  return value
    .replace(/```(?:markdown|md|text)?\s*/gi, "")
    .replace(/```/g, "")
    .replace(/<\|[^|]+\|>/g, "")
    .replace(/^\s*(?:assistant|tdluxy|muse)\s*[:：]\s*/gim, "")
    .replace(/^\s*(?:dưới đây là|chắc chắn rồi[,!]?\s*|tất nhiên[,!]?\s*)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLabeledSection(reply: string, labels: string[]): string {
  const acceptedLabels = new Set(labels.map((label) => label.toLocaleUpperCase("vi")));
  const lines = reply.split(/\r?\n/);
  const section: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(
      /^\s*(?:#{1,4}\s*)?(?:\*\*)?([^:：\-]+?)(?:\*\*)?\s*[:：\-]\s*(.*)$/,
    );
    if (heading) {
      const name = heading[1].replace(/\*/g, "").trim().toLocaleUpperCase("vi");
      if (acceptedLabels.has(name)) {
        collecting = true;
        if (heading[2].trim()) section.push(heading[2].trim());
        continue;
      }
      if (collecting && /^(CONCEPT|KỊCH BẢN|PROMPT|CTA|GỢI Ý)\b/.test(name)) {
        break;
      }
    }
    if (collecting) section.push(line);
  }
  return section.join("\n").trim();
}

function extractVideoIdeaSummary(reply: string): { summary: string; prompt: string } {
  const clean = cleanMuseReply(reply);
  const concept = extractLabeledSection(clean, [
    "CONCEPT CHÍNH",
    "CONCEPT ĐƯỢC CHỌN",
    "CONCEPT PHÙ HỢP NHẤT",
    "Ý TƯỞNG CHÍNH",
  ]);
  const script = extractLabeledSection(clean, ["KỊCH BẢN NGẮN", "KỊCH BẢN"]);
  const prompt = extractLabeledSection(clean, ["PROMPT TẠO VIDEO", "PROMPT VIDEO", "VIDEO PROMPT"]);
  if (concept || script || prompt) {
    const summary = [
      concept ? `Ý tưởng chính\n${concept}` : "",
      script ? `Kịch bản\n${script}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      summary: summary || prompt || clean,
      prompt: prompt || concept || clean,
    };
  }

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const main = paragraphs.slice(0, 2).join("\n\n") || clean;
  return { summary: main, prompt: main };
}
type Tool = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  tint: string;
  category: string;
  status?: string;
  mode?: "image" | "video";
  tab?: MuseTab;
  assistantPrompt?: string;
};

const navigation: { label: Screen; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Muse", icon: "chatbubbles-outline" },
  { label: "Khám phá", icon: "compass-outline" },
  { label: "Dự án", icon: "folder-outline" },
  { label: "Lịch sử", icon: "time-outline" },
];

const categories = ["Tất cả", "Hình ảnh", "Video", "Âm thanh", "AI"];

const tools: Tool[] = [
  {
    title: "Sáng tạo hình ảnh",
    description: "Phác thảo concept và prompt hình ảnh cùng TDLUXY",
    icon: "sparkles",
    accent: "#8B7CFF",
    tint: "#1F1A30",
    category: "AI",
    status: "Ý TƯỞNG AI",
    mode: "image",
    tab: "image",
    assistantPrompt:
      "Hãy giúp tôi phát triển một concept hình ảnh độc đáo và viết prompt tạo ảnh thật chi tiết. Trình bày chủ thể, bối cảnh, bố cục, ánh sáng, màu sắc, chất liệu và phong cách; kèm negative prompt nếu phù hợp. Lưu ý: chỉ cần concept/prompt, không khẳng định đã tạo ra tệp ảnh.",
  },
  {
    title: "Chỉnh sửa ảnh",
    description: "Nhận quy trình chỉnh sửa và prompt theo phong cách mong muốn",
    icon: "color-wand-outline",
    accent: "#D85F84",
    tint: "#2B1619",
    category: "Hình ảnh",
    tab: "edit-image",
    assistantPrompt:
      "Hãy tư vấn quy trình chỉnh sửa ảnh phù hợp dựa trên mô tả của tôi. Đưa ra các bước rõ ràng, gợi ý thông số và prompt để dùng trong một công cụ chỉnh ảnh. Không tuyên bố đã trực tiếp sửa tệp ảnh.",
  },
  {
    title: "Ghép ảnh",
    description: "Lên bố cục và câu chuyện cho bộ ảnh của bạn",
    icon: "grid-outline",
    accent: "#31977D",
    tint: "#122419",
    category: "Hình ảnh",
    tab: "collage",
    assistantPrompt:
      "Hãy lên ý tưởng ghép ảnh từ mô tả của tôi: chọn bố cục, thứ tự ảnh, màu sắc, khoảng cách, tỷ lệ khung và chú thích phù hợp. Đưa ra hướng dẫn dễ làm trong trình biên tập ảnh; không tuyên bố đã xuất tệp ghép.",
  },
  {
    title: "Tạo video AI",
    description: "Biến câu lệnh hoặc hình ảnh thành video",
    icon: "videocam-outline",
    accent: "#F2B33D",
    tint: "#2B2214",
    category: "Video",
    status: "TDLUXY VIDEO",
    mode: "video",
    tab: "video",
  },
  {
    title: "Biên tập video",
    description: "Lên nhịp dựng, phụ đề và kế hoạch biên tập video",
    icon: "film-outline",
    accent: "#4B78CB",
    tint: "#1A2030",
    category: "Video",
    tab: "edit-video",
    assistantPrompt:
      "Hãy giúp tôi lập kế hoạch biên tập video theo yêu cầu: chia cảnh theo timeline, đề xuất điểm cắt, nhịp dựng, phụ đề, âm thanh và định dạng xuất. Không khẳng định đã chỉnh sửa hoặc xuất tệp video.",
  },
  {
    title: "Tạo nhạc AI",
    description: "Phát triển concept, lời và brief âm nhạc",
    icon: "musical-notes-outline",
    accent: "#9A5DC3",
    tint: "#1F1A30",
    category: "Âm thanh",
    assistantPrompt:
      "Hãy giúp tôi phát triển concept âm nhạc từ mô tả: thể loại, cảm xúc, nhịp độ, nhạc cụ, cấu trúc và lời nháp nếu được yêu cầu. Nói rõ đây là brief sáng tác, không phải tệp nhạc đã tạo.",
  },
  {
    title: "Lịch đăng video",
    description: "Mở trình duyệt riêng để người dùng tự đăng video",
    icon: "calendar-outline",
    accent: "#D06C4C",
    tint: "#2B2214",
    category: "Video",
    tab: "publish",
  },
];

const videoIndustries = [
  {
    label: "Thời trang",
    prompt:
      "Video campaign thời trang cao cấp, người mẫu tự tin bước qua không gian kiến trúc tối giản, chuyển động vải tự nhiên, ánh sáng editorial mềm, tông màu sang trọng.",
  },
  {
    label: "Đồ ăn",
    prompt:
      "Video quảng cáo món ăn cận cảnh hấp dẫn, hơi nóng và kết cấu chân thực, chuyển động máy quay chậm, ánh sáng ấm như nhà hàng, màu sắc tươi ngon.",
  },
  {
    label: "Khóa học",
    prompt:
      "Video giới thiệu khóa học trực tuyến chuyên nghiệp, giảng viên tự tin trong không gian sáng, xen kẽ hình ảnh minh họa chủ đề, nhịp dựng rõ ràng và truyền cảm hứng.",
  },
  {
    label: "Mỹ phẩm",
    prompt:
      "Video quảng cáo mỹ phẩm tinh tế, cận cảnh bao bì và chất kem, giọt nước trong trẻo, ánh sáng studio dịu, bảng màu sạch và cao cấp.",
  },
  {
    label: "Du lịch",
    prompt:
      "Video du lịch điện ảnh, toàn cảnh điểm đến vào giờ vàng, chuyển động máy quay mượt, cảm giác khám phá tự do, màu sắc chân thực và giàu cảm xúc.",
  },
  {
    label: "Công nghệ",
    prompt:
      "Video ra mắt sản phẩm công nghệ hiện đại, cận cảnh đường nét và vật liệu, nền tối tinh gọn, ánh sáng viền chính xác, máy quay xoay chậm đầy tự tin.",
  },
];

const screens: Screen[] = ["Muse", "Khám phá", "Dự án", "Lịch sử", "Cài đặt"];

export default function App() {
  const { width } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>("Khám phá");
  const [accountReady, setAccountReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<TdluxyUser | null>(null);
  const [accountError, setAccountError] = useState("");
  const [remoteAccess, setRemoteAccess] = useState({
    ready: Platform.OS !== "web",
    required: false,
    authenticated: true,
  });
  const [category, setCategory] = useState("Tất cả");
  const [search, setSearch] = useState("");
  const [museTab, setMuseTab] = useState<MuseTab>("chat");
  const [videoSeed, setVideoSeed] = useState<{ prompt: string; nonce: number } | null>(null);
  const [chatSeed, setChatSeed] = useState<{ prompt: string; nonce: number } | null>(null);
  const [videoPreview, setVideoPreview] = useState<VideoPreview | null>(null);
  const [videoPreviewError, setVideoPreviewError] = useState("");
  const isDesktop = width >= 1024;
  const isMobile = width < 640;
  const columns = width >= 1180 ? 3 : width >= 390 ? 2 : 1;

  useEffect(() => {
    if (!remoteAccess.ready || (remoteAccess.required && !remoteAccess.authenticated)) return;
    let active = true;
    void (async () => {
      try {
        const token = await readAuthToken();
        setApiAccessToken(token);
        if (!token) {
          if (active) setAccountReady(true);
          return;
        }
        const response = await museRequest<{ user: TdluxyUser }>("/api/auth/me");
        if (active) setCurrentUser(response.user);
      } catch (cause) {
        setApiAccessToken(null);
        if (cause instanceof ApiRequestError && cause.status === 401) {
          await writeAuthToken(null);
        } else if (active) {
          setAccountError(
            cause instanceof Error
              ? `Không kiểm tra được phiên đăng nhập: ${cause.message}`
              : "Không kiểm tra được phiên đăng nhập.",
          );
        }
      } finally {
        if (active) setAccountReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [remoteAccess.authenticated, remoteAccess.ready, remoteAccess.required]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let active = true;
    void museRequest<{ required: boolean; authenticated: boolean }>("/api/access/status")
      .then((status) => {
        if (active) setRemoteAccess({ ...status, ready: true });
      })
      .catch(() => {
        if (active) setRemoteAccess({ ready: true, required: false, authenticated: true });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.title = "TDLUXY Studio";
    }
  }, []);

  const visibleTools = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return tools.filter((tool) => {
      const inCategory =
        category === "Tất cả" ||
        tool.category === category ||
        (category === "AI" && tool.title.toLocaleLowerCase("vi").includes("ai"));
      const inSearch =
        !query ||
        tool.title.toLocaleLowerCase("vi").includes(query) ||
        tool.description.toLocaleLowerCase("vi").includes(query);
      return inCategory && inSearch;
    });
  }, [category, search]);

  const openTool = (tool: Tool) => {
    if (tool.mode === "video") {
      setMuseTab("video");
      setScreen("Muse");
      return;
    }
    setMuseTab(tool.tab ?? "chat");
    setChatSeed({
      prompt: tool.assistantPrompt ?? `Hãy hỗ trợ tôi với công cụ "${tool.title}".`,
      nonce: Date.now(),
    });
    setScreen("Muse");
  };

  const openCreator = (mode: "image" | "video") => {
    if (mode === "video") {
      setMuseTab("video");
      setScreen("Muse");
      return;
    }
    const tool = tools.find((item) => item.mode === mode);
    if (tool) openTool(tool);
  };

  const navigateTo = (target: Screen) => {
    if (target === "Quản trị" && currentUser?.role !== "admin") return;
    if (target === "Muse") setMuseTab("chat");
    setScreen(target);
  };

  const acceptAccount = async (token: string, user: TdluxyUser) => {
    await writeAuthToken(token);
    setApiAccessToken(token);
    setAccountError("");
    setCurrentUser(user);
  };

  const logout = async () => {
    try {
      await museRequest("/api/auth/logout", { method: "POST" });
    } finally {
      setApiAccessToken(null);
      await writeAuthToken(null);
      setCurrentUser(null);
      setScreen("Khám phá");
    }
  };

  const openJobVideo = async (
    jobId: string,
    index: number,
    name: string,
    jobPrompt: string,
  ) => {
    setVideoPreviewError("");
    try {
      const access = await museRequest<{ url: string }>(
        `/api/muse/jobs/${jobId}/files/${index}/access`,
      );
      setVideoPreview({
        uri: `${MUSE_API_URL}${access.url}`,
        name,
        prompt: jobPrompt,
      });
    } catch (cause) {
      setVideoPreviewError(
        cause instanceof Error ? cause.message : "Không mở được video này.",
      );
    }
  };

  const createVariant = (seed: string) => {
    setVideoPreview(null);
    setVideoPreviewError("");
    setVideoSeed({ prompt: seed, nonce: Date.now() });
    setMuseTab("video");
    setScreen("Muse");
  };

  if (!remoteAccess.ready) {
    return (
      <SafeAreaView style={landingStyles.root}>
        <LandingOrbs />
        <View style={landingStyles.loadingWrap}>
          <View style={landingStyles.brandMark}>
            <Ionicons name="sparkles" size={18} color="#FFFFFF" />
          </View>
          <ActivityIndicator size="large" color="#A78BFA" />
        </View>
      </SafeAreaView>
    );
  }
  if (remoteAccess.required && !remoteAccess.authenticated) {
    return (
      <RemoteAccessGate
        onAuthenticated={() =>
          setRemoteAccess((current) => ({ ...current, authenticated: true }))
        }
      />
    );
  }
  if (!accountReady) {
    return (
      <SafeAreaView style={landingStyles.root}>
        <LandingOrbs />
        <View style={landingStyles.loadingWrap}>
          <View style={landingStyles.brandMark}>
            <Ionicons name="sparkles" size={18} color="#FFFFFF" />
          </View>
          <ActivityIndicator size="large" color="#A78BFA" />
        </View>
      </SafeAreaView>
    );
  }
  if (!currentUser) {
    return <AccountGate onAuthenticated={acceptAccount} initialError={accountError} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={[styles.app, !isDesktop && styles.appMobile]}>
        {isDesktop ? (
          <View style={styles.sidebar}>
            <Brand />
            <Text style={styles.sidebarSection}>KHÔNG GIAN LÀM VIỆC</Text>
            <View style={styles.sidebarNavigation}>
              {navigation.map((item) => (
                <NavigationItem
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  active={screen === item.label}
                  onPress={() => navigateTo(item.label)}
                />
              ))}
            </View>
            <View style={styles.sidebarDivider} />
            <NavigationItem
              icon="settings-outline"
              label="Cài đặt"
              active={screen === "Cài đặt"}
              onPress={() => navigateTo("Cài đặt")}
            />
            {currentUser.role === "admin" ? (
              <>
                <View style={styles.sidebarDivider} />
                <Text style={styles.sidebarSection}>QUẢN TRỊ KHÔNG GIAN</Text>
                <NavigationItem
                  icon="shield-checkmark-outline"
                  label="Bảng điều hành"
                  active={screen === "Quản trị"}
                  onPress={() => navigateTo("Quản trị")}
                />
              </>
            ) : null}
            <View style={styles.sidebarBottom}>
              <View style={styles.sidePlanCard}>
                <View style={styles.planIcon}>
                  <Ionicons name="sparkles" size={16} color="#A78BFA" />
                </View>
                <Text style={styles.planTitle}>TDLUXY Studio</Text>
                <Text style={styles.planBody}>
                  Hạn mức phụ thuộc vào tài khoản dịch vụ bạn kết nối.
                </Text>
                <View style={styles.planStatus}>
                  <View style={styles.statusDot} />
                  <Text style={styles.planStatusText}>Bản thử nghiệm</Text>
                </View>
              </View>
              <Text style={styles.version}>TDLUXY STUDIO · PHIÊN BẢN 1.2</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.main}>
          {!isDesktop ? (
            <View style={styles.mobileHeader}>
              <Brand />
              <View style={styles.mobileHeaderActions}>
                <View style={styles.mobileStudioBadge}>
                  <Ionicons name="sparkles" size={12} color="#7C5CFF" />
                  <Text style={styles.mobileStudioBadgeText}>AI STUDIO</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mở cài đặt"
                  onPress={() => navigateTo("Cài đặt")}
                  style={styles.headerIconButton}
                >
                  <Ionicons name="settings-outline" size={19} color="#38364B" />
                </Pressable>
              </View>
            </View>
          ) : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.content,
              isDesktop && styles.contentDesktop,
              isMobile && styles.contentMobile,
            ]}
            showsVerticalScrollIndicator={false}
          >
            {isDesktop ? (
              <View style={styles.topbar}>
                <View>
                  <Text style={styles.topbarEyebrow}>STUDIO SÁNG TẠO</Text>
                  <Text style={styles.topbarTitle}>{screen === "Muse" ? "TDLUXY" : screen}</Text>
                </View>
                <View style={styles.topbarRight}>
                  <View style={styles.topbarStatus}>
                    <View style={styles.statusDot} />
                    <Text style={styles.topbarStatusText}>Không gian cá nhân</Text>
                  </View>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>ST</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {screen === "Muse" ? (
              <MuseScreen
                activeTab={museTab}
                onTabChange={setMuseTab}
                isAdmin={currentUser.role === "admin"}
                initialVideoPrompt={videoSeed}
                onVideoPromptApplied={() => setVideoSeed(null)}
                initialChatPrompt={chatSeed}
                onChatPromptApplied={() => setChatSeed(null)}
                onOpenVideo={openJobVideo}
              />
            ) : screen === "Khám phá" ? (
              <ExploreScreen
                isMobile={isMobile}
                columns={columns}
                category={category}
                search={search}
                visibleTools={visibleTools}
                onCategoryChange={setCategory}
                onSearchChange={setSearch}
                onOpenTool={openTool}
                onOpenCreator={openCreator}
              />
            ) : screen === "Cài đặt" ? (
              <SettingsScreen
                onOpenMuse={() => navigateTo("Muse")}
                onOpenAdmin={() => navigateTo("Quản trị")}
                onLogout={() => void logout()}
                email={currentUser.email}
                isAdmin={currentUser.role === "admin"}
              />
            ) : screen === "Quản trị" && currentUser.role === "admin" ? (
              <AdminScreen
                isMobile={isMobile}
                onOpenSettings={() => navigateTo("Cài đặt")}
              />
            ) : screen === "Dự án" || screen === "Lịch sử" ? (
              <VideoLibraryScreen
                screen={screen}
                isMobile={isMobile}
                onCreateVariant={createVariant}
                onOpenVideo={openJobVideo}
              />
            ) : (
              <EmptyScreen screen={screen} onExplore={() => navigateTo("Khám phá")} />
            )}
          </ScrollView>
        </View>

        {!isDesktop ? (
          <View style={styles.bottomBar}>
            {screens.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: screen === item }}
                onPress={() => navigateTo(item)}
                style={({ pressed }) => [
                  styles.bottomItem,
                  pressed && styles.bottomItemPressed,
                ]}
              >
                <View
                  style={[
                    styles.bottomIconWrap,
                    screen === item && styles.bottomIconWrapActive,
                  ]}
                >
                  <Ionicons
                    name={navigation.find((nav) => nav.label === item)?.icon ?? "settings-outline"}
                    size={21}
                    color={screen === item ? "#A78BFA" : "#858392"}
                  />
                </View>
                <Text
                  style={[
                    styles.bottomLabel,
                    screen === item && styles.bottomLabelActive,
                  ]}
                >
                  {item === "Muse" ? "TDLUXY" : item}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <VideoViewerModal
        video={videoPreview}
        error={videoPreviewError}
        onClose={() => {
          setVideoPreview(null);
          setVideoPreviewError("");
        }}
        onCreateVariant={createVariant}
      />
    </SafeAreaView>
  );
}

type ExploreProps = {
  isMobile: boolean;
  columns: number;
  category: string;
  search: string;
  visibleTools: Tool[];
  onCategoryChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onOpenTool: (tool: Tool) => void;
  onOpenCreator: (mode: "image" | "video") => void;
};

function ExploreScreen({
  isMobile,
  columns,
  category,
  search,
  visibleTools,
  onCategoryChange,
  onSearchChange,
  onOpenTool,
  onOpenCreator,
}: ExploreProps) {
  return (
    <>
      <View style={[styles.hero, isMobile && styles.heroMobile]}>
        <View style={styles.heroGlowOne} />
        <View style={styles.heroGlowTwo} />
        <View style={[styles.heroCopy, isMobile && styles.heroCopyMobile]}>
          <View style={[styles.heroPill, isMobile && styles.heroPillMobile]}>
            <Ionicons name="sparkles" size={12} color="#D8C7FF" />
            <Text style={[styles.heroPillText, isMobile && styles.heroPillTextMobile]}>
              TDLUXY CREATIVE SUITE
            </Text>
          </View>
          <Text style={[styles.heroTitle, isMobile && styles.heroTitleMobile]}>
            Ý tưởng của bạn,{"\n"}
            <Text style={styles.heroTitleAccent}>bắt đầu từ đây.</Text>
          </Text>
          <Text style={[styles.heroDescription, isMobile && styles.heroDescriptionMobile]}>
            Từ ý tưởng đầu tiên đến nội dung sẵn sàng chia sẻ — mọi công cụ sáng tạo trong một studio.
          </Text>
          <View style={styles.heroActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenCreator("image")}
              style={({ pressed }) => [
                styles.primaryButton,
                isMobile && styles.primaryButtonMobile,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="sparkles" size={15} color="#34274F" />
              <Text style={[styles.primaryButtonText, isMobile && styles.primaryButtonTextMobile]}>
                Tạo hình ảnh
              </Text>
              <Ionicons name="arrow-forward" size={14} color="#514276" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenCreator("video")}
              style={({ pressed }) => [
                styles.secondaryButton,
                isMobile && styles.secondaryButtonMobile,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="play" size={13} color="#FFFFFF" />
              <Text style={[styles.secondaryButtonText, isMobile && styles.secondaryButtonTextMobile]}>
                Tạo video
              </Text>
            </Pressable>
          </View>
          {isMobile ? (
            <View style={styles.heroProofRow}>
              <View style={styles.heroProofIcons}>
                <View style={[styles.heroProofIcon, styles.heroProofIconImage]}>
                  <Ionicons name="image-outline" size={13} color="#D8CCFF" />
                </View>
                <View style={[styles.heroProofIcon, styles.heroProofIconVideo]}>
                  <Ionicons name="videocam-outline" size={13} color="#FFD9AE" />
                </View>
                <View style={[styles.heroProofIcon, styles.heroProofIconSparkle]}>
                  <Ionicons name="sparkles" size={12} color="#B7F0D8" />
                </View>
              </View>
              <Text style={styles.heroProofText}>SÁNG TẠO · TINH CHỈNH · CHIA SẺ</Text>
            </View>
          ) : null}
        </View>
        {!isMobile ? <HeroArtwork /> : null}
        {!isMobile ? (
          <View style={styles.heroIndex}>
            <Text style={styles.heroIndexNumber}>01</Text>
            <View style={styles.heroIndexLine} />
            <Text style={styles.heroIndexLabel}>CREATIVE STUDIO</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.welcomeRow, isMobile && styles.welcomeRowMobile]}>
        <View>
          <Text style={styles.sectionEyebrow}>BẮT ĐẦU SÁNG TẠO</Text>
          <Text style={[styles.sectionHeading, isMobile && styles.sectionHeadingMobile]}>
            Sáng tạo không giới hạn
          </Text>
          <Text style={[styles.sectionSubheading, isMobile && styles.sectionSubheadingMobile]}>
            Chọn công cụ phù hợp với điều bạn muốn tạo.
          </Text>
        </View>
        {!isMobile ? <Text style={styles.toolCount}>07 CÔNG CỤ</Text> : null}
      </View>

      <View style={[styles.quickGrid, isMobile && styles.quickGridMobile]}>
        <QuickStart
          icon="image-outline"
          title="Tạo ảnh AI"
          subtitle="Biến mô tả thành hình ảnh"
          color="#A78BFA"
          tint="#1F1A30"
          onPress={() => onOpenCreator("image")}
          isMobile={isMobile}
        />
        <QuickStart
          icon="videocam-outline"
          title="Tạo video AI"
          subtitle="Thổi chuyển động vào ý tưởng"
          color="#F2B33D"
          tint="#2B2214"
          onPress={() => onOpenCreator("video")}
          isMobile={isMobile}
        />
        {!isMobile ? (
          <QuickStart
            icon="grid-outline"
            title="Khám phá bộ công cụ"
            subtitle="Ảnh, âm thanh và hơn thế"
            color="#34D399"
            tint="#122419"
            onPress={() => onCategoryChange("Tất cả")}
          />
        ) : null}
      </View>

      <View style={styles.toolSection}>
        <View style={[styles.toolSectionHeader, isMobile && styles.toolSectionHeaderMobile]}>
          <View>
            <Text style={styles.sectionEyebrow}>BỘ CÔNG CỤ</Text>
            <Text style={[styles.sectionHeading, isMobile && styles.sectionHeadingMobile]}>
              Không gian sáng tạo
            </Text>
          </View>
          <View style={[styles.searchBox, isMobile && styles.searchBoxMobile]}>
            <Ionicons name="search-outline" size={17} color="#8C88A1" />
            <TextInput
              accessibilityLabel="Tìm công cụ"
              value={search}
              onChangeText={onSearchChange}
              placeholder="Tìm công cụ"
              placeholderTextColor="#9894AE"
              style={[styles.searchInput, isMobile && styles.searchInputMobile]}
              returnKeyType="search"
            />
            {search ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Xóa tìm kiếm"
                onPress={() => onSearchChange("")}
              >
                <Ionicons name="close-circle" size={17} color="#9694A3" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
        >
          {categories.map((item) => {
            const active = item === category;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onCategoryChange(item)}
                style={[
                  styles.categoryChip,
                  isMobile && styles.categoryChipMobile,
                  active && styles.categoryChipActive,
                ]}
              >
                <Text style={[
                  styles.categoryText,
                  isMobile && styles.categoryTextMobile,
                  active && styles.categoryTextActive,
                ]}>
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.toolGrid}>
          {visibleTools.length ? (
            visibleTools.map((tool) => (
              <ToolCard
                key={tool.title}
                tool={tool}
                columns={columns}
                isMobile={isMobile}
                onPress={() => onOpenTool(tool)}
              />
            ))
          ) : (
            <View style={styles.noResults}>
              <Ionicons name="search-outline" size={24} color="#9997A7" />
              <Text style={styles.noResultsTitle}>Không tìm thấy công cụ phù hợp</Text>
              <Text style={styles.noResultsText}>Thử từ khóa hoặc danh mục khác.</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Ionicons name="sparkles" size={13} color="#856DEB" />
        <Text style={styles.footerText}>
          Cùng một không gian sáng tạo trên mọi thiết bị.
        </Text>
      </View>
    </>
  );
}

function HeroArtwork() {
  return (
    <View style={styles.heroArtwork} pointerEvents="none">
      <View style={styles.artCircleOuter} />
      <View style={styles.artCircleMiddle} />
      <View style={styles.artCircleInner} />
      <View style={styles.artSparkle}>
        <Ionicons name="sparkles" size={35} color="#A78BFA" />
      </View>
      <View style={[styles.artBadge, styles.artBadgeImage]}>
        <Ionicons name="image-outline" size={18} color="#EB7194" />
      </View>
      <View style={[styles.artBadge, styles.artBadgeVideo]}>
        <Ionicons name="play" size={16} color="#DA9740" />
      </View>
      <View style={[styles.artBadge, styles.artBadgeAudio]}>
        <Ionicons name="musical-note" size={17} color="#A96AD1" />
      </View>
      <View style={styles.artStar}>
        <Ionicons name="star" size={10} color="#E8C676" />
      </View>
    </View>
  );
}

function QuickStart({
  icon,
  title,
  subtitle,
  color,
  tint,
  onPress,
  isMobile = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  color: string;
  tint: string;
  onPress: () => void;
  isMobile?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickCard,
        icon === "image-outline" && styles.quickImageCard,
        icon === "videocam-outline" && styles.quickVideoCard,
        icon === "grid-outline" && styles.quickExploreCard,
        isMobile && styles.quickCardMobile,
        pressed && styles.cardPressed,
      ]}
    >
      <View
        style={[
          styles.quickIcon,
          { backgroundColor: icon === "image-outline" ? "rgba(255,255,255,0.16)" : tint },
        ]}
      >
        <Ionicons
          name={icon}
          size={20}
          color={icon === "image-outline" ? "#FFFFFF" : color}
        />
      </View>
      <View style={styles.quickCopy}>
        <Text
          style={[
            styles.quickTitle,
            icon === "image-outline" && styles.quickImageTitle,
            isMobile && styles.quickCardMobileTitle,
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.quickSubtitle,
            icon === "image-outline" && styles.quickImageSubtitle,
            isMobile && styles.quickCardMobileSubtitle,
          ]}
        >
          {subtitle}
        </Text>
      </View>
      <View style={[styles.quickArrow, isMobile && styles.quickArrowMobile]}>
        <Ionicons
          name="arrow-forward"
          size={14}
          color={icon === "image-outline" ? "#A78BFA" : color}
        />
      </View>
    </Pressable>
  );
}

function ToolCard({
  tool,
  columns,
  isMobile,
  onPress,
}: {
  tool: Tool;
  columns: number;
  isMobile: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tool.title}. ${tool.description}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolCard,
        { backgroundColor: tool.tint, borderTopColor: tool.accent },
        isMobile && styles.toolCardMobile,
        columns === 2 && styles.toolCardHalf,
        columns === 3 && styles.toolCardThird,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={[styles.toolIcon, isMobile && styles.toolIconMobile, { backgroundColor: tool.tint }]}>
        <Ionicons name={tool.icon} size={22} color={tool.accent} />
      </View>
      <View style={[styles.toolCopy, isMobile && styles.toolCopyMobile]}>
        <View style={styles.toolTitleLine}>
          <Text style={[styles.toolTitle, isMobile && styles.toolTitleMobile]}>
            {tool.title}
          </Text>
          {tool.status ? (
            <Text
              style={[
                styles.toolStatus,
                tool.status === "ĐANG PHÁT TRIỂN" && styles.toolStatusSoon,
              ]}
            >
              {tool.status}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.toolDescription, isMobile && styles.toolDescriptionMobile]}>
          {tool.description}
        </Text>
      </View>
      <View style={[styles.toolArrow, isMobile && styles.toolArrowMobile]}>
        <Ionicons name="arrow-forward" size={15} color="#8F8D9B" />
      </View>
    </Pressable>
  );
}

function MuseScreen({
  activeTab,
  onTabChange,
  isAdmin,
  initialVideoPrompt,
  onVideoPromptApplied,
  initialChatPrompt,
  onChatPromptApplied,
  onOpenVideo,
}: {
  activeTab: MuseTab;
  onTabChange: (tab: MuseTab) => void;
  isAdmin: boolean;
  initialVideoPrompt: { prompt: string; nonce: number } | null;
  onVideoPromptApplied: () => void;
  initialChatPrompt: { prompt: string; nonce: number } | null;
  onChatPromptApplied: () => void;
  onOpenVideo: (jobId: string, index: number, name: string, prompt: string) => void;
}) {
  const [bridge, setBridge] = useState<"checking" | "online" | "offline">("checking");
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [pendingMuseAccountId, setPendingMuseAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MuseMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [images, setImages] = useState<MuseImage[]>([]);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoIndustry, setVideoIndustry] = useState(videoIndustries[0].label);
  const [videoIdeaGoal, setVideoIdeaGoal] = useState("");
  const [videoIdeaAudience, setVideoIdeaAudience] = useState("");
  const [studioBrief, setStudioBrief] = useState("");
  const [studioResult, setStudioResult] = useState("");
  const [studioResultTab, setStudioResultTab] = useState<MuseTab | null>(null);
  const [studioImageResult, setStudioImageResult] = useState("");
  const [studioImageResultTab, setStudioImageResultTab] = useState<MuseTab | null>(null);
  const [museMediaOutputs, setMuseMediaOutputs] = useState<MuseMediaOutput[]>([]);
  const [museMediaErrors, setMuseMediaErrors] = useState<string[]>([]);
  const [imagePreset, setImagePreset] = useState<"clean" | "warm" | "mono">("clean");
  const [jobStatus, setJobStatus] = useState("");
  const [videoStartedAt, setVideoStartedAt] = useState<number | null>(null);
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const videoPoll = useRef<AbortController | null>(null);
  const videoMounted = useRef(true);
  useEffect(() => {
    videoMounted.current = true;
    return () => { videoMounted.current = false; videoPoll.current?.abort(); };
  }, []);

  const [videos, setVideos] = useState<{ jobId: string; index: number; name: string }[]>([]);

  const checkBridge = async () => {
    setBridge("checking");
    setError("");
    try {
      await museRequest<{ ok: boolean }>("/api/health");
      setBridge("online");
      try {
        const status = await museRequest<{
          authenticated: boolean;
          connected: boolean;
        }>("/api/muse/status");
        setAuthenticated(status.authenticated && status.connected);
      } catch (cause) {
        setAuthenticated(false);
        setError(
          cause instanceof Error
            ? `Phiên Muse chưa kết nối được: ${cause.message} Bạn có thể đăng nhập lại bằng OTP.`
            : "Phiên Muse chưa kết nối được. Bạn có thể đăng nhập lại bằng OTP.",
        );
      }
    } catch (cause) {
      setBridge("offline");
      setAuthenticated(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "Không thể kết nối backend Muse.",
      );
    }
  };

  useEffect(() => {
    void checkBridge();
  }, []);

  useEffect(() => {
    if (initialVideoPrompt) {
      setVideoPrompt(initialVideoPrompt.prompt);
      onVideoPromptApplied();
    }
  }, [initialVideoPrompt?.nonce]);

  useEffect(() => {
    if (initialChatPrompt && activeTab === "chat") {
      setDraft(initialChatPrompt.prompt);
      setNotice("Yêu cầu đã sẵn sàng. Bạn có thể chỉnh sửa rồi gửi cho TDLUXY.");
      onChatPromptApplied();
    }
  }, [initialChatPrompt?.nonce, activeTab]);

  const requestOtp = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await museRequest<{ message: string; account_id: string }>(
        "/api/muse/auth/otp",
        {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
        },
      );
      setOtpSent(true);
      setPendingMuseAccountId(result.account_id);
      setNotice(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được mã xác minh.");
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!pendingMuseAccountId) {
        throw new Error("Phiên xác minh đã hết hạn. Hãy gửi lại mã OTP.");
      }
      await museRequest<{ authenticated: boolean }>("/api/muse/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          account_id: pendingMuseAccountId,
          code: code.trim(),
        }),
      });
      setAuthenticated(true);
      setBridge("online");
      setCode("");
      setPendingMuseAccountId(null);
      await checkBridge();
      setNotice("TDLUXY Studio đã kết nối với tài khoản Muse.ai của bạn.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xác minh được mã.");
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async () => {
    setBusy(true);
    setError("");
    try {
      const query = sessionId
        ? `?session_id=${encodeURIComponent(sessionId)}`
        : "";
      const result = await museRequest<{
        history: unknown;
        session_id: string | null;
        media?: unknown;
        media_errors?: string[];
      }>(
        `/api/muse/history${query}`,
      );
      const transcript = extractMuseMessages(result.history);
      setMuseMediaOutputs(readMuseMedia(result.media));
      setMuseMediaErrors(result.media_errors ?? []);
      if (!transcript.length) {
        setMessages([]);
        setNotice("Đã kiểm tra Muse; chưa tìm thấy tin nhắn trong phiên này.");
      } else {
        setMessages(transcript);
        setNotice("Đã làm mới cuộc trò chuyện.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được lịch sử chat.");
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setMuseMediaOutputs([]);
    setMuseMediaErrors([]);
    setDraft("");
    const pendingMessage: MuseMessage = { role: "user", content: text };
    setMessages((current) => [...current, pendingMessage]);
    try {
      const result = await museRequest<{
        session_id: string | null;
        events: unknown;
        history: unknown;
        media?: unknown;
        media_errors?: string[];
      }>("/api/muse/chat", {
        method: "POST",
        body: JSON.stringify({ prompt: text, session_id: sessionId }),
      });
      if (result.session_id) setSessionId(result.session_id);
      const transcript = extractMuseMessages(result.history);
      setMuseMediaOutputs(readMuseMedia(result.media));
      setMuseMediaErrors(result.media_errors ?? []);
      if (transcript.length) {
        setMessages(transcript);
      } else {
        setNotice(
          "Muse đã nhận tin nhắn. Phản hồi chưa xuất hiện trong lịch sử; bạn có thể làm mới sau.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được tin nhắn.");
      setMessages((current) => current.filter((message) => message !== pendingMessage));
      setDraft(text);
    } finally {
      setBusy(false);
    }
  };

  const askForContentIdea = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setStudioResult("");
    setMuseMediaOutputs([]);
    setMuseMediaErrors([]);
    setJobStatus("TDLUXY đang phác thảo concept nội dung…");
    const promptText = [
      `Hãy đề xuất 3 concept video ngắn cho ngành ${videoIndustry}.`,
      `Mục tiêu: ${videoIdeaGoal.trim() || "tăng nhận diện và thu hút khách hàng"}.`,
      `Đối tượng: ${videoIdeaAudience.trim() || "khách hàng tiềm năng trên mạng xã hội"}.`,
      "Trả lời ngắn gọn theo đúng mẫu, không chào hỏi, không giải thích ngoài mẫu:",
      "CONCEPT CHÍNH: chọn 1 concept tốt nhất, tối đa 2 câu, có hook và CTA.",
      "KỊCH BẢN NGẮN: 3 cảnh, mỗi cảnh 1 dòng, có mốc thời gian.",
      "PROMPT TẠO VIDEO: một đoạn mô tả hình ảnh liền mạch có thể gửi thẳng vào trình tạo video; không đưa lời giải thích vào đoạn này.",
    ].join("\n");
    try {
      const result = await museRequest<{
        session_id: string | null;
        events: unknown;
        history: unknown;
        media?: unknown;
        media_errors?: string[];
      }>("/api/muse/chat", {
        method: "POST",
        body: JSON.stringify({ prompt: promptText, session_id: sessionId }),
      });
      if (result.session_id) setSessionId(result.session_id);
      const transcript = extractMuseMessages(result.history);
      setMuseMediaOutputs(readMuseMedia(result.media));
      setMuseMediaErrors(result.media_errors ?? []);
      if (transcript.length) setMessages(transcript);
      const reply =
        [...transcript].reverse().find((message) => message.role === "assistant")?.content ||
        readMessageText(result.events);
      if (reply) {
        const idea = extractVideoIdeaSummary(reply);
        setStudioResult(idea.summary);
        setStudioResultTab("video");
        setVideoPrompt(idea.prompt);
        setNotice("Đã lọc concept chính và prompt video. Bạn có thể chỉnh sửa prompt trước khi tạo.");
        setJobStatus("");
      } else {
        setJobStatus("");
        setNotice("TDLUXY đã nhận brief; chưa lấy được nội dung phản hồi. Hãy mở tab Trò chuyện để kiểm tra.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lấy được gợi ý nội dung.");
      setJobStatus("");
    } finally {
      setBusy(false);
    }
  };

  const runStudioTask = async () => {
    const brief = studioBrief.trim();
    if (!brief || busy) return;
    const instructions: Record<"image" | "edit-image" | "collage" | "edit-video", string> = {
      image:
        "Tạo một concept hình ảnh và prompt tạo ảnh hoàn chỉnh theo yêu cầu. Trả lời bằng tiếng Việt, súc tích, theo đúng mẫu: CONCEPT: một câu; PROMPT TẠO ẢNH: một prompt giàu chi tiết về chủ thể, bố cục, bối cảnh, ánh sáng, màu sắc, chất liệu và phong cách; TỶ LỆ GỢI Ý: tỷ lệ phù hợp. Không chào hỏi, không thêm giải thích. Chỉ tạo nội dung prompt, không tuyên bố đã xuất tệp ảnh.",
      "edit-image":
        "Đề xuất quy trình chỉnh sửa ảnh theo mục tiêu của người dùng: các bước, thông số gợi ý và prompt cho công cụ chỉnh ảnh. Không khẳng định đã trực tiếp xử lý tệp ảnh.",
      collage:
        "Thiết kế phương án ghép ảnh: kể câu chuyện, thứ tự ảnh, bố cục, tỷ lệ, màu sắc, khoảng cách và chú thích. Trả lời thành hướng dẫn cụ thể, không khẳng định đã xuất ảnh.",
      "edit-video":
        "Lập kế hoạch biên tập video: chia timeline/cảnh, điểm cắt, nhịp dựng, phụ đề, âm thanh và thiết lập xuất phù hợp. Không khẳng định đã trực tiếp sửa hoặc xuất tệp.",
    };
    if (activeTab === "chat" || activeTab === "video" || activeTab === "publish") return;
    setBusy(true);
    setError("");
    setNotice("");
    setStudioResult("");
    setStudioImageResult("");
    setMuseMediaOutputs([]);
    setMuseMediaErrors([]);
    try {
      if (activeTab === "edit-image" || activeTab === "collage") {
        const minimum = activeTab === "collage" ? 2 : 1;
        if (images.length < minimum) {
          throw new Error(
            activeTab === "collage"
              ? "Chọn ít nhất 2 ảnh để tạo ảnh ghép."
              : "Chọn một ảnh trước khi chỉnh sửa.",
          );
        }
        const path =
          activeTab === "collage"
            ? "/api/media/images/collage"
            : "/api/media/images/edit";
        const body =
          activeTab === "collage"
            ? { images: images.map(({ name, base64 }) => ({ name, base64 })) }
            : {
                image: {
                  name: images[0].name,
                  base64: images[0].base64,
                },
                preset: imagePreset,
              };
        const result = await museRequest<{
          image_base64: string;
          media_type: string;
          filename: string;
        }>(path, { method: "POST", body: JSON.stringify(body) });
        setStudioImageResult(`data:${result.media_type};base64,${result.image_base64}`);
        setStudioImageResultTab(activeTab);
        setStudioResult(
          activeTab === "collage"
            ? `Đã ghép ${images.length} ảnh thành ${result.filename} (1080 × 1350).`
            : `Đã áp dụng preset ${imagePreset} và xuất ${result.filename}.`,
        );
        setStudioResultTab(activeTab);
        return;
      }
      const result = await museRequest<{
        session_id: string | null;
        events: unknown;
        history: unknown;
        media?: unknown;
        media_errors?: string[];
      }>("/api/muse/chat", {
        method: "POST",
        body: JSON.stringify({
          prompt: `${instructions[activeTab]}\n\nBrief của tôi:\n${brief}`,
          session_id: sessionId,
        }),
      });
      if (result.session_id) setSessionId(result.session_id);
      const transcript = extractMuseMessages(result.history);
      setMuseMediaOutputs(readMuseMedia(result.media));
      setMuseMediaErrors(result.media_errors ?? []);
      if (transcript.length) setMessages(transcript);
      const reply =
        [...transcript].reverse().find((message) => message.role === "assistant")?.content ||
        readMessageText(result.events);
      const mainReply = cleanMuseReply(reply);
      setStudioResultTab(activeTab);
      if (!mainReply) {
        throw new Error("TDLUXY đã nhận yêu cầu nhưng chưa trả về nội dung để hiển thị.");
      }
      setStudioResult(mainReply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không hoàn tất được yêu cầu.");
    } finally {
      setBusy(false);
    }
  };

  const chooseImages = async () => {
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Hãy cho phép truy cập thư viện ảnh để chọn ảnh tham chiếu.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 4,
      base64: true,
      quality: 0.82,
    });
    if (result.canceled) return;
    const chosen: MuseImage[] = [];
    for (const [index, asset] of result.assets.entries()) {
      if (!asset.base64) {
        setError("Không đọc được dữ liệu ảnh đã chọn. Hãy thử ảnh khác.");
        return;
      }
      chosen.push({
        name: asset.fileName || `anh-tham-chieu-${index + 1}.jpg`,
        base64: asset.base64,
        uri: asset.uri,
      });
    }
    setImages(chosen.slice(0, 4));
  };

  const saveCurrentImage = async () => {
    if (!studioImageResult) return;
    try {
      await saveImageResult(
        studioImageResult,
        activeTab === "collage" ? "tdluxy-collage.jpg" : "tdluxy-edited.jpg",
      );
      setNotice("Đã lưu ảnh kết quả.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được ảnh.");
    }
  };

  const saveMuseImage = async (image: MuseMediaOutput) => {
    try {
      if (Platform.OS === "web") {
        const response = await fetch(image.fullUri);
        if (!response.ok) {
          throw new Error("Không tải được ảnh chất lượng đầy đủ từ Muse.");
        }
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = image.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } else {
        if (!FileSystem.cacheDirectory) {
          throw new Error("Thiết bị không có thư mục lưu ảnh tạm.");
        }
        const safeName = image.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const localUri = `${FileSystem.cacheDirectory}${safeName}`;
        const downloaded = await FileSystem.downloadAsync(image.fullUri, localUri);
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error("Thiết bị chưa hỗ trợ lưu/chia sẻ tệp ảnh.");
        }
        await Sharing.shareAsync(downloaded.uri, { mimeType: image.mediaType });
      }
      setNotice(`Đã lưu ${image.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được ảnh từ Muse.");
    }
  };

  const createVideo = async () => {
    const promptText = videoPrompt.trim();
    if (!promptText || busy || videoStartedAt !== null) return;
    videoPoll.current = new AbortController();
    const signal = videoPoll.current.signal;
    setError("");
    setNotice("");
    setVideos([]);
    setVideoStartedAt(Date.now());
    setVideoSubmitting(true);
    setJobStatus("Đang gửi prompt vào chat Muse và khởi chạy tạo video…");
    try {
      const created = await submitVideo({
          prompt: promptText,
          session_id: sessionId,
          timeout_seconds: 600,
          images: images.map(({ name, base64 }) => ({ name, base64 })),
      });
      if (!videoMounted.current) return;
      setVideoSubmitting(false);
      setNotice("Video tiếp tục xử lý trên máy chủ. Bạn có thể mở Lịch sử hoặc dùng công cụ khác.");
      setJobStatus("Tác vụ đã được nhận. Đang chờ trạng thái xử lý từ Muse…");
      let finished = false;
      for (let attempt = 0; attempt < 270; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (signal.aborted || !videoMounted.current) return;
        const job = await museRequest<{
          status: "queued" | "running" | "completed" | "failed";
          phase: string;
          error: string | null;
          session_id: string | null;
          videos: { name: string; url: string }[];
        }>(`/api/muse/jobs/${created.job_id}`, { signal });
        if (signal.aborted || !videoMounted.current) return;
        if (job.status === "completed") {
          await created.finish();
          setVideos(
            job.videos.map((video, index) => ({
              jobId: created.job_id,
              index,
              name: video.name,
            })),
          );
          setJobStatus("Video đã sẵn sàng. Mở kết quả để xem hoặc tải xuống.");
          finished = true;
          break;
        }
        if (job.status === "failed") {
          if (job.phase === "cancelled") await created.finish();
          throw new Error(job.error || "Muse không tạo được video.");
        }
        setJobStatus(
          job.status === "queued"
            ? "Yêu cầu đang ở hàng đợi xử lý…"
            : "TDLUXY đang xử lý video cùng Muse và chờ tệp kết quả…",
        );
      }
      if (!finished) {
        throw new Error(
          "Đã chờ hơn 11 phút nhưng chưa nhận được trạng thái cuối. Tác vụ có thể vẫn đang chạy; mở Lịch sử và làm mới trước khi gửi lại để tránh tạo trùng.",
        );
      }
    } catch (cause) {
      if (signal.aborted || !videoMounted.current) return;
      setError(cause instanceof Error ? cause.message : "Không tạo được video.");
      setJobStatus("");
    } finally {
      if (videoMounted.current) {
        setVideoStartedAt(null);
        setVideoSubmitting(false);
      }
    }
  };

  if (!authenticated) {
    if (!isAdmin) {
      return (
        <View style={styles.musePage}>
          <View style={styles.musePageIntro}>
            <Text style={styles.sectionEyebrow}>TDLUXY CREATIVE STUDIO</Text>
            <Text style={styles.sectionHeading}>Muse chưa sẵn sàng</Text>
            <Text style={styles.sectionSubheading}>
              Quản trị viên cần thêm và xác minh tài khoản Muse vào nhóm dùng chung trước khi thành viên có thể sử dụng.
            </Text>
          </View>
          {error ? <InlineNotice tone="error" message={error} /> : null}
        </View>
      );
    }
    return (
      <View style={styles.musePage}>
        <View style={styles.musePageIntro}>
          <Text style={styles.sectionEyebrow}>TDLUXY CREATIVE STUDIO</Text>
          <Text style={styles.sectionHeading}>Mở không gian cùng TDLUXY</Text>
          <Text style={styles.sectionSubheading}>
            Kết nối tài khoản Muse của bạn để trò chuyện và thử tạo video ngay trong studio.
          </Text>
        </View>
        <View style={styles.authCard}>
          <View style={styles.authIllustration}>
            <View style={styles.authIllustrationTile}>
              <Ionicons name="chatbubbles" size={27} color="#8B7CFF" />
            </View>
            <View style={styles.authIllustrationSpark}>
              <Ionicons name="sparkles" size={15} color="#D69B45" />
            </View>
          </View>
          <Text style={styles.authTitle}>
            {otpSent ? "Kiểm tra hộp thư của bạn" : "Kết nối bằng mã xác minh"}
          </Text>
          <Text style={styles.authDescription}>
            {otpSent
              ? `Muse.ai đã gửi mã đến ${email}. Nhập mã để hoàn tất kết nối.`
              : "Nhập email tài khoản Muse.ai. Mã xác minh được gửi trực tiếp từ Muse."}
          </Text>
          {!otpSent ? (
            <>
              <Text style={styles.formLabel}>EMAIL TÀI KHOẢN MUSE.AI</Text>
              <TextInput
                accessibilityLabel="Email tài khoản Muse"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="tenban@email.com"
                placeholderTextColor="#9894AE"
                value={email}
                onChangeText={setEmail}
                style={styles.formInput}
              />
            </>
          ) : (
            <>
              <Text style={styles.formLabel}>MÃ XÁC MINH</Text>
              <TextInput
                accessibilityLabel="Mã xác minh Muse"
                autoComplete="one-time-code"
                keyboardType="number-pad"
                placeholder="Nhập mã trong email"
                placeholderTextColor="#9894AE"
                value={code}
                onChangeText={setCode}
                style={styles.formInput}
              />
            </>
          )}
          {error ? <InlineNotice tone="error" message={error} /> : null}
          {notice ? <InlineNotice tone="success" message={notice} /> : null}
          {bridge === "offline" ? (
            <View style={styles.bridgeHelp}>
              <Ionicons name="information-circle-outline" size={16} color="#B07929" />
              <Text style={styles.bridgeHelpText}>
                Chưa thấy backend đang chạy. Mở terminal tại thư mục dự án và chạy{" "}
                <Text style={styles.codeInline}>npm.cmd run backend</Text>, sau đó thử kết nối lại.
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || bridge !== "online"}
            onPress={() => void (otpSent ? verifyOtp() : requestOtp())}
            style={({ pressed }) => [
              styles.authButton,
              (busy || bridge !== "online") && styles.disabledButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.authButtonText}>
              {busy
                ? "Đang kết nối…"
                : otpSent
                  ? "Xác minh và kết nối"
                  : "Gửi mã xác minh"}
            </Text>
            {!busy ? (
              <Ionicons
                name={otpSent ? "checkmark" : "arrow-forward"}
                size={16}
                color="#FFFFFF"
              />
            ) : null}
          </Pressable>
          {otpSent ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOtpSent(false);
                setCode("");
                setError("");
              }}
              style={styles.changeEmailButton}
            >
              <Text style={styles.changeEmailText}>Dùng email khác</Text>
            </Pressable>
          ) : null}
          <View style={styles.privacyLine}>
            <Ionicons name="lock-closed-outline" size={14} color="#7C7890" />
            <Text style={styles.privacyText}>
            Phiên đăng nhập dịch vụ Muse.ai được lưu ở backend cục bộ, không lưu trong app.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.musePage}>
      <View style={styles.musePageIntro}>
        <Text style={styles.sectionEyebrow}>TDLUXY CREATIVE STUDIO</Text>
        <Text style={styles.sectionHeading}>Cùng TDLUXY biến ý tưởng thành hình</Text>
        <Text style={styles.sectionSubheading}>
          Chat sáng tạo, xây concept và tạo video bằng tài khoản Muse.ai đã kết nối.
        </Text>
      </View>
      <View style={styles.museWorkspace}>
        <View style={styles.museWorkspaceHeader}>
          <View style={styles.museIdentity}>
            <View style={styles.museIdentityIcon}>
              <Ionicons name="sparkles" size={17} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.museIdentityTitle}>TDLUXY Studio</Text>
              <View style={styles.museOnlineLine}>
                <View style={styles.statusDot} />
                <Text style={styles.museOnlineText}>Dịch vụ Muse.ai đã kết nối</Text>
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Làm mới lịch sử chat"
            onPress={() => void loadHistory()}
            disabled={busy}
            style={styles.iconAction}
          >
            <Ionicons name="refresh-outline" size={17} color="#777585" />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.museTabs}
        >
          {([
            ["chat", "Trò chuyện", "chatbubble-ellipses-outline"],
            ["video", "Tạo video", "videocam-outline"],
            ["image", "Tạo ảnh", "image-outline"],
            ["edit-image", "Sửa ảnh", "color-wand-outline"],
            ["collage", "Ghép ảnh", "grid-outline"],
            ["edit-video", "Edit video", "film-outline"],
            ["publish", "Đăng video", "cloud-upload-outline"],
          ] as const).map(([tab, label, icon]) => (
            <Pressable
              key={tab}
              accessibilityRole="button"
              accessibilityState={{ selected: activeTab === tab }}
              onPress={() => {
                onTabChange(tab);
                setError("");
                setNotice("");
                setStudioResult("");
                setStudioResultTab(null);
              }}
              style={[styles.museTab, activeTab === tab && styles.museTabActive]}
            >
              <Ionicons
                name={icon}
                size={15}
                color={activeTab === tab ? "#A78BFA" : "#8D8B99"}
              />
              <Text style={[styles.museTabText, activeTab === tab && styles.museTabTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {activeTab === "publish" ? (
          <PublisherPanel />
        ) : activeTab === "chat" ? (
          <View style={styles.chatPanel}>
            <ScrollView
              style={styles.chatTranscript}
              contentContainerStyle={styles.chatTranscriptContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length ? (
                <>
                  {messages.map((message, index) => (
                    <View
                      key={`${index}-${message.role}`}
                      style={[
                        styles.messageRow,
                        message.role === "user" && styles.messageRowUser,
                      ]}
                    >
                      {message.role !== "user" ? (
                        <View style={styles.messageAvatar}>
                          <Ionicons name="sparkles" size={12} color="#A78BFA" />
                        </View>
                      ) : null}
                      <View
                        style={[
                          styles.messageBubble,
                          message.role === "user"
                            ? styles.userBubble
                            : message.role === "system"
                              ? styles.systemBubble
                              : styles.assistantBubble,
                        ]}
                      >
                        <Text
                          style={[
                            styles.messageText,
                            message.role === "user" && styles.userMessageText,
                          ]}
                        >
                          {message.content}
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              ) : (
                <View style={styles.chatWelcome}>
                  <View style={styles.chatWelcomeIcon}>
                    <Ionicons name="sparkles" size={22} color="#A78BFA" />
                  </View>
                  <Text style={styles.chatWelcomeTitle}>Chào bạn, mình là TDLUXY.</Text>
                  <Text style={styles.chatWelcomeBody}>
                    Cùng xây ý tưởng, prompt hình ảnh, kịch bản và concept video. Chọn gợi ý dưới đây
                    hoặc mô tả điều bạn muốn thực hiện.
                  </Text>
                  <View style={styles.suggestionList}>
                    {[
                      "3 ý tưởng video quảng cáo thời trang",
                      "Concept video ngắn cho một món ăn",
                      "Kịch bản giới thiệu khóa học 30 giây",
                    ].map((suggestion) => (
                      <Pressable
                        key={suggestion}
                        accessibilityRole="button"
                        onPress={() => setDraft(suggestion)}
                        style={styles.suggestionChip}
                      >
                        <Ionicons name="arrow-up" size={13} color="#775CE6" />
                        <Text style={styles.suggestionText}>{suggestion}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              <MuseMediaGallery
                media={museMediaOutputs}
                errors={museMediaErrors}
                onSave={(image) => void saveMuseImage(image)}
              />
              {busy ? (
                <View style={styles.loadingLine}>
                  <View style={styles.loadingSparkle}>
                    <Ionicons name="sparkles" size={14} color="#8B7CFF" />
                  </View>
                  <ActivityIndicator size="small" color="#8B7CFF" />
                  <Text style={styles.loadingText}>TDLUXY đang nghĩ cùng bạn…</Text>
                </View>
              ) : null}
            </ScrollView>
            {error ? <InlineNotice tone="error" message={error} /> : null}
            {notice ? <InlineNotice tone="success" message={notice} /> : null}
            <View style={styles.chatComposer}>
              <TextInput
                accessibilityLabel="Tin nhắn gửi TDLUXY"
                editable={!busy}
                multiline
                placeholder="Chia sẻ ý tưởng của bạn với TDLUXY…"
                placeholderTextColor="#9894AE"
                value={draft}
                onChangeText={setDraft}
                style={styles.chatInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Gửi tin nhắn"
                disabled={!draft.trim() || busy}
                onPress={() => void sendMessage()}
                style={({ pressed }) => [
                  styles.sendButton,
                  (!draft.trim() || busy) && styles.disabledButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
            <Text style={styles.composerHint}>
              TDLUXY được hỗ trợ bởi dịch vụ Muse.ai. Đừng gửi thông tin nhạy cảm.
            </Text>
          </View>
        ) : activeTab === "video" ? (
          <View style={styles.videoPanel}>
            <View style={styles.videoIntro}>
              <View style={styles.videoIntroIcon}>
                <Ionicons name="film-outline" size={18} color="#C1812F" />
              </View>
              <View style={styles.videoIntroCopy}>
                <Text style={styles.videoIntroTitle}>Tạo video từ ý tưởng</Text>
                <Text style={styles.videoIntroText}>
                  Viết cảnh bạn hình dung. Có thể thêm ảnh làm tham chiếu.
                </Text>
              </View>
            </View>
            <View style={styles.contentIdeaCard}>
              <View style={styles.contentIdeaHeading}>
                <View style={styles.contentIdeaIcon}>
                  <Ionicons name="bulb-outline" size={16} color="#986B25" />
                </View>
                <View style={styles.contentIdeaCopy}>
                  <Text style={styles.contentIdeaTitle}>Trợ lý ý tưởng content</Text>
                  <Text style={styles.contentIdeaSubtitle}>
                    Chọn ngành hàng, đặt mục tiêu — TDLUXY sẽ gợi ý concept và kịch bản.
                  </Text>
                </View>
              </View>
              <Text style={styles.contentIdeaLabel}>NGÀNH HÀNG</Text>
              <View style={styles.industryChips}>
                {videoIndustries.map((industry) => (
                  <Pressable
                    key={industry.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: videoIndustry === industry.label }}
                    onPress={() => {
                      setVideoIndustry(industry.label);
                      setVideoPrompt(industry.prompt);
                    }}
                    style={[
                      styles.industryChip,
                      videoIndustry === industry.label && styles.industryChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.industryChipText,
                        videoIndustry === industry.label && styles.industryChipTextActive,
                      ]}
                    >
                      {industry.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.contentIdeaFields}>
                <TextInput
                  accessibilityLabel="Mục tiêu nội dung"
                  editable={!busy}
                  value={videoIdeaGoal}
                  onChangeText={setVideoIdeaGoal}
                  placeholder="Mục tiêu: ra mắt, bán hàng, tăng nhận diện…"
                  placeholderTextColor="#9894AE"
                  style={styles.contentIdeaInput}
                />
                <TextInput
                  accessibilityLabel="Đối tượng xem nội dung"
                  editable={!busy}
                  value={videoIdeaAudience}
                  onChangeText={setVideoIdeaAudience}
                  placeholder="Khách hàng mục tiêu"
                  placeholderTextColor="#9894AE"
                  style={styles.contentIdeaInput}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void askForContentIdea()}
                style={({ pressed }) => [
                  styles.contentIdeaButton,
                  busy && styles.disabledButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#8B7CFF" />
                ) : (
                  <Ionicons name="sparkles" size={14} color="#8B7CFF" />
                )}
                <Text style={styles.contentIdeaButtonText}>
                  {busy ? "Đang phác thảo…" : "Gợi ý concept & kịch bản"}
                </Text>
              </Pressable>
              {studioResult ? (
                <View style={styles.studioResultCard}>
                  <View style={styles.studioResultHeader}>
                    <View style={styles.studioResultIcon}>
                      <Ionicons name="sparkles" size={14} color="#A78BFA" />
                    </View>
                    <Text style={styles.studioResultTitle}>Concept TDLUXY đề xuất</Text>
                  </View>
                  <Text selectable style={styles.studioResultText}>{studioResult}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.formLabel}>MÔ TẢ VIDEO CỦA BẠN</Text>
            <View style={styles.promptTemplates}>
              {videoIndustries.map((template) => (
                <Pressable
                  key={template.label}
                  accessibilityRole="button"
                  onPress={() => {
                    setVideoIndustry(template.label);
                    setVideoPrompt(template.prompt);
                  }}
                  style={styles.promptTemplateChip}
                >
                  <Text style={styles.promptTemplateText}>{template.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Mô tả video"
              editable={!busy}
              multiline
              textAlignVertical="top"
              placeholder="Ví dụ: Video 10 giây giới thiệu ly cà phê trên bàn gỗ, ánh nắng sớm chiếu qua cửa sổ, máy quay tiến chậm, tông màu ấm..."
              placeholderTextColor="#9894AE"
              value={videoPrompt}
              onChangeText={setVideoPrompt}
              style={styles.videoPromptInput}
            />
            <View style={styles.promptHelpRow}>
              <Ionicons name="bulb-outline" size={15} color="#A77B35" />
              <Text style={styles.promptHelpText}>
                Nêu chủ thể · bối cảnh · chuyển động máy quay · ánh sáng · phong cách.
              </Text>
            </View>
            <View style={styles.referenceHeader}>
              <View>
                <Text style={styles.formLabel}>ẢNH THAM CHIẾU</Text>
                <Text style={styles.referenceHint}>Tùy chọn · tối đa 4 ảnh</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => void chooseImages()}
                disabled={busy}
                style={styles.addReferenceButton}
              >
                <Ionicons name="add" size={16} color="#A78BFA" />
                <Text style={styles.addReferenceText}>Thêm ảnh</Text>
              </Pressable>
            </View>
            {images.length ? (
              <View style={styles.referenceList}>
                {images.map((image, index) => (
                  <View key={`${image.name}-${index}`} style={styles.referenceItem}>
                    <Ionicons name="image-outline" size={15} color="#8B7CFF" />
                    <Text numberOfLines={1} style={styles.referenceName}>
                      {image.name}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Xóa ${image.name}`}
                      onPress={() =>
                        setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <Ionicons name="close-circle" size={17} color="#9795A2" />
                    </Pressable>
                  </View>
                ))}
                <MuseMediaGallery
                  media={museMediaOutputs}
                  errors={museMediaErrors}
                  onSave={(image) => void saveMuseImage(image)}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => void chooseImages()}
                style={styles.dropzone}
              >
                <View style={styles.dropzoneIcon}>
                  <Ionicons name="cloud-upload-outline" size={19} color="#A78BFA" />
                </View>
                <Text style={styles.dropzoneTitle}>Thêm ảnh để định hướng khung hình</Text>
                <Text style={styles.dropzoneText}>Chọn JPEG, PNG, WEBP hoặc GIF · tối đa 8 MB/ảnh</Text>
              </Pressable>
            )}
            {error ? <InlineNotice tone="error" message={error} /> : null}
            {jobStatus ? (
              <View style={styles.jobNotice}>
                {busy ? (
                  <ActivityIndicator size="small" color="#8B7CFF" />
                ) : (
                  <Ionicons name="checkmark-circle" size={16} color="#34D399" />
                )}
                <Text style={styles.jobNoticeText}>{jobStatus}</Text>
              </View>
            ) : null}
            {videos.map((video) => (
              <View key={`${video.jobId}-${video.index}`} style={styles.videoResult}>
                <View style={styles.resultIcon}>
                  <Ionicons name="play" size={15} color="#FFFFFF" />
                </View>
                <View style={styles.resultCopy}>
                  <Text style={styles.resultTitle}>{video.name}</Text>
                  <Text style={styles.resultSubtitle}>Đã lưu vào thư viện · xem ngay</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Xem video ${video.name}`}
                  onPress={() =>
                    onOpenVideo(
                      video.jobId,
                      video.index,
                      video.name,
                      videoPrompt,
                    )
                  }
                >
                  <Ionicons name="play-circle" size={23} color="#8B7CFF" />
                </Pressable>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={!videoPrompt.trim() || busy || videoStartedAt !== null}
              onPress={() => void createVideo()}
              style={({ pressed }) => [
                styles.generateButton,
                (!videoPrompt.trim() || busy || videoStartedAt !== null) && styles.disabledButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="sparkles" size={15} color="#FFFFFF" />
              <Text style={styles.generateButtonText}>
                {videoStartedAt !== null ? "Video đang xử lý…" : "Tạo video với TDLUXY"}
              </Text>
              {!busy ? <Ionicons name="arrow-forward" size={15} color="#FFFFFF" /> : null}
            </Pressable>
          </View>
        ) : (
          <StudioTaskPanel
            task={activeTab}
            brief={studioBrief}
            result={studioResultTab === activeTab ? studioResult : ""}
            imageResult={studioImageResultTab === activeTab ? studioImageResult : ""}
            mediaOutputs={studioResultTab === activeTab ? museMediaOutputs : []}
            mediaErrors={studioResultTab === activeTab ? museMediaErrors : []}
            images={images}
            imagePreset={imagePreset}
            busy={busy}
            error={error}
            onBriefChange={setStudioBrief}
            onChooseImages={() => void chooseImages()}
            onImagePresetChange={setImagePreset}
            onSaveImage={() => void saveCurrentImage()}
            onSaveMedia={(image) => void saveMuseImage(image)}
            onRun={() => void runStudioTask()}
          />
        )}
      </View>
      <VideoCreationModal
        visible={videoSubmitting}
        status={jobStatus}
        startedAt={videoStartedAt}
      />
      <View style={styles.museSupport}>
        <Ionicons name="shield-checkmark-outline" size={15} color="#77748A" />
        <Text style={styles.museSupportText}>
          TDLUXY kết nối qua backend trên máy bạn. MuseAI-API là thư viện không chính thức; hãy tuân thủ điều khoản Muse.ai.
        </Text>
      </View>
    </View>
  );
}

function EmptyScreen({ screen, onExplore }: { screen: Screen; onExplore: () => void }) {
  const isProjects = screen === "Dự án";
  return (
    <View style={styles.emptyScreen}>
      <View style={styles.emptyArtwork}>
        <View style={styles.emptyArtworkBack}>
          <Ionicons
            name={isProjects ? "folder-open-outline" : "time-outline"}
            size={28}
            color="#8B7CFF"
          />
        </View>
        <View style={styles.emptyArtworkDot} />
      </View>
      <Text style={styles.sectionEyebrow}>{isProjects ? "WORKSPACE" : "HOẠT ĐỘNG"}</Text>
      <Text style={styles.emptyScreenTitle}>
        {isProjects ? "Không gian của bạn đang chờ" : "Mọi thứ bắt đầu từ đây"}
      </Text>
      <Text style={styles.emptyScreenText}>
        {isProjects
          ? "Các dự án bạn tạo sẽ được lưu và sắp xếp tại đây."
          : "Lịch sử sáng tạo sẽ xuất hiện sau khi bạn kết nối dịch vụ AI."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onExplore}
        style={({ pressed }) => [
          styles.emptyScreenButton,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.emptyScreenButtonText}>Khám phá công cụ</Text>
        <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.brandMark}>
        <Ionicons name="sparkles" size={18} color="#FFFFFF" />
      </View>
      <Text style={styles.brandText}>TDLUXY</Text>
      <Text style={styles.brandAI}>STUDIO</Text>
    </View>
  );
}

function NavigationItem({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navItem,
        active && styles.navItemActive,
        pressed && styles.navItemPressed,
      ]}
    >
      <Ionicons name={icon} size={19} color={active ? "#A78BFA" : "#858393"} />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {label === "Muse" ? "TDLUXY" : label}
      </Text>
      {active ? <View style={styles.navIndicator} /> : null}
    </Pressable>
  );
}

