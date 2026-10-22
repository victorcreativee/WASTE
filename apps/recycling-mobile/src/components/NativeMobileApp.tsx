import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  centralLogin,
  clearSession,
  getSavedAccount,
  MobileUser,
  saveSession,
  unlockSavedAccount,
} from "../lib/auth-session";
import { initializeMobileStorage } from "../lib/mobile-api";
import { CompanyTabletWorkspace } from "./CompanyTabletWorkspace";
import { OperationsWorkspace } from "./OperationsWorkspace";
import { RecyclingSalesWorkspace } from "./RecyclingSalesWorkspace";
import { RecyclingPurchaseWorkspace } from "./RecyclingPurchaseWorkspace";
import { RecyclingManagerWorkspace } from "./RecyclingManagerWorkspace";

type Session = { token: string; user: MobileUser };
type SavedAccount = Awaited<ReturnType<typeof getSavedAccount>>;
type SaveChoice = { user: MobileUser; accessToken: string; refreshToken: string };

export function NativeMobileApp() {
  const { width } = useWindowDimensions();
  const tablet = width >= 720;
  const [starting, setStarting] = useState(true);
  const [saved, setSaved] = useState<SavedAccount | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [useAnother, setUseAnother] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingSave, setPendingSave] = useState<SaveChoice | null>(null);
  const [pinStep, setPinStep] = useState<"create" | "confirm">("create");
  const [newPin, setNewPin] = useState("");

  useEffect(() => {
    void Promise.all([getSavedAccount(), initializeMobileStorage()])
      .then(([account]) => {
        setSaved(account);
        setEmail(account.email || "");
      })
      .catch(() => undefined)
      .finally(() => setStarting(false));
  }, []);

  const firstName = useMemo(
    () => saved?.fullName?.split(/\s+/)[0] || "there",
    [saved?.fullName],
  );

  async function signIn() {
    if (!email.trim() || !password) {
      setError("Enter your work email and password.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      const authenticated = await centralLogin(email, password);
      setPassword("");
      setPendingSave({
        user: authenticated.user,
        accessToken: authenticated.tokens.accessToken,
        refreshToken: authenticated.tokens.refreshToken,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign in could not be completed. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finishWithoutSaving() {
    if (!pendingSave) return;
    await saveSession(
      pendingSave.user,
      { accessToken: pendingSave.accessToken, refreshToken: pendingSave.refreshToken },
      false,
    );
    setSession({ token: pendingSave.accessToken, user: pendingSave.user });
    setPendingSave(null);
  }

  async function confirmPin(value: string) {
    if (!pendingSave) return;
    if (!/^\d{4,8}$/.test(value)) {
      setError("Choose a PIN containing 4 to 8 digits.");
      return;
    }
    if (pinStep === "create") {
      setNewPin(value);
      setPin("");
      setPinStep("confirm");
      return;
    }
    if (value !== newPin) {
      setPin("");
      setNewPin("");
      setPinStep("create");
      setError("The PINs did not match. Please create the PIN again.");
      return;
    }
    try {
      setBusy(true);
      await saveSession(
        pendingSave.user,
        { accessToken: pendingSave.accessToken, refreshToken: pendingSave.refreshToken },
        true,
        value,
      );
      await initializeMobileStorage(pendingSave.user.email);
      setSaved(await getSavedAccount());
      setSession({ token: pendingSave.accessToken, user: pendingSave.user });
      setPendingSave(null);
      setPin("");
      setNewPin("");
      setPinStep("create");
      Alert.alert("Account saved", "This account is ready for secure PIN or biometric access on this device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function unlock(input: { pin?: string; biometric?: boolean }) {
    try {
      setBusy(true);
      setError("");
      const unlocked = await unlockSavedAccount(input);
      await initializeMobileStorage(unlocked.user.email);
      setPin("");
      setSession(unlocked);
    } catch (cause) {
      setPin("");
      setError(cause instanceof Error ? cause.message : "This account could not be unlocked.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setSession(null);
    setPin("");
    setError("");
    setUseAnother(false);
    const account = await getSavedAccount();
    setSaved(account);
    setEmail(account.email || "");
  }

  async function removeSavedAccount() {
    await clearSession(true);
    setSaved(await getSavedAccount());
    setEmail("");
    setUseAnother(true);
  }

  if (starting) return <Loading />;
  if (session) return <Workspace session={session} onLogout={logout} />;

  const showSaved = Boolean(saved?.saved && !useAnother);
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.safe}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.screen, tablet && s.screenTablet]}
        >
          <View style={[s.hero, tablet && s.heroTablet]}>
            <View style={s.brandMark}><Text style={s.brandLetters}>KW</Text></View>
            <View style={s.heroCopy}>
              <Text style={s.eyebrow}>KAMPALA WASTE MANAGEMENT</Text>
              <Text style={s.heroTitle}>One connected operation, wherever work happens.</Text>
              <Text style={s.heroText}>Secure field operations, stock, finance and service delivery—online or offline.</Text>
            </View>
            <View style={s.heroBadge}><Text style={s.heroBadgeText}>SECURE • OFFLINE READY • SYNCHRONIZED</Text></View>
          </View>

          <View style={[s.auth, tablet && s.authTablet]}>
            {showSaved ? (
              <>
                <Text style={s.eyebrowBlue}>SECURE DEVICE ACCESS</Text>
                <Text style={s.title}>Welcome back, {firstName}</Text>
                <Text style={s.subtitle}>Continue as {saved?.fullName || saved?.email} using your device PIN.</Text>
                <View style={s.identity}>
                  <View style={s.avatar}><Text style={s.avatarText}>{(saved?.fullName || saved?.email || "KW").slice(0, 2).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}><Text style={s.identityName}>{saved?.fullName}</Text><Text style={s.muted}>{saved?.email}</Text></View>
                </View>
                <Text style={s.label}>Device PIN</Text>
                <TextInput
                  accessibilityLabel="Device PIN"
                  autoFocus
                  value={pin}
                  onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 8))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                  placeholder="••••"
                  style={s.pinInput}
                  onSubmitEditing={() => void unlock({ pin })}
                />
                {error ? <Message text={error} /> : null}
                <PrimaryButton disabled={busy || pin.length < 4} title={busy ? "Unlocking…" : "Unlock account"} onPress={() => void unlock({ pin })} />
                {saved?.biometricAvailable ? <SecondaryButton title="Use fingerprint or device security" onPress={() => void unlock({ biometric: true })} /> : null}
                <Pressable onPress={() => { setUseAnother(true); setError(""); }} style={s.textButton}><Text style={s.textButtonLabel}>Use another account</Text></Pressable>
                <Pressable onPress={() => Alert.alert("Remove saved account?", "This removes only the secure account information stored on this device. It does not delete the online account.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => void removeSavedAccount() }])} style={s.textButton}><Text style={s.removeLabel}>Remove from this device</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={s.eyebrowBlue}>SECURE ACCESS</Text>
                <Text style={s.title}>Welcome back</Text>
                <Text style={s.subtitle}>Your first sign-in on this device requires internet. Your role opens the correct workspace automatically.</Text>
                <Text style={s.label}>Work email</Text>
                <TextInput
                  accessibilityLabel="Work email"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="username"
                  inputMode="email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@company.com"
                  style={s.input}
                />
                <Text style={s.label}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  style={s.input}
                  onSubmitEditing={() => void signIn()}
                />
                {error ? <Message text={error} /> : null}
                <PrimaryButton disabled={busy} title={busy ? "Signing in…" : "Sign in"} onPress={() => void signIn()} />
                {saved?.saved ? <Pressable onPress={() => { setUseAnother(false); setError(""); }} style={s.textButton}><Text style={s.textButtonLabel}>Return to saved account</Text></Pressable> : null}
                <View style={s.securityNote}><Text style={s.securityText}>Your password is sent securely for server authentication and is never stored by Kampala WMS.</Text></View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={Boolean(pendingSave)} transparent animationType="fade" onRequestClose={() => void finishWithoutSaving()}>
        <View style={s.overlay}>
          <View style={[s.modal, tablet && s.modalTablet]}>
            {pinStep === "create" && !newPin ? (
              <>
                <View style={s.modalIcon}><Text style={s.modalIconText}>✓</Text></View>
                <Text style={s.modalTitle}>Save this account on this device?</Text>
                <Text style={s.modalText}>Save your account securely on this device so you can access it faster next time using your PIN.</Text>
                <PrimaryButton title="Save on this device" onPress={() => setNewPin("pending")} />
                <SecondaryButton title="Not now" onPress={() => void finishWithoutSaving()} />
              </>
            ) : (
              <>
                <Text style={s.eyebrowBlue}>DEVICE SECURITY</Text>
                <Text style={s.modalTitle}>{pinStep === "create" ? "Create a device PIN" : "Confirm your PIN"}</Text>
                <Text style={s.modalText}>{pinStep === "create" ? "Use 4 to 8 digits. This PIN unlocks only this device and never replaces server authentication." : "Enter the same PIN once more."}</Text>
                <TextInput autoFocus value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" secureTextEntry maxLength={8} style={s.pinInput} />
                {error ? <Message text={error} /> : null}
                <PrimaryButton disabled={busy || pin.length < 4} title={pinStep === "create" ? "Continue" : busy ? "Saving…" : "Save account"} onPress={() => void confirmPin(pin)} />
                <SecondaryButton title="Cancel" onPress={() => { setPendingSave(null); setNewPin(""); setPin(""); setPinStep("create"); }} />
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Workspace({ session, onLogout }: { session: Session; onLogout: () => Promise<void> }) {
  const roles = session.user.roles;
  const recyclingAccess = session.user.permissions?.some((permission) =>
    permission.startsWith("recycling."),
  );
  if (
    roles.includes("recycling_field_manager") ||
    (recyclingAccess &&
      (roles.includes("company_admin") || roles.includes("supervisor")))
  )
    return <RecyclingManagerWorkspace token={session.token} user={session.user} onLogout={onLogout} />;
  if (roles.includes("recycling_collector")) return <RecyclingPurchaseWorkspace token={session.token} user={session.user} onLogout={onLogout} />;
  if (roles.includes("recycling_sales")) return <RecyclingSalesWorkspace token={session.token} user={session.user} onLogout={onLogout} />;
  if (roles.includes("driver") || roles.includes("supervisor")) return <OperationsWorkspace token={session.token} user={session.user} onLogout={onLogout} />;
  return <CompanyTabletWorkspace token={session.token} user={session.user} onLogout={onLogout} />;
}

function PrimaryButton({ title, disabled, onPress }: { title: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [s.primary, (disabled || pressed) && s.primaryMuted]}><Text style={s.primaryText}>{title}</Text></Pressable>;
}
function SecondaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={s.secondary}><Text style={s.secondaryText}>{title}</Text></Pressable>;
}
function Message({ text }: { text: string }) { return <View style={s.message}><Text style={s.messageText}>{text}</Text></View>; }
function Loading() { return <View style={s.loading}><ActivityIndicator size="large" color="#3156a3" /><Text style={s.muted}>Opening your secure workspace…</Text></View>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f6f9" },
  screen: { flexGrow: 1, padding: 16, gap: 16, justifyContent: "center" },
  screenTablet: { flexDirection: "row", alignItems: "stretch", maxWidth: 1120, width: "100%", alignSelf: "center", padding: 28, gap: 24 },
  hero: { backgroundColor: "#121a2c", borderRadius: 28, padding: 26, minHeight: 230, justifyContent: "space-between" },
  heroTablet: { flex: 1.05, minHeight: 680, padding: 40 },
  brandMark: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, borderColor: "#40506d", alignItems: "center", justifyContent: "center", backgroundColor: "#182238" },
  brandLetters: { color: "#f2b657", fontWeight: "900", fontSize: 17 },
  heroCopy: { marginVertical: 32 },
  eyebrow: { color: "#f2b657", fontSize: 11, fontWeight: "900", letterSpacing: 2.1 },
  eyebrowBlue: { color: "#3156a3", fontSize: 11, fontWeight: "900", letterSpacing: 2.1, marginBottom: 12 },
  heroTitle: { color: "#fff", fontWeight: "900", fontSize: 34, lineHeight: 41, marginTop: 16, maxWidth: 520 },
  heroText: { color: "#b8c3d6", fontSize: 15, lineHeight: 23, marginTop: 16, maxWidth: 500 },
  heroBadge: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#202c45", paddingHorizontal: 13, paddingVertical: 8 },
  heroBadgeText: { color: "#ced7e6", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  auth: { backgroundColor: "#fff", borderRadius: 28, padding: 24, borderWidth: 1, borderColor: "#e2e7ef", shadowColor: "#172033", shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  authTablet: { flex: 0.95, alignSelf: "center", padding: 36, maxWidth: 510 },
  title: { color: "#111827", fontSize: 32, lineHeight: 38, fontWeight: "900" },
  subtitle: { color: "#67748b", fontSize: 15, lineHeight: 23, marginTop: 9, marginBottom: 24 },
  label: { color: "#263247", fontSize: 13, fontWeight: "800", marginBottom: 8, marginTop: 4 },
  input: { minHeight: 56, borderRadius: 16, borderWidth: 1, borderColor: "#d9e0ea", backgroundColor: "#fbfcfe", paddingHorizontal: 16, fontSize: 16, color: "#111827", marginBottom: 16 },
  pinInput: { minHeight: 64, borderRadius: 18, borderWidth: 1.5, borderColor: "#3156a3", backgroundColor: "#f8faff", paddingHorizontal: 18, fontSize: 26, letterSpacing: 8, textAlign: "center", color: "#111827", marginBottom: 16 },
  primary: { minHeight: 56, borderRadius: 16, backgroundColor: "#3156a3", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 6 },
  primaryMuted: { opacity: 0.55 },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  secondary: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 10 },
  secondaryText: { color: "#263247", fontSize: 14, fontWeight: "800" },
  textButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 5 },
  textButtonLabel: { color: "#3156a3", fontWeight: "800" },
  removeLabel: { color: "#a33a33", fontWeight: "700", fontSize: 13 },
  message: { backgroundColor: "#fff1f1", borderLeftWidth: 4, borderLeftColor: "#d14343", borderRadius: 12, padding: 13, marginBottom: 12 },
  messageText: { color: "#9b2c2c", fontSize: 13, lineHeight: 19, fontWeight: "600" },
  securityNote: { backgroundColor: "#f1f5fb", borderRadius: 14, padding: 14, marginTop: 18 },
  securityText: { color: "#58677f", fontSize: 12, lineHeight: 18 },
  identity: { flexDirection: "row", alignItems: "center", gap: 13, padding: 14, borderRadius: 18, backgroundColor: "#f4f7fc", marginBottom: 20 },
  avatar: { width: 52, height: 52, borderRadius: 18, backgroundColor: "#162138", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#f2b657", fontWeight: "900", fontSize: 16 },
  identityName: { color: "#111827", fontWeight: "900", fontSize: 16 },
  muted: { color: "#718096", fontSize: 13, marginTop: 3 },
  overlay: { flex: 1, backgroundColor: "rgba(8,15,28,0.56)", alignItems: "center", justifyContent: "center", padding: 18 },
  modal: { width: "100%", maxWidth: 480, backgroundColor: "#fff", borderRadius: 26, padding: 24 },
  modalTablet: { padding: 34 },
  modalIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: "#e9f7ef", alignItems: "center", justifyContent: "center", marginBottom: 18 },
  modalIconText: { color: "#16804b", fontWeight: "900", fontSize: 23 },
  modalTitle: { color: "#111827", fontWeight: "900", fontSize: 25, lineHeight: 31 },
  modalText: { color: "#68758b", fontSize: 14, lineHeight: 21, marginTop: 9, marginBottom: 20 },
  loading: { flex: 1, backgroundColor: "#f4f6f9", alignItems: "center", justifyContent: "center", gap: 14 },
});
