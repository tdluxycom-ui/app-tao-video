import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { View, Text, Pressable, Platform, TextInput, Image, ActivityIndicator } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { apiAccessToken, museRequest, MUSE_API_URL } from "../services/api";
import { styles } from "../styles/studio";
import { InlineNotice } from "./InlineNotice";
export function PublisherPanel() {
  const [platform, setPlatform] = useState<"tiktok" | "youtube">("tiktok");
  const [running, setRunning] = useState(false);
  const [frame, setFrame] = useState("");
  const [frameWidth, setFrameWidth] = useState(0);
  const [pageUrl, setPageUrl] = useState("");
  const [typing, setTyping] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!running) return;
    let active = true;
    let polling = false;
    const refreshFrame = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await museRequest<{
          image_base64: string;
          url: string;
        }>("/api/publisher/session/frame");
        if (active) {
          setFrame(`data:image/jpeg;base64,${result.image_base64}`);
          setPageUrl(result.url);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Mất kết nối với trình duyệt từ xa.");
        }
      } finally {
        polling = false;
      }
    };
    void refreshFrame();
    const timer = setInterval(() => void refreshFrame(), 1700);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [running]);

  const start = async (target: "tiktok" | "youtube" = platform) => {
    setBusy(true);
    setError("");
    setNotice("");
    setFrame("");
    try {
      const result = await museRequest<{ url: string; message: string }>(
        "/api/publisher/session",
        { method: "POST", body: JSON.stringify({ platform: target }) },
      );
      setPlatform(target);
      setPageUrl(result.url);
      setNotice(result.message);
      setRunning(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không mở được trình duyệt đăng video.");
    } finally {
      setBusy(false);
    }
  };

  const sendInput = async (input: Record<string, unknown>) => {
    try {
      await museRequest("/api/publisher/session/input", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được thao tác đến trình duyệt.");
    }
  };

  const selectVideo = async () => {
    setError("");
    setNotice("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "video/*",
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("Không chọn được tệp video.");
      if (asset.size !== undefined && asset.size > 250 * 1024 * 1024) {
        throw new Error("Video phải nhỏ hơn 250 MB.");
      }
      if (!running) throw new Error("Hãy mở trình duyệt đăng bài trước khi chọn video.");
      setBusy(true);
      let filename: string;
      if (Platform.OS === "web") {
        if (!asset.file) throw new Error("Trình duyệt không cung cấp dữ liệu của tệp đã chọn.");
        const uploaded = await museRequest<{ filename: string }>(
          "/api/publisher/session/media",
          {
            method: "POST",
            body: asset.file,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-File-Name": encodeURIComponent(asset.name),
            },
          },
        );
        filename = uploaded.filename;
      } else {
        const bridgeToken = process.env.EXPO_PUBLIC_MUSE_BRIDGE_TOKEN;
        const uploaded = await FileSystem.uploadAsync(
          `${MUSE_API_URL}/api/publisher/session/media`,
          asset.uri,
          {
            httpMethod: "POST",
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
              ...(apiAccessToken ? { Authorization: `Bearer ${apiAccessToken}` } : {}),
              ...(bridgeToken ? { "X-Bridge-Token": bridgeToken } : {}),
              "Content-Type": asset.mimeType || "application/octet-stream",
              "X-File-Name": encodeURIComponent(asset.name),
            },
          },
        );
        if (uploaded.status < 200 || uploaded.status >= 300) {
          let detail = `Backend trả về lỗi HTTP ${uploaded.status}.`;
          try {
            const response = JSON.parse(uploaded.body) as { detail?: string };
            if (response.detail) detail = response.detail;
          } catch {
            throw new Error(detail);
          }
          throw new Error(detail);
        }
        filename = (JSON.parse(uploaded.body) as { filename: string }).filename;
      }
      setUploadName(filename);
      setNotice(`${filename} đã tải lên phiên tạm. Khi bấm chọn tệp trong trang, trình duyệt sẽ gắn video này.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được video lên phiên đăng bài.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await museRequest("/api/publisher/session", { method: "DELETE" });
      setRunning(false);
      setFrame("");
      setPageUrl("");
      setUploadName("");
      setNotice("Đã đóng trình duyệt; cookie và video tạm của phiên này đã được xóa.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đóng được trình duyệt.");
    } finally {
      setBusy(false);
    }
  };

  const clickFrame = (event: {
    nativeEvent: { locationX: number; locationY: number };
  }) => {
    if (!frameWidth) return;
    const scale = 1280 / frameWidth;
    void sendInput({
      action: "click",
      x: Math.round(event.nativeEvent.locationX * scale),
      y: Math.round(event.nativeEvent.locationY * scale),
    });
  };

  return (
    <View style={styles.publisherPanel}>
      <View style={styles.studioTaskHeading}>
        <View style={styles.studioTaskIcon}>
          <Ionicons name="globe-outline" size={20} color="#7054E8" />
        </View>
        <View style={styles.studioTaskHeadingCopy}>
          <Text style={styles.studioTaskEyebrow}>HUMAN-IN-THE-LOOP PUBLISHING</Text>
          <Text style={styles.studioTaskTitle}>Trình duyệt đăng video từ xa</Text>
          <Text style={styles.studioTaskDescription}>
            Mở TikTok hoặc YouTube Studio trong Chromium riêng; xem khung hình trực tiếp và tự thao tác.
          </Text>
        </View>
      </View>
      <View style={styles.studioLimitation}>
        <Ionicons name="shield-checkmark-outline" size={16} color="#9B742F" />
        <Text style={styles.studioLimitationText}>
          Tự đăng nhập, kiểm tra nội dung và bấm nút đăng cuối cùng. TDLUXY không tự gửi bài hoặc lưu mật khẩu/cookie sau khi đóng phiên.
        </Text>
      </View>
      {!running ? (
        <View style={styles.publisherPlatformRow}>
          {([
            ["tiktok", "TikTok", "musical-notes-outline"],
            ["youtube", "YouTube Shorts", "logo-youtube"],
          ] as const).map(([value, label, icon]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: platform === value }}
              onPress={() => setPlatform(value)}
              style={[
                styles.publisherPlatform,
                platform === value && styles.publisherPlatformActive,
              ]}
            >
              <Ionicons
                name={icon}
                size={16}
                color={platform === value ? "#7054E8" : "#888593"}
              />
              <Text
                style={[
                  styles.publisherPlatformText,
                  platform === value && styles.publisherPlatformTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void start()}
            style={({ pressed }) => [
              styles.publisherStartButton,
              busy && styles.disabledButton,
              pressed && styles.buttonPressed,
            ]}
          >
            {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
            <Text style={styles.publisherStartText}>
              {busy ? "Đang mở..." : "Mở trình duyệt"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.publisherToolbar}>
            <Text numberOfLines={1} style={styles.publisherUrl}>{pageUrl}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void selectVideo()}
              disabled={busy}
              style={styles.publisherToolbarButton}
            >
              <Ionicons name="cloud-upload-outline" size={15} color="#7054E8" />
              <Text style={styles.publisherToolbarText}>Chọn video</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void sendInput({ action: "back" })}
              style={styles.publisherToolbarButton}
            >
              <Ionicons name="arrow-back" size={15} color="#7054E8" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void sendInput({ action: "reload" })}
              style={styles.publisherToolbarButton}
            >
              <Ionicons name="refresh" size={15} color="#7054E8" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void stop()}
              style={[styles.publisherToolbarButton, styles.publisherStopButton]}
            >
              <Ionicons name="close" size={15} color="#B55361" />
            </Pressable>
          </View>
          {uploadName ? (
            <Text style={styles.publisherUploadNotice}>Video tạm: {uploadName}</Text>
          ) : null}
          {frame ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Khung trình duyệt từ xa; chạm để bấm tại vị trí đó"
              onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}
              onPress={clickFrame}
              style={styles.publisherFrame}
            >
              <Image source={{ uri: frame }} style={styles.publisherFrameImage} />
            </Pressable>
          ) : (
            <View style={[styles.publisherFrame, styles.publisherFrameLoading]}>
              <ActivityIndicator size="large" color="#7658F6" />
              <Text style={styles.publisherFrameText}>Đang kết nối và tải khung hình…</Text>
            </View>
          )}
          <View style={styles.publisherControls}>
            <TextInput
              accessibilityLabel="Nội dung nhập vào trình duyệt"
              value={typing}
              onChangeText={setTyping}
              placeholder="Nhập caption hoặc nội dung vào trường đang được chọn"
              placeholderTextColor="#A4A2AF"
              style={styles.publisherTypingInput}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!typing) return;
                void sendInput({ action: "type", text: typing });
                setTyping("");
              }}
              style={styles.publisherToolbarButton}
            >
              <Text style={styles.publisherToolbarText}>Nhập</Text>
            </Pressable>
            {(["Enter", "Tab"] as const).map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() => void sendInput({ action: "press", key })}
                style={styles.publisherToolbarButton}
              >
                <Text style={styles.publisherToolbarText}>{key}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.publisherControls}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void sendInput({ action: "scroll", delta_y: -600 })}
              style={styles.publisherToolbarButton}
            >
              <Ionicons name="chevron-up" size={16} color="#7054E8" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void sendInput({ action: "scroll", delta_y: 600 })}
              style={styles.publisherToolbarButton}
            >
              <Ionicons name="chevron-down" size={16} color="#7054E8" />
            </Pressable>
            <Text style={styles.publisherFrameText}>
              Khung hình làm mới mỗi ~1,7 giây · chạm vào ảnh để click.
            </Text>
          </View>
        </>
      )}
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {notice ? <InlineNotice tone="success" message={notice} /> : null}
    </View>
  );
}

