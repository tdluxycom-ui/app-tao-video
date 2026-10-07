import { Ionicons } from "@expo/vector-icons";
import { View, Text } from "react-native";
import { styles } from "../styles/studio";
export function InlineNotice({ tone, message }: { tone: "error" | "success"; message: string }) {
  return (
    <View style={[styles.inlineNotice, tone === "error" ? styles.errorNotice : styles.successNotice]}>
      <Ionicons
        name={tone === "error" ? "alert-circle-outline" : "checkmark-circle-outline"}
        size={15}
        color={tone === "error" ? "#B44755" : "#32866D"}
      />
      <Text style={[styles.inlineNoticeText, tone === "error" && styles.errorNoticeText]}>
        {message}
      </Text>
    </View>
  );
}

