import { useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clearSession, getSavedAccount, updateDevicePin } from "../lib/auth-session";
import { Button, Card, ListRow, SectionHeader } from "../ui/kit";
import { color, radius, space, type } from "../ui/theme";
import { AppUpdateButton } from "./AppUpdateButton";

export function DeviceSecuritySettings({ onLogout }: { onLogout: () => Promise<void> }) {
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof getSavedAccount>> | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => { void getSavedAccount().then(setSaved).catch(() => undefined); }, []);

  async function savePin() {
    if (!/^\d{4,8}$/.test(pin)) return Alert.alert("Check the PIN", "Use 4 to 8 digits.");
    if (pin !== confirmation) return Alert.alert("PINs do not match", "Enter the same PIN in both fields.");
    try {
      setSaving(true);
      await updateDevicePin(pin);
      setPinOpen(false);
      setPin("");
      setConfirmation("");
      setSaved(await getSavedAccount());
      Alert.alert("Device PIN updated", "Use the new PIN the next time you unlock this account.");
    } catch (cause) {
      Alert.alert("PIN could not be changed", cause instanceof Error ? cause.message : "Please try again.");
    } finally { setSaving(false); }
  }

  function removeSaved() {
    Alert.alert("Sign out and remove saved account?", "Offline authorization for this account will be removed from this device. Online records and synchronized data are not deleted.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void clearSession(true).then(onLogout) },
    ]);
  }

  return <>
    <SectionHeader title="This phone" />
    <View style={{ gap: space.sm }}>
      {saved?.saved
        ? <ListRow icon="keypad-outline" iconTone="action" title="Change device PIN" subtitle="The PIN that unlocks this account offline" onPress={() => setPinOpen(true)} chevron />
        : <ListRow icon="keypad-outline" title="Device PIN not set" subtitle="Sign in again and choose “Keep on this phone” to work offline with a PIN" />}
      <ListRow icon="finger-print-outline" title="Fingerprint unlock" subtitle={saved?.biometricAvailable ? "Available on this phone" : "Not available on this phone"} />
      <AppUpdateButton />
      <ListRow icon="phone-portrait-outline" title="Device" subtitle={Platform.OS === "android" ? `Android ${String(Platform.Version)}` : Platform.OS === "ios" ? `iOS ${String(Platform.Version)}` : "Browser preview"} />
    </View>
    <View style={{ gap: space.sm }}>
      <Button variant="danger" icon="log-out-outline" title="Sign out" onPress={() => void onLogout()} />
      {saved?.saved ? <Pressable style={s.remove} onPress={removeSaved} hitSlop={8}><Text style={s.removeText}>Sign out and remove this account from the phone</Text></Pressable> : null}
    </View>

    <Modal visible={pinOpen} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setPinOpen(false)}>
      <View style={[s.overlay, { paddingBottom: insets.bottom + space.md }]}>
        <Card style={s.modal}>
          <Text style={type.title}>Change device PIN</Text>
          <Text style={[type.small, { marginTop: -space.sm }]}>Unlocks this account on this phone only. Your password does not change.</Text>
          <Text style={type.label}>New PIN</Text>
          <TextInput value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" secureTextEntry maxLength={8} style={s.input} />
          <Text style={type.label}>Confirm PIN</Text>
          <TextInput value={confirmation} onChangeText={(value) => setConfirmation(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" secureTextEntry maxLength={8} style={s.input} />
          <Button loading={saving} title={saving ? "Saving…" : "Save new PIN"} onPress={() => void savePin()} />
          <Button variant="secondary" title="Cancel" onPress={() => setPinOpen(false)} />
        </Card>
      </View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  remove: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  removeText: { color: color.danger, fontWeight: "500", fontSize: 13 },
  overlay: { flex: 1, backgroundColor: "rgba(19,32,26,0.5)", justifyContent: "flex-end", padding: space.md },
  modal: { width: "100%", maxWidth: 460, alignSelf: "center" },
  input: { minHeight: 54, borderRadius: radius.md, backgroundColor: color.fill, paddingHorizontal: 16, textAlign: "center", fontSize: 22, letterSpacing: 8, color: color.ink },
});
