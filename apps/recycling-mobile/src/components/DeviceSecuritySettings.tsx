import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { clearSession, getSavedAccount, updateDevicePin } from "../lib/auth-session";
import { AppUpdateButton } from "./AppUpdateButton";

export function DeviceSecuritySettings({ onLogout }: { onLogout: () => Promise<void> }) {
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof getSavedAccount>> | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const version = Constants.expoConfig?.version || "Unknown";

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
    <Text style={s.groupTitle}>Device and security</Text>
    <View style={s.card}>
      <Setting label="Saved-device access" value={saved?.saved ? "Enabled" : "Not enabled"} />
      <Setting label="Biometric unlock" value={saved?.biometricAvailable ? "Available" : "Not available"} />
      <Setting label="Platform" value={`Android ${String(Platform.Version)}`} />
      <Setting label="Application version" value={version} last />
    </View>
    {saved?.saved ? <Pressable style={s.action} onPress={() => setPinOpen(true)}><View style={{ flex: 1 }}><Text style={s.actionTitle}>Change device PIN</Text><Text style={s.actionCopy}>Create a new 4–8 digit offline unlock PIN.</Text></View><Text style={s.chevron}>›</Text></Pressable> : null}
    <View style={s.action}><View style={{ flex: 1 }}><Text style={s.actionTitle}>Application updates</Text><Text style={s.actionCopy}>Securely check the active Expo update channel.</Text></View><AppUpdateButton /></View>
    <Pressable style={s.signOut} onPress={() => void onLogout()}><Text style={s.signOutText}>Sign out</Text></Pressable>
    {saved?.saved ? <Pressable style={s.remove} onPress={removeSaved}><Text style={s.removeText}>Sign out and remove saved account</Text></Pressable> : null}

    <Modal visible={pinOpen} transparent animationType="fade" onRequestClose={() => setPinOpen(false)}>
      <View style={s.overlay}><View style={s.modal}>
        <Text style={s.modalEyebrow}>DEVICE SECURITY</Text>
        <Text style={s.modalTitle}>Change device PIN</Text>
        <Text style={s.modalCopy}>This PIN protects offline access on this device. It does not replace your server password.</Text>
        <Text style={s.label}>New PIN</Text><TextInput value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" secureTextEntry maxLength={8} style={s.input} />
        <Text style={s.label}>Confirm PIN</Text><TextInput value={confirmation} onChangeText={(value) => setConfirmation(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" secureTextEntry maxLength={8} style={s.input} />
        <Pressable disabled={saving} onPress={() => void savePin()} style={[s.primary, saving && s.disabled]}><Text style={s.primaryText}>{saving ? "Saving…" : "Save new PIN"}</Text></Pressable>
        <Pressable onPress={() => setPinOpen(false)} style={s.cancel}><Text style={s.cancelText}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}

function Setting({ label, value, last }: { label: string; value: string; last?: boolean }) { return <View style={[s.setting, last && s.last]}><Text style={s.settingLabel}>{label}</Text><Text style={s.settingValue}>{value}</Text></View>; }

const s = StyleSheet.create({
  groupTitle: { color: "#172033", fontSize: 19, fontWeight: "900", marginTop: 20, marginBottom: 10 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e0e6ee", borderRadius: 18, paddingHorizontal: 16, marginBottom: 11 },
  setting: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: 1, borderBottomColor: "#edf1f5" },
  last: { borderBottomWidth: 0 }, settingLabel: { color: "#5d6b80", fontSize: 13, flex: 1 }, settingValue: { color: "#172033", fontSize: 13, fontWeight: "800", textAlign: "right" },
  action: { minHeight: 72, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e0e6ee", borderRadius: 18, padding: 15, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  actionTitle: { color: "#172033", fontSize: 15, fontWeight: "900" }, actionCopy: { color: "#718096", fontSize: 12, lineHeight: 18, marginTop: 3 }, chevron: { color: "#3156a3", fontSize: 28 },
  signOut: { minHeight: 54, borderRadius: 16, backgroundColor: "#3156a3", alignItems: "center", justifyContent: "center", marginTop: 8 }, signOutText: { color: "#fff", fontWeight: "900" },
  remove: { minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 4 }, removeText: { color: "#ad3030", fontWeight: "800", fontSize: 13 },
  overlay: { flex: 1, backgroundColor: "rgba(9,16,29,.58)", justifyContent: "center", padding: 18 }, modal: { width: "100%", maxWidth: 460, alignSelf: "center", backgroundColor: "#fff", borderRadius: 24, padding: 24 },
  modalEyebrow: { color: "#3156a3", fontSize: 10, fontWeight: "900", letterSpacing: 2 }, modalTitle: { color: "#111827", fontSize: 25, fontWeight: "900", marginTop: 10 }, modalCopy: { color: "#68758b", fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  label: { color: "#263247", fontSize: 12, fontWeight: "800", marginBottom: 7 }, input: { minHeight: 56, borderWidth: 1, borderColor: "#cdd7e5", borderRadius: 15, paddingHorizontal: 16, textAlign: "center", fontSize: 22, letterSpacing: 7, marginBottom: 14 },
  primary: { minHeight: 54, borderRadius: 15, backgroundColor: "#3156a3", alignItems: "center", justifyContent: "center" }, primaryText: { color: "#fff", fontWeight: "900" }, disabled: { opacity: .55 }, cancel: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 6 }, cancelText: { color: "#5f6d82", fontWeight: "800" },
});
