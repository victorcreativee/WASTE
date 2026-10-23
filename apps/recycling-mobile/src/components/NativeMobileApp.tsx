import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
import { Banner, Button, Field, Icon, Input } from "../ui/kit";
import { color, initials, radius, shadow, space, type } from "../ui/theme";

const BRAND_MARK = require("../../assets/brand-mark.png");

type Session = { token: string; user: MobileUser };
type SavedAccount = Awaited<ReturnType<typeof getSavedAccount>>;
type SaveChoice = { user: MobileUser; accessToken: string; refreshToken: string };

export function NativeMobileApp() {
  const { width } = useWindowDimensions();
  const tablet = width >= 720;
  const insets = useSafeAreaInsets();
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
    <SafeAreaView style={s.safe} edges={["top", "bottom", "left", "right"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.safe}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.screen, tablet && s.screenTablet]}
        >
          {tablet ? (
            <View style={s.brandPanel}>
              <Image source={BRAND_MARK} style={s.brandMark} accessibilityLabel="Kampala WMS" />
              <View style={{ gap: 12 }}>
                <Text style={s.brandPanelTitle}>Kampala Waste Management</Text>
                <Text style={s.brandPanelText}>Collection, recycling and KCCA reporting for field teams. Work keeps going without internet and synchronizes when the connection returns.</Text>
              </View>
              <Text style={s.brandPanelFoot}>Kampala Capital City Authority</Text>
            </View>
          ) : (
            <View style={s.brandRow}>
              <Image source={BRAND_MARK} style={s.brandMarkSmall} accessibilityLabel="Kampala WMS" />
              <View>
                <Text style={s.brandName}>Kampala WMS</Text>
                <Text style={type.caption}>Field operations</Text>
              </View>
            </View>
          )}

          <View style={[s.auth, tablet && s.authTablet]}>
            {showSaved ? (
              <>
                <Text style={type.display}>Welcome back, {firstName}</Text>
                <Text style={[type.small, s.lead]}>Unlock with the PIN you set on this phone.</Text>
                <View style={s.identity}>
                  <View style={s.avatar}><Text style={s.avatarText}>{initials(saved?.fullName || saved?.email)}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}><Text style={type.heading} numberOfLines={1}>{saved?.fullName}</Text><Text style={type.small} numberOfLines={1}>{saved?.email}</Text></View>
                </View>
                <Field label="Device PIN">
                  <TextInput
                    accessibilityLabel="Device PIN"
                    autoFocus
                    value={pin}
                    onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 8))}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={8}
                    placeholder="••••"
                    placeholderTextColor={color.subtle}
                    style={s.pinInput}
                    onSubmitEditing={() => void unlock({ pin })}
                  />
                </Field>
                {error ? <Banner tone="danger" text={error} /> : null}
                <Button disabled={pin.length < 4} loading={busy} title={busy ? "Unlocking…" : "Unlock"} onPress={() => void unlock({ pin })} />
                {saved?.biometricAvailable ? <Button variant="secondary" icon="finger-print-outline" title="Use fingerprint" onPress={() => void unlock({ biometric: true })} /> : null}
                <View style={s.links}>
                  <Pressable onPress={() => { setUseAnother(true); setError(""); }} hitSlop={8}><Text style={s.link}>Use another account</Text></Pressable>
                  <Pressable hitSlop={8} onPress={() => Alert.alert("Remove saved account?", "This removes only the secure account information stored on this device. It does not delete the online account.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => void removeSavedAccount() }])}><Text style={s.linkDanger}>Remove from this phone</Text></Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={type.display}>Sign in</Text>
                <Text style={[type.small, s.lead]}>Use your work account. The first sign-in on a phone needs internet; after that you can work offline.</Text>
                <Field label="Work email">
                  <Input
                    accessibilityLabel="Work email"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="username"
                    inputMode="email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="name@company.com"
                  />
                </Field>
                <Field label="Password">
                  <Input
                    accessibilityLabel="Password"
                    autoCapitalize="none"
                    autoComplete="current-password"
                    textContentType="password"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Your password"
                    onSubmitEditing={() => void signIn()}
                  />
                </Field>
                {error ? <Banner tone="danger" text={error} /> : null}
                <Button loading={busy} title={busy ? "Signing in…" : "Sign in"} onPress={() => void signIn()} />
                {saved?.saved ? <Pressable onPress={() => { setUseAnother(false); setError(""); }} style={s.center} hitSlop={8}><Text style={s.link}>Back to saved account</Text></Pressable> : null}
                <View style={s.note}><Icon name="lock-closed-outline" size={16} tint={color.muted} /><Text style={[type.caption, { flex: 1 }]}>Your password is checked by the server and never stored on this phone.</Text></View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={Boolean(pendingSave)} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => void finishWithoutSaving()}>
        <View style={[s.overlay, { paddingBottom: insets.bottom + space.md }]}>
          <View style={[s.modal, tablet && s.modalTablet]}>
            {pinStep === "create" && !newPin ? (
              <>
                <View style={s.modalIcon}><Icon name="phone-portrait-outline" size={24} tint={color.action} /></View>
                <Text style={type.title}>Keep this account on this phone?</Text>
                <Text style={[type.small, s.lead]}>Next time you can open it with a short PIN, even without internet.</Text>
                <Button title="Keep on this phone" onPress={() => setNewPin("pending")} />
                <Button variant="secondary" title="Not now" onPress={() => void finishWithoutSaving()} />
              </>
            ) : (
              <>
                <Text style={type.title}>{pinStep === "create" ? "Choose a PIN" : "Enter the PIN again"}</Text>
                <Text style={[type.small, s.lead]}>{pinStep === "create" ? "4 to 8 digits. It unlocks this phone only and does not change your password." : "Type the same PIN once more to confirm."}</Text>
                <TextInput autoFocus value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" secureTextEntry maxLength={8} style={s.pinInput} />
                {error ? <Banner tone="danger" text={error} /> : null}
                <Button disabled={pin.length < 4} loading={busy && pinStep === "confirm"} title={pinStep === "create" ? "Continue" : busy ? "Saving…" : "Save PIN"} onPress={() => void confirmPin(pin)} />
                <Button variant="secondary" title="Cancel" onPress={() => { setPendingSave(null); setNewPin(""); setPin(""); setPinStep("create"); }} />
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

function Loading() { return <View style={s.loading}><ActivityIndicator size="large" color={color.action} /><Text style={type.small}>Opening your workspace…</Text></View>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  screen: { flexGrow: 1, padding: space.xl, gap: space.xxl, justifyContent: "center" },
  screenTablet: { flexDirection: "row", alignItems: "stretch", maxWidth: 1080, width: "100%", alignSelf: "center", padding: space.xxl, gap: space.xxl },
  brandRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  brandMarkSmall: { width: 44, height: 44, borderRadius: radius.md },
  brandName: { ...type.heading, fontSize: 17 },
  brandPanel: { flex: 1, backgroundColor: color.brand, borderRadius: radius.lg, padding: 40, justifyContent: "space-between", minHeight: 560 },
  brandMark: { width: 52, height: 52, borderRadius: radius.md },
  brandPanelTitle: { color: "#ffffff", fontSize: 28, lineHeight: 34, fontWeight: "700" },
  brandPanelText: { color: "#b7c4bc", fontSize: 15, lineHeight: 23, maxWidth: 440 },
  brandPanelFoot: { color: "#8b9a92", fontSize: 13 },
  auth: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xl, gap: space.lg, ...shadow.card },
  authTablet: { flex: 0.9, alignSelf: "center", padding: 36, maxWidth: 480 },
  lead: { marginTop: -space.sm },
  pinInput: { minHeight: 58, borderRadius: radius.md, backgroundColor: color.fill, paddingHorizontal: 18, fontSize: 24, letterSpacing: 10, textAlign: "center", color: color.ink },
  identity: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.fill },
  avatar: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: color.brandAccent, fontWeight: "700", fontSize: 15 },
  links: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space.md },
  link: { color: color.action, fontWeight: "600", fontSize: 14 },
  linkDanger: { color: color.danger, fontWeight: "500", fontSize: 14 },
  center: { alignItems: "center" },
  note: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: color.fill, borderRadius: radius.md, padding: space.md },
  overlay: { flex: 1, backgroundColor: "rgba(19,32,26,0.5)", alignItems: "center", justifyContent: "flex-end", padding: space.md },
  modal: { width: "100%", maxWidth: 480, backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xl, gap: space.md },
  modalTablet: { padding: 34, marginBottom: "20%" },
  modalIcon: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.actionSoft, alignItems: "center", justifyContent: "center" },
  loading: { flex: 1, backgroundColor: color.page, alignItems: "center", justifyContent: "center", gap: space.md },
});
