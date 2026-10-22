import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";

export function AppUpdateButton() {
  const [checking, setChecking] = useState(false);

  async function checkForUpdate() {
    if (__DEV__ || !Updates.isEnabled) {
      Alert.alert(
        "Updates are available in installed builds",
        "The development preview reloads through Expo. Install the signed APK to use secure in-app updates.",
      );
      return;
    }
    try {
      setChecking(true);
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert(
          "Application is up to date",
          `Version ${Constants.expoConfig?.version || "unknown"} is using the latest compatible update on ${Updates.channel || "this"} channel.`,
        );
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert("Update downloaded", "Restart the application now to activate it.", [
        { text: "Later", style: "cancel" },
        { text: "Restart", onPress: () => void Updates.reloadAsync() },
      ]);
    } catch {
      Alert.alert(
        "Could not check for updates",
        "Confirm that this tablet is online and try again. Offline work remains available.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={checking}
      onPress={() => void checkForUpdate()}
      style={[styles.button, checking && styles.disabled]}
    >
      <Text style={styles.text}>{checking ? "Checking…" : "Check updates"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderColor: "#3156a3",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  disabled: { opacity: 0.55 },
  text: { color: "#3156a3", fontSize: 13, fontWeight: "700" },
});
