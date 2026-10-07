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
export function VideoViewerModal({
  video,
  error,
  onClose,
  onCreateVariant,
}: {
  video: VideoPreview | null;
  error: string;
  onClose: () => void;
  onCreateVariant: (prompt: string) => void;
}) {
  const player = useVideoPlayer(video?.uri ?? null, (instance) => {
    instance.loop = false;
  });
  const [actionError, setActionError] = useState("");
  const visible = Boolean(video || error);

  const close = () => {
    player.pause();
    setActionError("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={styles.videoModalOverlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Đóng trình xem video"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.videoModalCard}>
          <View style={styles.videoModalHeader}>
            <View style={styles.videoModalTitleCopy}>
              <Text style={styles.videoModalEyebrow}>TDLUXY · KẾT QUẢ</Text>
              <Text style={styles.videoModalTitle} numberOfLines={1}>
                {video?.name ?? "Không mở được video"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Đóng"
              onPress={close}
              style={styles.modalClose}
            >
              <Ionicons name="close" size={20} color="#777585" />
            </Pressable>
          </View>

          {error ? (
            <InlineNotice tone="error" message={error} />
          ) : video ? (
            <>
              <VideoView
                player={player}
                nativeControls
                contentFit="contain"
                playsInline
                style={styles.videoPlayerView}
              />
              <Text style={styles.videoPromptLabel}>PROMPT ĐÃ DÙNG</Text>
              <Text style={styles.videoPromptSummary} numberOfLines={4}>
                {video.prompt}
              </Text>
              {actionError ? <InlineNotice tone="error" message={actionError} /> : null}
              <View style={styles.videoModalActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void Linking.openURL(video.uri).catch((cause: Error) =>
                      setActionError(`Không mở được liên kết video: ${cause.message}`),
                    )
                  }
                  style={styles.videoDownloadButton}
                >
                  <Ionicons name="download-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.videoDownloadText}>Tải video</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onCreateVariant(video.prompt)}
                  style={styles.videoVariantButton}
                >
                  <Ionicons name="copy-outline" size={16} color="#6F53D9" />
                  <Text style={styles.videoVariantText}>Tạo phiên bản mới</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function MuseMediaGallery({
  media,
  errors,
  onSave,
}: {
  media: MuseMediaOutput[];
  errors: string[];
  onSave: (image: MuseMediaOutput) => void;
}) {
  const [selected, setSelected] = useState<MuseMediaOutput | null>(null);
  if (media.length === 0 && errors.length === 0) return null;
  return (
    <View style={styles.museMediaGallery}>
      <View style={styles.museMediaGalleryHeader}>
        <View>
          <Text style={styles.museMediaHeading}>Kết quả hình ảnh</Text>
          <Text style={styles.museMediaSubheading}>
            {media.length} ảnh · độ phân giải gốc có thể xem và lưu
          </Text>
        </View>
        <Ionicons name="sparkles" size={18} color="#7658F6" />
      </View>
      {errors.map((message, index) => (
        <InlineNotice key={`${index}-${message}`} tone="error" message={message} />
      ))}
      <View style={styles.museMediaGrid}>
        {media.map((image, index) => (
          <View key={`${image.name}-${index}`} style={styles.museMediaItem}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mở ảnh ${image.name} độ phân giải ${image.width} nhân ${image.height}`}
              onPress={() => setSelected(image)}
              style={styles.museMediaImageButton}
            >
              <Image
                source={{ uri: image.previewUri }}
                style={styles.museMediaThumbnail}
                resizeMode="contain"
              />
              <View style={styles.museMediaResolution}>
                <Ionicons name="scan-outline" size={11} color="#FFFFFF" />
                <Text style={styles.museMediaResolutionText}>
                  {image.width} × {image.height}
                </Text>
              </View>
              <View style={styles.museMediaZoom}>
                <Ionicons name="expand-outline" size={14} color="#FFFFFF" />
              </View>
            </Pressable>
            <Text numberOfLines={1} style={styles.museMediaName}>{image.name}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Lưu ảnh gốc ${image.name}`}
              onPress={() => onSave(image)}
              style={({ pressed }) => [
                styles.mediaSaveButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="download-outline" size={15} color="#FFFFFF" />
              <Text style={styles.mediaSaveButtonText}>Lưu ảnh gốc</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setSelected(null)}
        transparent
        visible={selected !== null}
      >
        <View style={styles.museImageLightbox}>
          <View style={styles.museImageLightboxToolbar}>
            <View style={styles.museImageLightboxTitle}>
              <Text numberOfLines={1} style={styles.museImageLightboxName}>
                {selected?.name}
              </Text>
              {selected ? (
                <Text style={styles.museImageLightboxDimensions}>
                  {selected.width} × {selected.height} px
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Đóng xem ảnh"
              onPress={() => setSelected(null)}
              style={styles.museImageLightboxClose}
            >
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
          {selected ? (
            <Image
              source={{ uri: selected.fullUri }}
              style={styles.museImageLightboxImage}
              resizeMode="contain"
            />
          ) : null}
          {selected ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onSave(selected)}
              style={styles.museImageLightboxSave}
            >
              <Ionicons name="download-outline" size={17} color="#FFFFFF" />
              <Text style={styles.mediaSaveButtonText}>Lưu ảnh gốc</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

export function StudioTaskPanel({
  task,
  brief,
  result,
  imageResult,
  mediaOutputs,
  mediaErrors,
  images,
  imagePreset,
  busy,
  error,
  onBriefChange,
  onChooseImages,
  onImagePresetChange,
  onSaveImage,
  onSaveMedia,
  onRun,
}: {
  task: "image" | "edit-image" | "collage" | "edit-video";
  brief: string;
  result: string;
  imageResult: string;
  mediaOutputs: MuseMediaOutput[];
  mediaErrors: string[];
  images: MuseImage[];
  imagePreset: "clean" | "warm" | "mono";
  busy: boolean;
  error: string;
  onBriefChange: (value: string) => void;
  onChooseImages: () => void;
  onImagePresetChange: (value: "clean" | "warm" | "mono") => void;
  onSaveImage: () => void;
  onSaveMedia: (image: MuseMediaOutput) => void;
  onRun: () => void;
}) {
  const needsImageFiles = task === "edit-image" || task === "collage";
  const imageCountValid = task === "collage" ? images.length >= 2 : images.length >= 1;
  const canRun = needsImageFiles ? imageCountValid : Boolean(brief.trim());
  const config = {
    image: {
      eyebrow: "IMAGE CONCEPT",
      title: "Sáng tạo concept hình ảnh",
      description: "Biến mô tả thành brief hình ảnh và prompt chi tiết để đưa vào công cụ tạo ảnh.",
      placeholder: "Mô tả chủ thể, phong cách, màu sắc, bối cảnh hoặc cảm xúc bạn muốn…",
      action: "Tạo prompt bằng chat Muse",
      limitation: "TDLUXY hiện tạo concept/prompt bằng chat; Muse bridge chưa có model xuất tệp ảnh độc lập.",
      icon: "sparkles-outline" as const,
    },
    "edit-image": {
      eyebrow: "IMAGE WORKFLOW",
      title: "Trợ lý chỉnh sửa ảnh",
      description: "Chỉnh sáng, tương phản, màu sắc và độ nét trực tiếp bằng preset cục bộ.",
      placeholder: "Ví dụ: làm ảnh sản phẩm sáng hơn, nền màu kem, giữ nguyên chi tiết nhãn…",
      action: "Chỉnh ảnh thật",
      limitation: "Ảnh được xử lý trên backend bằng Pillow; xóa nền và retouch AI nâng cao chưa có model.",
      icon: "color-wand-outline" as const,
    },
    collage: {
      eyebrow: "PHOTO STORY",
      title: "Thiết kế câu chuyện ghép ảnh",
      description: "Chọn 2–4 ảnh để xuất collage dọc 1080 × 1350.",
      placeholder: "Ví dụ: 4 ảnh chuyến đi Đà Lạt, làm collage dọc để đăng story…",
      action: "Ghép và xuất ảnh",
      limitation: "Ghép ảnh dạng lưới 2 × 2 với crop căn giữa; chưa có lớp chữ hoặc template tùy chỉnh.",
      icon: "grid-outline" as const,
    },
    "edit-video": {
      eyebrow: "VIDEO EDIT",
      title: "Trợ lý biên tập video",
      description: "Lập timeline, điểm cắt, phụ đề và nhịp dựng cho nội dung của bạn.",
      placeholder: "Mô tả video, thời lượng, nền tảng đăng và phong cách dựng mong muốn…",
      action: "Lập kế hoạch dựng",
      limitation: "Muse bridge đang tạo video mới; chức năng cắt, ghép và xuất lại video nguồn chưa được tích hợp.",
      icon: "film-outline" as const,
    },
  }[task];

  return (
    <View style={styles.studioTaskPanel}>
      <View style={styles.studioTaskHeading}>
        <View style={styles.studioTaskIcon}>
          <Ionicons name={config.icon} size={20} color="#7054E8" />
        </View>
        <View style={styles.studioTaskHeadingCopy}>
          <Text style={styles.studioTaskEyebrow}>{config.eyebrow}</Text>
          <Text style={styles.studioTaskTitle}>{config.title}</Text>
          <Text style={styles.studioTaskDescription}>{config.description}</Text>
        </View>
      </View>

      <View style={styles.studioLimitation}>
        <Ionicons name="information-circle-outline" size={16} color="#9B742F" />
        <Text style={styles.studioLimitationText}>{config.limitation}</Text>
      </View>

      {needsImageFiles ? (
        <View style={styles.mediaInputPanel}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onChooseImages}
            style={({ pressed }) => [
              styles.mediaPickButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="images-outline" size={16} color="#7054E8" />
            <Text style={styles.mediaPickButtonText}>
              {task === "collage" ? "Chọn 2–4 ảnh" : "Chọn ảnh cần chỉnh"}
            </Text>
          </Pressable>
          <Text style={styles.mediaSelectionCount}>
            {images.length} ảnh đã chọn
          </Text>
          {task === "edit-image" ? (
            <View style={styles.mediaPresetRow}>
              {([
                ["clean", "Sạch nét"],
                ["warm", "Tông ấm"],
                ["mono", "Đen trắng"],
              ] as const).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: imagePreset === value }}
                  onPress={() => onImagePresetChange(value)}
                  style={[
                    styles.mediaPresetChip,
                    imagePreset === value && styles.mediaPresetChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.mediaPresetText,
                      imagePreset === value && styles.mediaPresetTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {images.length ? (
            <View style={styles.mediaThumbRow}>
              {images.slice(0, task === "collage" ? 4 : 1).map((image) => (
                <Image
                  key={`${image.name}:${image.uri}`}
                  source={{ uri: image.uri }}
                  style={styles.mediaThumb}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.formLabel}>BRIEF SÁNG TẠO</Text>
      <TextInput
        accessibilityLabel={config.title}
        editable={!busy}
        multiline
        textAlignVertical="top"
        value={brief}
        onChangeText={onBriefChange}
        placeholder={config.placeholder}
        placeholderTextColor="#A4A2AF"
        style={styles.studioBriefInput}
      />
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <Pressable
        accessibilityRole="button"
        disabled={!canRun || busy}
        onPress={onRun}
        style={({ pressed }) => [
          styles.studioRunButton,
          (!canRun || busy) && styles.disabledButton,
          pressed && styles.buttonPressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons name="sparkles" size={16} color="#FFFFFF" />
        )}
        <Text style={styles.studioRunText}>{busy ? "TDLUXY đang xử lý…" : config.action}</Text>
      </Pressable>

      {result ? (
        <View style={styles.studioResultCard}>
          <View style={styles.studioResultHeader}>
            <View style={styles.studioResultIcon}>
              <Ionicons name="sparkles" size={14} color="#7054E8" />
            </View>
            <Text style={styles.studioResultTitle}>Gợi ý từ TDLUXY</Text>
          </View>
          <Text selectable style={styles.studioResultText}>{result}</Text>
          {imageResult ? (
            <>
              <Image source={{ uri: imageResult }} style={styles.studioImagePreview} />
              <Pressable
                accessibilityRole="button"
                onPress={onSaveImage}
                style={({ pressed }) => [
                  styles.mediaSaveButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="download-outline" size={16} color="#FFFFFF" />
                <Text style={styles.mediaSaveButtonText}>Lưu ảnh kết quả</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
      <MuseMediaGallery media={mediaOutputs} errors={mediaErrors} onSave={onSaveMedia} />
    </View>
  );
}

export function VideoCreationModal({
  visible,
  status,
  startedAt,
}: {
  visible: boolean;
  status: string;
  startedAt: number | null;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pulse = useMemo(() => new Animated.Value(0.35), []);

  useEffect(() => {
    if (!visible) {
      setElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => {
      if (startedAt !== null) {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      clearInterval(timer);
      animation.stop();
    };
  }, [pulse, startedAt, visible]);

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  const queued = status.toLocaleLowerCase("vi").includes("hàng đợi");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => undefined}
    >
      <View style={styles.generationOverlay}>
        <View style={styles.generationCard}>
          <View style={styles.generationHeader}>
            <View style={styles.generationBrand}>
              <View style={styles.generationLogo}>
                <Ionicons name="sparkles" size={16} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.generationEyebrow}>TDLUXY · VIDEO LAB</Text>
                <Text style={styles.generationTitle}>Đang dựng nên ý tưởng của bạn</Text>
              </View>
            </View>
            <View style={styles.generationLive}>
              <Animated.View style={[styles.generationLiveDot, { opacity: pulse }]} />
              <Text style={styles.generationLiveText}>LIVE</Text>
            </View>
          </View>

          <View style={styles.generationArtwork}>
            <View style={styles.generationOrbitOuter} />
            <View style={styles.generationOrbitInner} />
            <Animated.View style={[styles.generationCore, { opacity: pulse }]}>
              <Ionicons name="videocam" size={30} color="#D7CBFF" />
            </Animated.View>
            <View style={[styles.generationNode, styles.generationNodeA]}>
              <Ionicons name="image-outline" size={14} color="#F4C97A" />
            </View>
            <View style={[styles.generationNode, styles.generationNodeB]}>
              <Ionicons name="sparkles" size={13} color="#A9E4D4" />
            </View>
          </View>

          <View style={styles.generationStatusRow}>
            <ActivityIndicator size="small" color="#7658F6" />
            <Text style={styles.generationStatus}>{status}</Text>
            <Text style={styles.generationTimer}>
              {minutes}:{seconds}
            </Text>
          </View>

          <View style={styles.generationTerminal}>
            <View style={styles.terminalTopbar}>
              <View style={styles.terminalLights}>
                <View style={[styles.terminalLight, { backgroundColor: "#F17E82" }]} />
                <View style={[styles.terminalLight, { backgroundColor: "#E8BC61" }]} />
                <View style={[styles.terminalLight, { backgroundColor: "#69C59A" }]} />
              </View>
              <Text style={styles.terminalCaption}>creative-pipeline.log</Text>
              <Text style={styles.terminalLive}>RUNNING</Text>
            </View>
            <View style={styles.terminalLines}>
              <Text style={styles.terminalLine}>
                <Text style={styles.terminalPrompt}>$ </Text>tdluxy render --mode video --provider muse
              </Text>
              <Text style={styles.terminalLine}>
                <Text style={styles.terminalSuccess}>✓ </Text>Brief đã được gửi đến backend
              </Text>
              <Text style={styles.terminalLine}>
                <Text style={styles.terminalInfo}>› </Text>
                {queued ? "Đang chờ đến lượt xử lý" : "Muse đang xử lý tác vụ video"}
              </Text>
              <Text style={styles.terminalLine}>
                <Text style={styles.terminalInfo}>› </Text>Đang theo dõi tệp kết quả…
                <Animated.Text style={{ opacity: pulse }}>▌</Animated.Text>
              </Text>
            </View>
          </View>

          <Text style={styles.generationFootnote}>
            {elapsedSeconds >= 90
              ? "Tác vụ đang lâu hơn thường lệ. TDLUXY vẫn kiểm tra trạng thái; nếu quá 11 phút, hãy xem Lịch sử trước khi thử lại."
              : "Muse chưa cung cấp phần trăm tiến độ theo thời gian thực. TDLUXY đang kiểm tra trạng thái và chờ tệp video."}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

