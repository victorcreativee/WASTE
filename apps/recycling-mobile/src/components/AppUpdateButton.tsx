import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { useState } from "react";
import { Alert } from "react-native";
import { ListRow } from "../ui/kit";

/** Checks the Expo update channel, downloads an update if there is one and offers to restart into it. */
export function useUpdateCheck() {
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
        "Confirm that this device is online and try again. Offline work remains available.",
      );
    } finally {
      setChecking(false);
    }
  }

  return { checking, checkForUpdate };
}

/** Settings row that checks for an application update. */
export function AppUpdateButton() {
  const { checking, checkForUpdate } = useUpdateCheck();
  return (
    <ListRow
      icon="cloud-download-outline"
      iconTone="action"
      title="Check for updates"
      subtitle={checking ? "Checking…" : `Version ${Constants.expoConfig?.version || "unknown"}`}
      onPress={() => void checkForUpdate()}
      chevron
    />
  );
}
